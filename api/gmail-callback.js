const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const { code, state, error } = req.query;
  const APP_URL = 'https://mparena.vercel.app';

  if (error) return res.redirect(APP_URL + '?gmail_error=' + encodeURIComponent(error));
  if (!code) return res.redirect(APP_URL + '?gmail_error=no_code');

  try {
    const redirectUri = APP_URL + '/api/gmail-callback';
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      return res.redirect(APP_URL + '?gmail_error=token_failed');
    }

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token }
    });
    const profile = await profileRes.json();
    const gmailAddress = profile.email || '';

    let userId = null;
    try { userId = Buffer.from(state || '', 'base64').toString('utf8'); } catch(e) {}

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    await sb.from('gmail_accounts').upsert({
      user_id: userId,
      gmail_address: gmailAddress,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      token_expiry: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    // Trigger import of last 7 days using the real import endpoint
    if (userId) {
      fetch(APP_URL + '/api/gmail-import?user_id=' + encodeURIComponent(userId) + '&days=7').catch(() => {});
    }

    return res.redirect(APP_URL + '?gmail_connected=1');
  } catch (err) {
    console.error('Gmail callback error:', err.message);
    return res.redirect(APP_URL + '?gmail_error=' + encodeURIComponent(err.message));
  }
};
