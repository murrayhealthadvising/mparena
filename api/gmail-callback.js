const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const { code, state, error } = req.query;
  const APP_URL = 'https://mparena.vercel.app';

  if (error) {
    return res.redirect(APP_URL + '?gmail_error=' + encodeURIComponent(error));
  }
  if (!code) {
    return res.redirect(APP_URL + '?gmail_error=no_code');
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: process.env.VERCEL_URL
          ? 'https://' + process.env.VERCEL_URL + '/api/gmail-callback'
          : APP_URL + '/api/gmail-callback',
        grant_type: 'authorization_code'
      })
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      return res.redirect(APP_URL + '?gmail_error=token_exchange_failed');
    }

    // Get gmail address
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token }
    });
    const profile = await profileRes.json();
    const gmailEmail = profile.email || '';

    // Decode state to get user_id
    let userId = null;
    try { userId = Buffer.from(state || '', 'base64').toString('utf8'); } catch(e){}

    // Save to Supabase
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    await sb.from('gmail_accounts').upsert({
      user_id: userId,
      email: gmailEmail,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
      connected: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    // Trigger background import of last 7 days (fire and forget)
    if (userId) {
      const importUrl = APP_URL + '/api/poll?user_id=' + encodeURIComponent(userId) + '&days=7&trigger=connect';
      fetch(importUrl).catch(() => {});
    }

    // Redirect back to app with success flag
    return res.redirect(APP_URL + '?gmail_connected=1');

  } catch (err) {
    console.error('Gmail callback error:', err.message);
    return res.redirect(APP_URL + '?gmail_error=' + encodeURIComponent(err.message));
  }
};
