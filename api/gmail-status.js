const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(200).json({ connected: false });

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return res.status(200).json({ connected: false });

    const { data } = await sb
      .from('gmail_accounts')
      .select('gmail_address, access_token, updated_at')
      .eq('user_id', user.id)
      .single();

    if (!data || !data.access_token) return res.status(200).json({ connected: false });

    return res.status(200).json({
      connected: true,
      email: data.gmail_address,
      updated_at: data.updated_at
    });
  } catch (err) {
    return res.status(200).json({ connected: false });
  }
};
