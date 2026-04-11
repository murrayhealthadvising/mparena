// bucket.js v2 — High Priority tab + Auto Dialer with visibility-based flow

var BX = {sold:1,pitched:1,badnum:1,notinterested:1,appointment:1};
var BAF = {new:1,callback:1,noanswer:1,missedapt:1,pr:1,quoted:1,ghost:1};
var dialerQueue = [];
var dialerIdx = 0;
var dialerActive = false;
var dialerWaiting = false; // true when waiting for user to return after call
var bktNoteTimers = {};

// ── Tab switching ─────────────────────────────────────────────────────
function switchMainTab(name) {
  var tba=document.getElementById('tba'), tbb=document.getElementById('tbb');
  var pa=document.getElementById('pane-all'), pb=document.getElementById('pane-bucket');
  if(tba) tba.classList.toggle('active', name==='all');
  if(tbb) tbb.classList.toggle('active', name==='bucket');
  if(pa)  pa.classList.toggle('active',  name==='all');
  if(pb)  pb.classList.toggle('active',  name==='bucket');
  if(name==='bucket') renderBkt();
}

// ── Pill filter toggle ────────────────────────────────────────────────
function togBkt(el) {
  var tag = el.getAttribute('data-bk');
  if(BAF[tag]) { delete BAF[tag]; el.classList.add('off'); }
  else         { BAF[tag]=1;      el.classList.remove('off'); }
  renderBkt();
}

// ── Lead qualification ────────────────────────────────────────────────
function bktKeys(l) {
  var d=l.disposition||'new', k=[];
  if(!BX[d] && (d==='new'||d==='callback'||d==='noanswer'||d==='missedapt')) k.push(d);
  var txt = ((l.tags||[d]).join(' ')+' '+(l.customText||'')).toLowerCase();
  if(txt.indexOf('pr')!==-1||txt.indexOf('positive')!==-1) k.push('pr');
  if(txt.indexOf('quot')!==-1) k.push('quoted');
  if(txt.indexOf('ghost')!==-1) k.push('ghost');
  return k;
}

function bktLeads() {
  var cut = Date.now()-7*24*60*60*1000;
  return leads.filter(function(l) {
    if(!l.receivedAt||new Date(l.receivedAt).getTime()<cut) return false;
    if(BX[l.disposition]) return false;
    return bktKeys(l).some(function(k) { return BAF[k]; });
  }).sort(function(a,b) { return new Date(b.receivedAt)-new Date(a.receivedAt); });
}

function bktAge(iso) {
  var ms=Date.now()-new Date(iso).getTime(), h=ms/3600000, d=ms/86400000;
  if(h<24) return ['Today','age-g'];
  if(d<2)  return ['Yesterday','age-y'];
  if(d<4)  return [Math.floor(d)+'d ago','age-y'];
  return [Math.floor(d)+'d ago','age-r'];
}

// ── Notes ─────────────────────────────────────────────────────────────
function bktSaveNote(id) {
  var ta=document.getElementById('bkt-note-'+id);
  if(!ta) return;
  var l=leads.find(function(x){return x.id===id;});
  if(!l) return;
  l.notes=ta.value;
  clearTimeout(bktNoteTimers[id]);
  var ind=document.getElementById('bkt-saved-'+id);
  if(ind) ind.textContent='';
  bktNoteTimers[id]=setTimeout(function(){
    if(typeof updateField==='function') updateField(id,{notes:l.notes});
    if(ind){ind.textContent='Saved \u2713';setTimeout(function(){if(ind)ind.textContent='';},2000);}
  },800);
  // Sync to dialer notes if this is the active lead
  if(dialerActive&&dialerIdx<dialerQueue.length&&dialerQueue[dialerIdx].id===id){
    var dlN=document.getElementById('dl-notes');
    if(dlN&&dlN.value!==ta.value) dlN.value=ta.value;
  }
}

