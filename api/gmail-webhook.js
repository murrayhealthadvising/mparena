const{createClient}=require('@supabase/supabase-js');
const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY=process.env.SUPABASE_SERVICE_KEY;
const KNOWN=['First Name','Last Name','Primary Phone','Email','State','Zip','Age Range','Age','Income','Household','DOB','Date of Birth','Comments','Name','Price','Lead Id','Poverty Level','Gender','Height','Weight','Smoker','Address','City','Business Name','Secondary Phone','Alternate Phone','Other Emails','All Emails','All Phones','Current Carrier','Best Contact Time','Text Response','Lead Date','Comments','Plan Choice','Number Of Children','Spouse Age','employees','businessName','Biz Verify Report','agentID'];
function parse(raw){
  const pat=KNOWN.map(f=>f.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+':').join('|');
  const get=label=>{const esc=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const m=raw.match(new RegExp(esc+':([^:]+?)(?='+pat+'|$)','i'));return m?m[1].trim():'';};
  const pm=raw.match(/Price:\s*\$?([\d.]+)/i);
  return{firstName:get('First Name'),lastName:get('Last Name'),phone:get('Primary Phone'),email:get('Email'),state:get('State'),zip:get('Zip'),age:get('Age'),ageRange:get('Age Range'),income:get('Income'),household:get('Household'),dob:get('DOB')||get('Date of Birth'),comments:get('Comments'),campaign:get('Name'),price:pm?pm[1]:get('Price'),leadId:get('Lead Id')};
}
async function refresh(acct){
  if(!acct.refresh_token)return acct.access_token;
  try{
    const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:process.env.GOOGLE_OAUTH_CLIENT_ID,client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET,refresh_token:acct.refresh_token,grant_type:'refresh_token'})});
    const d=await r.json();
    if(d.access_token){const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY);await sb.from('gmail_accounts').update({access_token:d.access_token,updated_at:new Date().toISOString()}).eq('user_id',acct.user_id);return d.access_token;}
  }catch(e){console.error('refresh err:',e.message);}
  return acct.access_token;
}
module.exports=async(req,res)=>{
  if(req.method!=='POST')return res.status(405).end();
  try{
    const{message}=req.body||{};
    if(!message||!message.data)return res.status(200).json({ok:true});
    const decoded=JSON.parse(Buffer.from(message.data,'base64').toString());
    const emailAddress=decoded.emailAddress;
    const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY);
    const{data:accounts}=await sb.from('gmail_accounts').select('*').eq('gmail_address',emailAddress);
    if(!accounts||!accounts.length)return res.status(200).json({ok:true,msg:'no account'});
    const acct=accounts[0];
    const tok=await refresh(acct);
    const q=encodeURIComponent('from:leads@ushamarketplace.com subject:"New Lead" is:unread');
    const lr=await fetch('https://www.googleapis.com/gmail/v1/users/me/messages?q='+q+'&maxResults=20',{headers:{Authorization:'Bearer '+tok}});
    const ld=await lr.json();
    const msgs=ld.messages||[];
    console.log('LeadArena emails found:',msgs.length);
    let saved=0;
    for(const msg of msgs){
      const{data:ex}=await sb.from('leads').select('id').eq('email_message_id',msg.id).limit(1);
      if(ex&&ex.length)continue;
      const mr=await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/'+msg.id+'?format=full',{headers:{Authorization:'Bearer '+tok}});
      const full=await mr.json();
      const hdrs=full.payload&&full.payload.headers||[];
      const from=hdrs.find(h=>h.name.toLowerCase()==='from');
      const subj=hdrs.find(h=>h.name.toLowerCase()==='subject');
      if(!from||!from.value.includes('leads@ushamarketplace.com'))continue;
      if(!subj||!subj.value.toLowerCase().includes('new lead'))continue;
      const parts=full.payload&&full.payload.parts||[];
      const bd=full.payload&&full.payload.body;
      let text='';
      if(bd&&bd.data)text=Buffer.from(bd.data,'base64').toString();
      for(const p of parts){if(p.mimeType==='text/plain'&&p.body&&p.body.data){text=Buffer.from(p.body.data,'base64').toString();break;}}
      if(!text){for(const p of parts){if(p.mimeType==='text/html'&&p.body&&p.body.data){text=Buffer.from(p.body.data,'base64').toString().replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ');break;}}}
      if(!text)continue;
      const p=parse(text);
      if(!p.firstName&&!p.phone)continue;
      console.log('Saving lead:',p.firstName,p.lastName,p.phone);
      const{error}=await sb.from('leads').insert({id:require('crypto').randomUUID(),user_id:acct.user_id,first_name:p.firstName,last_name:p.lastName,phone:p.phone,email:p.email,state:p.state,zip:p.zip,age:p.age,age_range:p.ageRange,income:p.income,household:p.household,dob:p.dob,comments:p.comments,campaign:p.campaign,price:p.price,lead_id:p.leadId,received_at:new Date().toISOString(),disposition:'new',notes:'',custom_disp:'["new"]',email_message_id:msg.id});
      if(!error){saved++;await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/'+msg.id+'/modify',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({removeLabelIds:['UNREAD']})});}
      else{console.error('insert err:',error.message);}
    }
    return res.status(200).json({ok:true,saved});
  }catch(e){console.error('webhook err:',e.message);return res.status(200).json({ok:true,error:e.message});}
};