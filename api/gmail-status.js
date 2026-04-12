const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  try {
    // Get auth token from header
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      return res.status(200).json({ connected: false });
    }

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    
    // Get user from token
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) {
      return res.status(200).json({ connected: false });
    }

    // Check gmail_accounts table
    const { data, error } = await sb.from('gmail_accounts')
      .select('email, connected, updated_at')
      .eq('user_id', user.id)
      .single();

    if (error || !data || !data.connected) {
      return res.status(200).json({ connected: false });
    }

    return res.status(200).json({ connected: true, email: data.email, updated_at: data.updated_at });

  } catch (err) {
    return res.status(200).json({ connected: false });
  }
};
