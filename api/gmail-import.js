const { createClient } = require('@supabase/supabase-js');

function parseUshaEmail(body) {
  const get = (label) => {
    const re = new RegExp(label + '\\s*:\\s*([^\\r\\n]+)', 'i');
    const m = body.match(re);
    return m ? m[1].trim() : '';
  };
  return {
    first_name:  get('First Name'),
    last_name:   get('Last Name'),
    phone:       get('Primary Phone').replace(/\D/g, ''),
    email:       get('Email'),
    state:       get('State'),
    zip:         get('Zip') || get('ZIP'),
    age:         get('Age'),
    age_range:   get('Age Range'),
    income:      get('Income'),
    household:   get('Household'),
    comments:    get('Comments') || '',
    campaign:    get('Name'),
    price:       parseFloat(get('Price')) || null,
    lead_id_ext: get('Lead Id'),
    disposition: 'new',
  };
}

async function getToken(sb, userId) {
  const { data: acct } = await sb.from('gmail_accounts')
    .select('access_token, refresh_token, token_expiry')
    .eq('user_id', userId).single();
  if (!acct?.access_token) return null;
  const expired = acct.token_expiry && new Date(acct.token_expiry) < new Date(Date.now() + 60000);
  if (expired && acct.refresh_token) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        refresh_token: acct.refresh_token,
        grant_type: 'refresh_token'
      })
    });
    const tokens = await res.json();
    if (tokens.access_token) {
      await sb.from('gmail_accounts').update({
        access_token: tokens.access_token,
        token_expiry: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
        updated_at: new Date().toISOString()
      }).eq('user_id', userId);
      return tokens.access_token;
    }
  }
  return acct.access_token;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { user_id, days = 30 } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const token = await getToken(sb, user_id);
    if (!token) return res.status(200).json({ imported: 0, error: 'No Gmail connected' });

    const afterSec = Math.floor((Date.now() - Number(days) * 86400000) / 1000);
    const query = 'from:ushamarketplace.com after:' + afterSec;
    const searchRes = await fetch(
      'https://www.googleapis.com/gmail/v1/users/me/messages?q=' + encodeURIComponent(query) + '&maxResults=50',
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const searchData = await searchRes.json();
    if (searchData.error) return res.status(200).json({ imported: 0, error: searchData.error.message });
    if (!searchData.messages?.length) return res.status(200).json({ imported: 0, checked: 0, message: 'No USHA emails found in last ' + days + ' days' });

    // Parallel fetch all message details
    const msgDetails = await Promise.all(
      searchData.messages.map(msg =>
        fetch('https://www.googleapis.com/gmail/v1/users/me/messages/' + msg.id + '?format=full',
          { headers: { Authorization: 'Bearer ' + token } }
        ).then(r => r.json()).catch(() => null)
      )
    );

    // Get existing phones + message IDs to deduplicate
    const { data: existing } = await sb.from('leads').select('phone, email_message_id').eq('user_id', user_id);
    const existingPhones = new Set((existing||[]).map(l => l.phone).filter(Boolean));
    const existingMsgIds = new Set((existing||[]).map(l => l.email_message_id).filter(Boolean));

    const toInsert = [];
    for (const msgData of msgDetails) {
      if (!msgData?.payload) continue;
      const payload = msgData.payload;
      let body = '';
      if (payload.body?.data) {
        body = Buffer.from(payload.body.data, 'base64url').toString('utf8');
      } else if (payload.parts) {
        for (const part of payload.parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            body += Buffer.from(part.body.data, 'base64url').toString('utf8');
          }
        }
      }
      if (!body) continue;
      const lead = parseUshaEmail(body);
      if (!lead.first_name && !lead.phone) continue;
      if (existingMsgIds.has(msgData.id)) continue;
      if (lead.phone && existingPhones.has(lead.phone)) continue;

      const dateHeader = (payload.headers||[]).find(h => h.name === 'Date');
      lead.received_at = dateHeader ? new Date(dateHeader.value).toISOString() : new Date().toISOString();
      lead.user_id = user_id;
      lead.email_message_id = msgData.id;
      toInsert.push(lead);
      existingPhones.add(lead.phone);
    }

    let imported = 0;
    const errors = [];
    if (toInsert.length > 0) {
      const { error: insertErr } = await sb.from('leads').insert(toInsert);
      if (insertErr) errors.push(insertErr.message);
      else imported = toInsert.length;
    }

    return res.status(200).json({
      imported,
      skipped: searchData.messages.length - toInsert.length,
      checked: searchData.messages.length,
      errors: errors.slice(0, 3)
    });
  } catch(err) {
    return res.status(500).json({ imported: 0, error: err.message });
  }
};
