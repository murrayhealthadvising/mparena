const { createClient } = require('@supabase/supabase-js');

// Parse a USHA lead email body into a lead object
function parseLeadEmail(body) {
  const get = (label) => {
    const re = new RegExp(label + '[:\\s]+([^\\n\\r]+)', 'i');
    const m = body.match(re);
    return m ? m[1].trim() : '';
  };
  const nameParts = (get('Name') || get('Applicant') || '').split(/\s+/);
  return {
    firstName: nameParts[0] || '',
    lastName: nameParts.slice(1).join(' ') || '',
    phone: (get('Phone') || get('Cell') || get('Mobile') || '').replace(/[^\d+\-() ]/g,'').trim(),
    email: get('Email'),
    state: get('State'),
    zip: get('Zip') || get('ZIP') || get('Postal'),
    income: get('Income') || get('Annual Income'),
    household: get('Household') || get('Household Size') || get('Members'),
    age: get('Age') || get('DOB'),
    notes: '',
    source: 'gmail',
    disposition: 'new',
    receivedAt: new Date().toISOString(),
  };
}

async function refreshToken(sb, userId, refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const tokens = await res.json();
  if (!tokens.access_token) return null;
  const expiry = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;
  await sb.from('gmail_accounts').update({
    access_token: tokens.access_token,
    token_expiry: expiry,
    updated_at: new Date().toISOString()
  }).eq('user_id', userId);
  return tokens.access_token;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  try {
    const { user_id, days = 7 } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Get gmail tokens
    const { data: acct } = await sb
      .from('gmail_accounts')
      .select('access_token, refresh_token, token_expiry')
      .eq('user_id', user_id)
      .single();

    if (!acct || !acct.access_token) {
      return res.status(200).json({ imported: 0, error: 'No gmail account connected' });
    }

    let token = acct.access_token;

    // Check if token expired - refresh if needed
    if (acct.token_expiry && new Date(acct.token_expiry) < new Date()) {
      if (acct.refresh_token) {
        token = await refreshToken(sb, user_id, acct.refresh_token);
        if (!token) return res.status(200).json({ imported: 0, error: 'Token refresh failed' });
      }
    }

    // Search Gmail for USHA leads in last N days
    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const afterDate = Math.floor(daysAgo.getTime() / 1000);
    // USHA lead emails typically come from specific senders or have "lead" in subject
    const query = `after:${afterDate} (from:leads OR from:usha OR subject:lead OR subject:"health insurance" OR subject:"quote request")`;

    const searchRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const searchData = await searchRes.json();

    if (!searchData.messages || searchData.messages.length === 0) {
      return res.status(200).json({ imported: 0, message: 'No matching emails found' });
    }

    let imported = 0;
    const errors = [];

    for (const msg of searchData.messages) {
      try {
        const msgRes = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: 'Bearer ' + token } }
        );
        const msgData = await msgRes.json();

        // Get email body
        let body = '';
        const payload = msgData.payload;
        if (payload.body?.data) {
          body = Buffer.from(payload.body.data, 'base64').toString('utf8');
        } else if (payload.parts) {
          for (const part of payload.parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              body += Buffer.from(part.body.data, 'base64').toString('utf8');
            }
          }
        }

        if (!body) continue;

        // Get date from email headers
        const dateHeader = (payload.headers || []).find(h => h.name === 'Date');
        const emailDate = dateHeader ? new Date(dateHeader.value).toISOString() : new Date().toISOString();

        const lead = parseLeadEmail(body);
        lead.receivedAt = emailDate;
        lead.user_id = user_id;

        // Only import if we got at least a name or phone
        if (!lead.firstName && !lead.phone) continue;

        // Check for duplicate by phone
        if (lead.phone) {
          const { data: existing } = await sb
            .from('leads')
            .select('id')
            .eq('phone', lead.phone)
            .eq('user_id', user_id)
            .single();
          if (existing) continue;
        }

        const { error: insertErr } = await sb.from('leads').insert(lead);
        if (!insertErr) imported++;
        else errors.push(insertErr.message);
      } catch (e) {
        errors.push(e.message);
      }
    }

    return res.status(200).json({
      imported,
      checked: searchData.messages.length,
      errors: errors.slice(0, 3)
    });

  } catch (err) {
    console.error('gmail-import error:', err.message);
    return res.status(200).json({ imported: 0, error: err.message });
  }
};
