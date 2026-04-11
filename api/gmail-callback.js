const{google}=require('googleapis');
const{createClient}=require('@supabase/supabase-js');
const REDIRECT_URI='https://mparena.vercel.app/api/gmail-callback';

module.exports=async(req,res)=>{
  const{code,state:userId,error}=req.query;
  
  const errPage=(msg)=>res.status(400).send('<html><body style="font-family:sans-serif;background:#0f1117;color:#e2e8f0;padding:40px;text-align:center"><h2 style="color:#F09595">Error</h2><p>'+msg+'</p><a href="https://mparena.vercel.app" style="color:#378ADD">Back</a></body></html>');
  
  if(error)return errPage('Google error: '+error);
  if(!code)return errPage('No code received');
  
  try{
    const oauth2Client=new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      REDIRECT_URI
    );
    
    // Exchange code for tokens
    const{tokens}=await oauth2Client.getToken(code);
    console.log('Tokens received - access:', !!tokens.access_token, 'refresh:', !!tokens.refresh_token);
    
    if(!tokens.access_token)return errPage('No access token from Google');
    
    // Get Gmail address using the access token directly via fetch (avoids auth client issues)
    const userRes=await fetch('https://www.googleapis.com/oauth2/v2/userinfo',{
      headers:{Authorization:'Bearer '+tokens.access_token}
    });
    const userInfo=await userRes.json();
    const gmailAddress=userInfo.email;
    console.log('Gmail:', gmailAddress);
    
    if(!gmailAddress)return errPage('Could not get Gmail address: '+JSON.stringify(userInfo));
    
    // Save to Supabase
    const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
    const{error:dbErr}=await sb.from('gmail_accounts').upsert({
      user_id:userId,
      gmail_address:gmailAddress,
      access_token:tokens.access_token,
      refresh_token:tokens.refresh_token||null,
      updated_at:new Date().toISOString()
    },{onConflict:'user_id'});
    if(dbErr){console.error('DB:',dbErr);return errPage('DB error: '+dbErr.message);}
    
    // Set up Gmail watch using access token directly
    const watchRes=await fetch('https://www.googleapis.com/gmail/v1/users/me/watch',{
      method:'POST',
      headers:{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json'},
      body:JSON.stringify({topicName:process.env.PUBSUB_TOPIC,labelIds:['INBOX']})
    });
    const watchData=await watchRes.json();
    console.log('Watch result:', JSON.stringify(watchData));
    if(watchData.error){console.error('Watch error (non-fatal):',watchData.error.message);}
    
    return res.status(200).send('<html><body style="font-family:sans-serif;background:#0f1117;color:#e2e8f0;padding:40px;text-align:center"><div style="font-size:48px;margin-bottom:16px">&#10003;</div><h2 style="color:#97C459;margin-bottom:8px">Gmail connected!</h2><p style="color:#64748b;margin-bottom:24px">'+gmailAddress+' is linked to MParena.<br>New LeadArena emails will appear automatically.</p><a href="https://mparena.vercel.app" style="background:#378ADD;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Open MParena &#8594;</a></body></html>');
    
  }catch(err){
    console.error('Callback fatal:', err.message);
    return res.status(500).send('<html><body style="font-family:sans-serif;background:#0f1117;color:#e2e8f0;padding:40px;text-align:center"><h2 style="color:#F09595">Error</h2><p>'+err.message+'</p><a href="https://mparena.vercel.app" style="color:#378ADD">Back</a></body></html>');
  }
};