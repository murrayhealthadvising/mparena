const { createClient } = require('@supabase/supabase-js');

function parseUshaEmail(body) {
  const get = (label) => {
    const re = new RegExp(label + '\\s*:\\s*([^\\r\\n]+)', 'i');
    const m = body.match(re);
    return m ? m[1].trim() : '';
  };
  return {
    firstName:   get('First Name'),
    lastName:    get('Last Name'),
    phone:       get('Primary Phone').replace(/\D/g, ''),
    email:       get('Email'),
    state:       get('State'),
    age:         get('Age Range') || get('Age'),
    income:      get('Income'),
    household:   get('Household'),
    notes:       get('Comments') || '',
    source:      'gmail',
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
        client_id:     process.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        refresh_token: acct.refresh_token,
        grant_type:    'refresh_token'
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
      'https://www.googleapis.com/gmail/v1/users/me/messages?q=' + encodeURIComponent(query) + '&maxResults=100',
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const searchData = await searchRes.json();
    if (searchData.error) return res.status(200).json({ imported: 0, error: searchData.error.message });
    if (!searchData.messages?.length) return res.status(200).json({ imported: 0, checked: 0, message: 'No USHA emails in last ' + days + ' days' });

    let imported = 0, skipped = 0;
    const errors = [];
    for (const msg of searchData.messages) {
      try {
        const msgRes = await fetch(
          'https://www.googleapis.com/gmail/v1/users/me/messages/' + msg.id + '?format=full',
          { headers: { Authorization: 'Bearer ' + token } }
        );
        const msgData = await msgRes.json();
        const payload = msgData.payload;
        let body = '';
        if (payload?.body?.data) {
          body = Buffer.from(payload.body.data, 'base64url').toString('utf8');
        } else if (payload?.parts) {
          for (const part of payload.parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              body += Buffer.from(part.body.data, 'base64url').toString('utf8');
            }
          }
        }
        if (!body) continue;
        const lead = parseUshaEmail(body);
        if (!lead.firstName && !lead.phone) continue;
        const dateHeader = (payload?.headers || []).find(h => h.name === 'Date');
        lead.receivedAt = dateHeader ? new Date(dateHeader.value).toISOString() : new Date().toISOString();
        lead.user_id = user_id;
        if (lead.phone) {
          const { data: dup } = await sb.from('leads').select('id').eq('phone', lead.phone).eq('user_id', user_id).maybeSingle();
          if (dup) { skipped++; continue; }
        }
        const { error: insertErr } = await sb.from('leads').insert(lead);
        if (!insertErr) imported++;
        else errors.push(insertErr.message);
      } catch(e) { errors.push(e.message); }
    }
    return res.status(200).json({ imported, skipped, checked: searchData.messages.length, errors: errors.slice(0,3) });
  } catch(err) {
    return res.status(500).json({ imported: 0, error: err.message });
  }
};
