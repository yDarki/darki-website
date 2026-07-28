// Admin-Panel - Seitenlogik (ausgelagert aus admin.html)
const API = '/api/admin';
const TOKKEY = 'donutAdminTok';
let CONFIG = {};
let CODES = [];
let openState = true;

function tok(){ try { return localStorage.getItem(TOKKEY) || ''; } catch(e){ return ''; } }
function setTok(t){ try { t ? localStorage.setItem(TOKKEY,t) : localStorage.removeItem(TOKKEY); } catch(e){} }

async function api(op, extra){
  const r = await fetch(API, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', ...(tok()?{'Authorization':'Bearer '+tok()}:{}) },
    body: JSON.stringify({ op, ...(extra||{}) })
  });
  let j = {};
  try { j = await r.json(); } catch(e){}
  if (r.status === 401 && op !== 'login'){ setTok(''); showLogin(); throw new Error('unauthorized'); }
  return { status:r.status, ...j };
}

function showLogin(){ document.getElementById('panelView').classList.add('hidden');
  document.getElementById('loginView').classList.remove('hidden'); }
function showPanel(){ document.getElementById('loginView').classList.add('hidden');
  document.getElementById('panelView').classList.remove('hidden'); }

function flash(id){ const e=document.getElementById(id); e.classList.add('show'); setTimeout(()=>e.classList.remove('show'),1600); }
function banner(msg, cls){ const b=document.getElementById('banner'); if(!msg){ b.className='banner'; b.textContent=''; return; }
  b.className='banner '+(cls||'warn'); b.textContent=msg; }

document.getElementById('loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const pw = document.getElementById('pw').value;
  const err = document.getElementById('loginErr');
  const btn = document.getElementById('loginBtn');
  err.textContent=''; btn.disabled=true; btn.textContent='…';
  try {
    const r = await api('login', { pw });
    if (r.ok && r.token){ setTok(r.token); document.getElementById('pw').value=''; await enterPanel(); }
    else if (r.error==='not-configured'){ err.textContent='ADMIN_PASSWORD is not set in Cloudflare yet.'; }
    else { err.textContent='Wrong password.'; }
  } catch(e){ err.textContent='Sign-in failed.'; }
  btn.disabled=false; btn.textContent='Sign in';
});

document.getElementById('logoutBtn').addEventListener('click', ()=>{ setTok(''); showLogin(); });

async function enterPanel(){
  showPanel(); banner('');
  const r = await api('getConfig');
  if (!r.ok){ banner('Could not load configuration.','err'); return; }
  CONFIG = r.config || {};
  fillConfig();
  loadAccess();
}

function fillConfig(){
  document.getElementById('price').value = CONFIG.price ?? 0;
  document.getElementById('days').value = CONFIG.durationDays ?? 14;
  document.getElementById('collector').value = CONFIG.collector ?? '';
  setPaywall(!CONFIG.open);
  document.getElementById('newDays').value = CONFIG.durationDays ?? 14;
  CODES = (Array.isArray(CONFIG.friendCodes) ? CONFIG.friendCodes : []).map(normCode);
  renderCodes();
  updatePriceHint();
  window.__cfgLoaded = true; // guard: only send 'open' once the real config is loaded
}
function normCode(it){
  if (typeof it === 'string') return { code: it };
  return { ...it, code: String((it&&it.code) || '').trim() };
}

function fmtInt(n){ return Number(n||0).toLocaleString('en-US'); }
function shortNum(n){ n=Number(n||0);
  if(n>=1e12) return (n/1e12).toFixed(n%1e12?1:0)+'T';
  if(n>=1e9) return (n/1e9).toFixed(n%1e9?1:0)+'B';
  if(n>=1e6) return (n/1e6).toFixed(n%1e6?1:0)+'M';
  if(n>=1e3) return (n/1e3).toFixed(n%1e3?1:0)+'k';
  return ''+n; }
function updatePriceHint(){ const v=Number(document.getElementById('price').value||0);
  document.getElementById('priceHint').textContent = '= '+fmtInt(v)+(v>=1000?'  ('+shortNum(v)+')':''); }
document.getElementById('price').addEventListener('input', updatePriceHint);

const payTog = document.getElementById('payTog');
payTog.addEventListener('click', ()=> setPaywall(!payTog.classList.contains('on')) );
function setPaywall(on){
  openState = !on;
  payTog.classList.toggle('on', on);
  payTog.querySelector('.tl').textContent = on ? 'Paywall ON — login/payment required' : 'Paywall OFF — site publicly accessible';
  document.getElementById('payHint').textContent = on
    ? 'Visitors are sent to the login / access page.'
    : 'Guests can view everything (tracking still needs login).';
}

