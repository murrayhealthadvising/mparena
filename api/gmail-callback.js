const{google}=require('googleapis');
const{createClient}=require('@supabase/supabase-js');
const REDIRECT_URI='https://mparena.vercel.app/api/gmail-callback';
module.exports=async(req,res)=>{
  const{code,state:userId,error}=req.query;
  const errPage=msg=>res.status(400).send('<html><body style="font-family:sans-serif;background:#0f1117;color:#e2e8f0;padding:40px;text-align:center"><h2 style="color:#F09595">Connection failed</h2><p>'+msg+'</p><a href="https://mparena.vercel.app" style="color:#378ADD">&larr; Back to MParena</a></body></html>');
  if(error)return errPage('Google error: '+error);
  if(!code)return errPage('No authorization code received');
  try{
    const oauth2Client=new google.auth.OAuth2(process.env.GOOGLE_OAUTH_CLIENT_ID,process.env.GOOGLE_OAUTH_CLIENT_SECRET,REDIRECT_URI);
    const{tokens}=await oauth2Client.getToken(code);
    console.log('Tokens - access:',!!tokens.access_token,'refresh:',!!tokens.refresh_token);
    if(!tokens.access_token)return errPage('No access token from Google');
    const uRes=await fetch('https://www.googleapis.com/oauth2/v2/userinfo',{headers:{Authorization:'Bearer '+tokens.access_token}});
    const uInfo=await uRes.json();
    const gmailAddress=uInfo.email;
    console.log('Gmail:',gmailAddress);
    if(!gmailAddress)return errPage('Could not get Gmail address: '+JSON.stringify(uInfo));
    const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
    const{error:dbErr}=await sb.from('gmail_accounts').upsert({user_id:userId,gmail_address:gmailAddress,access_token:tokens.access_token,refresh_token:tokens.refresh_token||null,updated_at:new Date().toISOString()},{onConflict:'user_id'});
    if(dbErr){console.error('DB:',dbErr);return errPage('Database error: '+dbErr.message);}
    const wRes=await fetch('https://www.googleapis.com/gmail/v1/users/me/watch',{method:'POST',headers:{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json'},body:JSON.stringify({topicName:process.env.PUBSUB_TOPIC,labelIds:['INBOX'],labelFilterBehavior:'include'})});
    const wData=await wRes.json();
    console.log('Watch:',JSON.stringify(wData));
    if(wData.error)console.error('Watch error (non-fatal):',wData.error.message);
    return res.status(200).send('<html><body style="font-family:sans-serif;background:#0f1117;color:#e2e8f0;padding:40px;text-align:center;max-width:480px;margin:0 auto"><div style="font-size:56px;margin-bottom:16px">&#10003;</div><h2 style="color:#97C459;margin-bottom:8px">Gmail connected!</h2><p style="color:#94a3b8;margin-bottom:6px">'+gmailAddress+'</p><p style="color:#64748b;font-size:13px;margin-bottom:28px">New Lead emails from LeadArena will appear in MParena automatically.</p><a href="https://mparena.vercel.app" style="background:#378ADD;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Open MParena &rarr;</a></body></html>');
  }catch(err){
    console.error('Callback fatal:',err.message);
    return res.status(500).send('<html><body style="font-family:sans-serif;background:#0f1117;color:#e2e8f0;padding:40px;text-align:center"><h2 style="color:#F09595">Error</h2><p>'+err.message+'</p><a href="https://mparena.vercel.app" style="color:#378ADD">&larr; Back</a></body></html>');
  }
};