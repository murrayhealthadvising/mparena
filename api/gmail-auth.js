const{google}=require('googleapis');
const REDIRECT_URI='https://mparena.vercel.app/api/gmail-callback';
module.exports=async(req,res)=>{
  const oauth2Client=new google.auth.OAuth2(process.env.GOOGLE_OAUTH_CLIENT_ID,process.env.GOOGLE_OAUTH_CLIENT_SECRET,REDIRECT_URI);
  const authUrl=oauth2Client.generateAuthUrl({
    access_type:'offline',
    scope:[
      'openid',
      'email',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
    prompt:'consent',
    state:req.query.userId||''
  });
  res.redirect(authUrl);
};