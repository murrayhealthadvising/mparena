const{google}=require('googleapis');
const{createClient}=require('@supabase/supabase-js');
const REDIRECT_URI='https://mparena.vercel.app/api/gmail-callback';

module.exports=async(req,res)=>{
  const{code,state:userId,error}=req.query;
  
  const errPage=(msg)=>res.status(400).send(`<html><body style="font-family:sans-serif;background:#0f1117;color:#e2e8f0;padding:40px;text-align:center"><h2 style="color:#F09595">Connection failed</h2><p>${msg}</p><a href="https://mparena.vercel.app" style="color:#378ADD">Back to MParena</a></body></html>`);
  
  if(error)return errPage('Google error: '+error);
  if(!code)return errPage('No authorization code received');
  
  try{
    // Exchange code for tokens
    const oauth2Client=new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      REDIRECT_URI
    );
    
    const{tokens}=await oauth2Client.getToken(code);
    console.log('Got tokens, access_token present:', !!tokens.access_token, 'refresh_token present:', !!tokens.refresh_token);
    
    if(!tokens.access_token){
      return errPage('No access token received from Google');
    }
    
    oauth2Client.setCredentials(tokens);
    
    // Get the Gmail address
    const oauth2=google.oauth2({version:'v2',auth:oauth2Client});
    const{data:userInfo}=await oauth2.userinfo.get();
    const gmailAddress=userInfo.email;
    console.log('Gmail address:', gmailAddress);
    
    // Save tokens to Supabase
    const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
    const{error:dbError}=await sb.from('gmail_accounts').upsert({
      user_id:userId,
      gmail_address:gmailAddress,
      access_token:tokens.access_token,
      refresh_token:tokens.refresh_token||null,
      updated_at:new Date().toISOString()
    },{onConflict:'user_id'});
    
    if(dbError){
      console.error('DB error:', dbError);
      return errPage('Database error: '+dbError.message);
    }
    
    // Set up Gmail watch for push notifications
    const gmail=google.gmail({version:'v1',auth:oauth2Client});
    try{
      const watchRes=await gmail.users.watch({
        userId:'me',
        requestBody:{
          topicName:process.env.PUBSUB_TOPIC,
          labelIds:['INBOX'],
        },
      });
      console.log('Gmail watch set up:', watchRes.data);
    }catch(watchErr){
      // Watch setup failed but tokens are saved - not fatal
      console.error('Watch setup error (non-fatal):', watchErr.message);
    }
    
    return res.status(200).send(`<html><body style="font-family:sans-serif;background:#0f1117;color:#e2e8f0;padding:40px;text-align:center">
      <div style="font-size:48px;margin-bottom:16px">✓</div>
      <h2 style="color:#97C459;margin-bottom:8px">Gmail connected!</h2>
      <p style="color:#64748b;margin-bottom:24px">${gmailAddress} is now linked to MParena.<br>New LeadArena emails will appear automatically.</p>
      <a href="https://mparena.vercel.app" style="background:#378ADD;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Open MParena</a>
    </body></html>`);
    
  }catch(err){
    console.error('Callback error:', err);
    return res.status(500).send(`<html><body style="font-family:sans-serif;background:#0f1117;color:#e2e8f0;padding:40px;text-align:center"><h2 style="color:#F09595">Error</h2><p>${err.message}</p><a href="https://mparena.vercel.app" style="color:#378ADD">Back</a></body></html>`);
  }
};