function dlNoteSave() {
  if(!dialerActive||dialerIdx>=dialerQueue.length) return;
  var l=dialerQueue[dialerIdx];
  var dlN=document.getElementById('dl-notes');
  if(!dlN) return;
  l.notes=dlN.value;
  clearTimeout(bktNoteTimers['dl']);
  bktNoteTimers['dl']=setTimeout(function(){
    if(typeof updateField==='function') updateField(l.id,{notes:l.notes});
    var ta=document.getElementById('bkt-note-'+l.id);
    if(ta) ta.value=l.notes;
  },800);
}

// ── Render ────────────────────────────────────────────────────────────
var TC = {
  new:'color:#94a3b8;background:#1a2133', callback:'color:#85B7EB;background:#042C53',
  noanswer:'color:#EF9F27;background:#2a1f08', missedapt:'color:#ED93B1;background:#2a0f1c',
  pr:'color:#5DCAA5;background:#04342C', quoted:'color:#AFA9EC;background:#1a1540',
  ghost:'color:#F0997B;background:#2d1508'
};
var TL = {new:'New',callback:'Call back',noanswer:'No answer',missedapt:'Missed apt',
  pr:'PR \u2713',quoted:'Quoted',ghost:'Ghost'};

function renderBkt() {
  var list=document.getElementById('bkt-list');
  if(!list) return;
  var bl=bktLeads();
  var bcl=document.getElementById('bcl'); if(bcl) bcl.textContent=bl.length+(bl.length!==1?' leads':' lead');
  var tcb=document.getElementById('tcb'); if(tcb) tcb.textContent=bl.length;
  if(!bl.length) {
    list.innerHTML='<div class="bkt-empty">No high priority leads in the last 7 days.<br><span style="font-size:12px;color:#475569">Leads with New, Call back, No answer, or Missed apt dispositions appear here.</span></div>';
    return;
  }
  var rows=[];
  for(var i=0;i<bl.length;i++) {
    var l=bl[i], age=bktAge(l.receivedAt), keys=bktKeys(l);
    var isDial=dialerActive&&dialerIdx<dialerQueue.length&&dialerQueue[dialerIdx].id===l.id;
    var ph=(l.phone||'').replace(/[^0-9]/g,'');
    var fn=l.firstName||'', ln=l.lastName||'';
    var tagHtml='';
    for(var k=0;k<keys.length;k++) {
      tagHtml+='<span style="padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;'+TC[keys[k]]+'">'+TL[keys[k]]+'</span> ';
    }
    var noteVal=(l.notes||'').replace(/"/g,'&quot;');
    rows.push(
      '<div class="pc'+(isDial?' dialing':'')+'" id="pc-'+l.id+'">'
      +'<div class="lead-avatar">'+initials(fn+' '+ln)+'</div>'
      +'<div class="pc-body">'
        +'<div class="pc-name">'+fn+' '+ln+'</div>'
        +'<button class="lead-phone" onclick="copyPhone(\''+l.phone+'\')">'+formatPhone(l.phone)+' <span class="copy-hint">copy</span></button>'
        +'<div class="pc-meta">'+(l.state||'')+(l.household?' \u00b7 '+l.household:'')+(l.income?' \u00b7 '+l.income:'')+(l.price?' \u00b7 $'+l.price+' lead':'')+'</div>'
        +'<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px">'+tagHtml+'</div>'
        +'<textarea id="bkt-note-'+l.id+'" placeholder="Call notes..." oninput="bktSaveNote(\''+l.id+'\')" style="margin-top:10px;width:100%;background:#1a2133;border:1px solid #2a3347;border-radius:8px;color:#e2e8f0;padding:8px 10px;font-size:12px;resize:vertical;min-height:60px;outline:none;line-height:1.5;font-family:inherit">'+noteVal+'</textarea>'
        +'<div id="bkt-saved-'+l.id+'" style="font-size:10px;color:#639922;height:14px"></div>'
      +'</div>'
      +'<div class="pc-r">'
        +'<div class="'+age[1]+'">'+age[0]+'</div>'
        +(l.price?'<div class="lead-cost">$'+l.price+' lead</div>':'')
        +'<a class="btn-call" href="tel:'+ph+'" style="padding:6px 14px;font-size:12px">'
          +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
            +'<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012 .18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>'
          +'</svg>Call</a>'
      +'</div>'
      +'</div>'
    );
  }
  list.innerHTML=rows.join('');
}

function updTC() {
  var ta=document.getElementById('tca'); if(ta) ta.textContent=leads.length;
  var bl=bktLeads();
  var tb=document.getElementById('tcb'); if(tb) tb.textContent=bl.length;
  var bcl=document.getElementById('bcl'); if(bcl) bcl.textContent=bl.length+(bl.length!==1?' leads':' lead');
}

// ── Auto Dialer ───────────────────────────────────────────────────────
function dialerSetState(state) {
  // state: 'ready' or 'logging'
  var ready=document.getElementById('dl-ready');
  var logging=document.getElementById('dl-logging');
  if(!ready||!logging) return;
  if(state==='ready') {
    ready.style.display='flex';
    logging.style.display='none';
  } else {
    ready.style.display='none';
    logging.style.display='flex';
  }
}

// visibilitychange: when user comes back from phone app
function onVisibilityReturn() {
  if(document.hidden) return;
  if(!dialerActive||!dialerWaiting) return;
  dialerWaiting=false;
  // Switch dialer bar to logging mode
  dialerSetState('logging');
}

document.addEventListener('visibilitychange', onVisibilityReturn);

function startDialer() {
  dialerQueue=bktLeads();
  if(!dialerQueue.length) { alert('No leads in High Priority queue.'); return; }
  dialerIdx=0; dialerActive=true; dialerWaiting=false;
  document.getElementById('dialer-bar').classList.add('active');
  dialerSetState('ready');
  dialerLoad();
  renderBkt();
  // Switch to bucket tab if not already there
  switchMainTab('bucket');
}

function dialerLoad() {
  if(dialerIdx>=dialerQueue.length) { stopDialer(); return; }
  var l=dialerQueue[dialerIdx], ph=(l.phone||'').replace(/[^0-9]/g,'');
  document.getElementById('dl-name').textContent=(l.firstName||'')+' '+(l.lastName||'');
  document.getElementById('dl-sub').textContent=formatPhone(l.phone)+(l.state?' \u00b7 '+l.state:'')+(l.income?' \u00b7 '+l.income:'')+(l.price?' \u00b7 $'+l.price+' lead':'');
  document.getElementById('dl-prog').textContent=(dialerIdx+1)+' / '+dialerQueue.length;
  var btn=document.getElementById('dl-call-btn'); if(btn) btn.href='tel:'+ph;
  var dlN=document.getElementById('dl-notes'); if(dlN) { dlN.value=l.notes||''; dlN.placeholder='Notes for '+(l.firstName||'this lead')+'...'; }
  var card=document.getElementById('pc-'+l.id); if(card) card.scrollIntoView({behavior:'smooth',block:'center'});
  dialerSetState('ready');
  renderBkt();
}

function dialerCall(e) {
  // Called when user taps the Call button
  // Mark as waiting so visibilitychange knows to show logging UI
  dialerWaiting=true;
  // Let the href do its thing (opens dialer)
}

function callLog(disp) {
  // Log disposition and auto-advance to next lead
  if(dialerActive&&dialerIdx<dialerQueue.length&&disp) {
    var l=dialerQueue[dialerIdx];
    l.disposition=disp;
    if(typeof updateStats==='function') updateStats();
    if(typeof updateField==='function') updateField(l.id,{disposition:disp});
  }
  // Advance
  dialerIdx++;
  if(dialerIdx>=dialerQueue.length) {
    stopDialer();
    alert('Done! You\'ve gone through all '+dialerQueue.length+' leads.');
    return;
  }
  dialerLoad();
  // Auto-dial next lead after a brief moment
  setTimeout(function(){
    var btn=document.getElementById('dl-call-btn');
    if(btn&&btn.href&&btn.href!=='#') {
      dialerWaiting=true;
      window.location.href=btn.href;
    }
  }, 800);
}

function stopDialer() {
  dialerActive=false; dialerWaiting=false;
  dialerQueue=[]; dialerIdx=0;
  var bar=document.getElementById('dialer-bar'); if(bar) bar.classList.remove('active');
  renderBkt();
}