function renderCodes(){
  const el = document.getElementById('codes');
  if (!CODES.length){ el.innerHTML = '<span class="empty">No codes.</span>'; return; }
  el.innerHTML = '';
  CODES.forEach((c,i)=>{
    const row = document.createElement('div'); row.className='coderow';
    const cc = document.createElement('span'); cc.className='cc'; cc.textContent = c.code;
    const sp = document.createElement('span'); sp.className='sp';
    const dur = document.createElement('span'); dur.className='dur';
    const di = document.createElement('input'); di.type='number'; di.min='1'; di.placeholder='global';
    if (c.durationDays != null) di.value = c.durationDays;
    di.oninput = ()=>{ const v=di.value.trim(); if(v==='') delete CODES[i].durationDays; else CODES[i].durationDays = Math.max(1, Math.floor(Number(v)||1)); };
    const dl = document.createElement('span'); dl.textContent='days';
    dur.append(di, dl);
    const usg = document.createElement('span'); usg.className='dur';
    const ui = document.createElement('input'); ui.type='number'; ui.min='1'; ui.placeholder='∞';
    ui.value = c.max || '';
    ui.oninput = ()=>{ const v=ui.value.trim(); if(v==='') delete CODES[i].max; else CODES[i].max = Math.max(1, Math.floor(Number(v)||1)); };
    const ul = document.createElement('span'); ul.textContent='uses';
    usg.append(ui, ul);
    const rs = document.createElement('button'); rs.className='rm'; rs.title='Reset usage counter'; rs.textContent='\u21ba';
    rs.onclick = async ()=>{ if(!c.code || !confirm('Reset usage counter for code "'+c.code+'"?')) return; rs.disabled=true; await api('resetUses',{code:c.code}); rs.disabled=false; };
    const rm = document.createElement('button'); rm.className='rm'; rm.title='Remove'; rm.textContent='×';
    rm.onclick = ()=>{ CODES.splice(i,1); renderCodes(); };
    row.append(cc, sp, dur, usg, rs, rm);
    el.appendChild(row);
  });
}
function addCode(){
  const inp = document.getElementById('newCode');
  const di = document.getElementById('newDays');
  const v = inp.value.trim();
  if (v && !CODES.some(c=>c.code.toLowerCase()===v.toLowerCase())){
    const o = { code: v };
    const d = di.value.trim();
    if (d !== '') o.durationDays = Math.max(1, Math.floor(Number(d)||1));
    const mi = document.getElementById('newMax'), m = mi ? mi.value.trim() : '';
    if (m !== '') o.max = Math.max(1, Math.floor(Number(m)||1));
    CODES.push(o);
  }
  inp.value=''; { const _m=document.getElementById('newMax'); if(_m) _m.value=''; } renderCodes(); inp.focus();
}
function genCode(){
  const A='ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s='';
  for(let i=0;i<6;i++) s+=A[Math.floor(Math.random()*A.length)];
  if(!CODES.some(c=>c.code===s)){
    const di=document.getElementById('newDays'); const d=di.value.trim();
    const o={ code:s }; if(d!=='') o.durationDays=Math.max(1,Math.floor(Number(d)||1));
    const mi=document.getElementById('newMax'), m=mi?mi.value.trim():''; if(m!=='') o.max=Math.max(1,Math.floor(Number(m)||1));
    CODES.push(o);
  }
  renderCodes();
}

async function saveConfig(patch, savedId, btn){
  btn.disabled=true;
  const r = await api('setConfig', { config: patch });
  btn.disabled=false;
  if (r.ok){ CONFIG = r.config || CONFIG; flash(savedId); }
  else banner('Save failed.','err');
}
document.getElementById('saveAccess').onclick = function(){
  saveConfig({
    price: Number(document.getElementById('price').value||0),
    durationDays: Number(document.getElementById('days').value||1),
    open: openState
  }, 'savedAccess', this);
};
document.getElementById('saveCollector').onclick = function(){
  saveConfig({ collector: document.getElementById('collector').value.trim() }, 'savedCollector', this);
};
document.getElementById('saveCodes').onclick = function(){
  saveConfig({ friendCodes: CODES }, 'savedCodes', this);
};
// ---- single Save-all + propagation timer ----
function collectAllConfig(){
  return {
    price: Number(document.getElementById('price').value||0),
    durationDays: Number(document.getElementById('days').value||1),
    collector: document.getElementById('collector').value.trim(),
    open: (window.__cfgLoaded && typeof openState === 'boolean') ? openState : undefined,
    friendCodes: CODES
  };
}
// Measures how long a saved change needs until the PUBLIC site actually serves it (KV propagation).
function trackPropagation(want, t0){
  var el=document.getElementById('propState'); if(!el) return;
  var done=false, timer=null, poll=null;
  function put(txt,cls){ el.textContent=txt; el.className='prop'+(cls?(' '+cls):''); }
  function secs(){ return (Date.now()-t0)/1000; }
  function stop(txt,cls){ done=true; clearInterval(timer); clearInterval(poll); put(txt,cls); }
  function matches(pub){
    if(!pub) return false;
    if(Number(pub.price)!==Number(want.price)) return false;
    if(Number(pub.durationDays)!==Number(want.durationDays)) return false;
    if(String(pub.collector||'')!==String(want.collector||'')) return false;
    if(Boolean(pub.open)!==Boolean(want.open)) return false;
    return true;
  }
  put('Applying\u2026 0.0s');
  timer=setInterval(function(){ if(!done) put('Applying\u2026 '+secs().toFixed(1)+'s'); },100);
  poll=setInterval(function(){
    fetch('/api/access?config&_='+Date.now(),{cache:'no-store'}).then(function(r){return r.json();}).then(function(pub){
      if(done) return;
      if(matches(pub)) stop('Live on site after '+secs().toFixed(1)+'s','ok');
      else if(secs()>120) stop('Still propagating after 120s','warn');
    }).catch(function(){});
  },1000);
}
(function(){
  var sb=document.getElementById('saveAll');
  if(sb) sb.onclick=async function(){
    sb.disabled=true;
    var want=collectAllConfig();
    var t0=Date.now();
    var r=await api('setConfig',{ config: want });
    sb.disabled=false;
    if(r && r.ok){ CONFIG=r.config||CONFIG; flash('savedAll'); trackPropagation(want,t0); }
    else banner('Save failed.','err');
  };
})();

function fmtExp(ts){
  if(!ts) return 'no expiry stored';
  const d=new Date(ts), now=Date.now();
  const days=Math.floor((ts-now)/86400000);
  const date=d.toLocaleDateString('en-US');
  if(ts<now) return 'expired · '+date;
  return 'expires in '+days+'d · '+date;
}
async function loadAccess(){
  const box=document.getElementById('alist');
  box.innerHTML='<div class="amuted">Loading…</div>';
  const r = await api('listAccess');
  if(!r.ok){ box.innerHTML='<div class="amuted">Could not load.</div>'; return; }
  const list=r.access||[];
  document.getElementById('accessCount').textContent = list.length+' with access';
  if(!list.length){ box.innerHTML='<div class="amuted">Nobody currently has access.</div>'; return; }
  box.innerHTML='';
  list.forEach(a=>{
    const row=document.createElement('div'); row.className='arow';
    const img=document.createElement('img'); img.src='https://minotar.net/helm/'+encodeURIComponent(a.ign)+'/26.png'; img.alt='';
    const info=document.createElement('div');
    info.innerHTML='<div class="ign"></div><div class="exp"></div>';
    info.querySelector('.ign').textContent=a.ign;
    info.querySelector('.exp').textContent=fmtExp(a.expires);
    const sp=document.createElement('span'); sp.className='sp';
    const btn=document.createElement('button'); btn.className='btn sm danger'; btn.textContent='Revoke';
    btn.onclick=()=>revoke(a.ign, btn);
    row.append(img,info,sp,btn);
    box.appendChild(row);
  });
}
async function revoke(ign, btn){
  if(!confirm('Really revoke access for "'+ign+'"?')) return;
  btn.disabled=true; btn.textContent='…';
  const r = await api('revoke', { ign });
  if(r.ok) loadAccess();
  else { btn.disabled=false; btn.textContent='Revoke'; banner('Revoke failed.','err'); }
}
document.getElementById('reloadAccess').onclick = loadAccess;

(async function(){
  if (tok()){
    try { const r = await api('session'); if (r.ok){ await enterPanel(); return; } } catch(e){}
  }
  showLogin();
})();

if ('serviceWorker' in navigator){
  window.addEventListener('load', ()=> navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
