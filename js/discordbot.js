// Discord-Bot-Seite - Seitenlogik (ausgelagert aus discordbot.html)
const API = '/api/discord';
  const ITEMS = ['netherite_ingot','netherite_scrap','netherite_block','enchanted_golden_apple','elytra','dragon_head'];
  const app = document.getElementById('app');
  const KEY = 'dcPairCode';

  function makeCode(){ var a='ABCDEFGHJKMNPQRSTUVWXYZ23456789', s=''; for(var i=0;i<6;i++) s+=a[Math.floor(Math.random()*a.length)]; return s; }
  function getCode(){ var c=localStorage.getItem(KEY); if(!c){ c=makeCode(); localStorage.setItem(KEY,c); } return c; }
  function pretty(id){ return id.replace(/_/g,' ').replace(/\b\w/g,function(m){return m.toUpperCase();}); }
  function abbr(n){ n=+n; var a=Math.abs(n); if(a>=1e9)return (n/1e9).toFixed(2)+'B'; if(a>=1e6)return (n/1e6).toFixed(2)+'M'; if(a>=1e3)return (n/1e3).toFixed(1)+'k'; return String(Math.round(n)); }
  function parseAmt(s){ s=String(s).trim().toLowerCase().replace(/[, ]/g,''); var m=s.match(/^([0-9]*\.?[0-9]+)([kmb])?$/); if(!m) return 0; var v=parseFloat(m[1]); if(m[2]==='k')v*=1e3; if(m[2]==='m')v*=1e6; if(m[2]==='b')v*=1e9; return Math.round(v); }

  const code = getCode();
  let alerts = [];

  // ---- LINKING VIEW ----
  function renderLink(){
    var masked = '••••••';
    app.innerHTML =
      '<div class="steps">'+
        '<div class="step"><div class="n">1</div><div class="tx">Add the bot to your Discord account — this lets you use its commands anywhere in Discord. No server needed.'+
          '<div class="codebox"><a class="btn" id="install" target="_blank" rel="noopener">Add bot to Discord</a></div></div></div>'+
        '<div class="step"><div class="n">2</div><div class="tx">Type <b>/link</b> in any Discord chat, then paste your code into the box that appears:'+
          '<div class="codebox"><span class="cmd"><span id="cmdcode">'+masked+'</span></span><button class="btn ghost reveal" id="reveal">Reveal</button><button class="btn reveal" id="copy">Copy code</button></div>'+
          '<small>Only the code goes into the command — not the whole line. Keep it private.</small></div></div>'+
        '<div class="step"><div class="n">3</div><div class="tx">This page updates automatically once you\'re linked.'+
          '<div class="linkstate"><span class="pulse"></span><span id="wait">Waiting for you to link…</span></div></div></div>'+
      '</div>'+
      '<div class="hint" style="margin-top:18px">It can take a few seconds &mdash; sometimes up to a minute &mdash; after you run <b>/link</b> before this page connects to the bot. It refreshes on its own, so just leave it open.</div>'+
      '<div class="helper">Prefer a server? <a id="invite" target="_blank" rel="noopener">Add the bot to a server &rarr;</a> instead (optional).</div>';
    var ins = document.getElementById('install');
    if(ins) ins.href = 'https://discord.com/oauth2/authorize?client_id=1524403907550249161&integration_type=1&scope=applications.commands';
    var inv = document.getElementById('invite');
    if(inv) inv.href = 'https://discord.com/oauth2/authorize?client_id=1524403907550249161&scope=bot+applications.commands&permissions=2048';
    var revealed = false;
    var cc = document.getElementById('cmdcode');
    var rbtn = document.getElementById('reveal');
    rbtn.onclick = function(){ revealed = !revealed; cc.textContent = revealed ? code : masked; rbtn.textContent = revealed ? 'Hide' : 'Reveal'; };
    var copyBtn = document.getElementById('copy');
    copyBtn.onclick = function(){
      try{ navigator.clipboard.writeText(code).then(function(){ copyBtn.textContent='Copied!'; setTimeout(function(){copyBtn.textContent='Copy code';},1500); }); }
      catch(e){ revealed=true; cc.textContent=code; rbtn.textContent='Hide'; }
    };
  }

  // ---- OVERVIEW VIEW ----
  function alertRow(a){
    a = a || { id:'', item:ITEMS[0], dir:'below', amount:0, dest:'dm', channelId:'' };
    var el = document.createElement('div'); el.className='alert'; el.dataset.id=a.id||'';
    var opts = ITEMS.map(function(it){ return '<option value="'+it+'"'+(it===a.item?' selected':'')+'>'+pretty(it)+'</option>'; }).join('');
    el.innerHTML =
      '<div class="line" style="flex-direction:column;align-items:stretch;gap:12px">'+
        '<div class="line">'+
          '<div class="fld"><label>Item</label><select class="item">'+opts+'</select></div>'+
          '<div class="fld"><label>When price is</label><div><button class="seg dir'+(a.dir==='below'?' on':'')+'" data-dir="below">Below</button> <button class="seg dir'+(a.dir==='above'?' on':'')+'" data-dir="above">Above</button></div></div>'+
          '<div class="fld"><label>Amount ($)</label><input class="num" value="'+(a.amount?a.amount:'')+'" placeholder="e.g. 1M or 50000"></div>'+
        '</div>'+
        '<div class="line">'+
          '<div class="fld"><label>Notify via</label><div><button class="seg dest'+(a.dest==='dm'?' on':'')+'" data-dest="dm">DM</button> <button class="seg dest'+(a.dest==='channel'?' on':'')+'" data-dest="channel">Channel</button></div></div>'+
          '<div class="fld chanwrap'+(a.dest==='channel'?' show':'')+'"><label>Channel ID</label><input class="chan" value="'+(a.channelId||'')+'" placeholder="right-click channel &rarr; Copy ID"></div>'+
        '</div>'+
      '</div>'+
      '<button class="rm" title="Remove">&times;</button>';
    el.querySelectorAll('.dir').forEach(function(b){ b.onclick=function(){ el.querySelectorAll('.dir').forEach(function(x){x.classList.remove('on');}); b.classList.add('on'); }; });
    el.querySelectorAll('.dest').forEach(function(b){ b.onclick=function(){ el.querySelectorAll('.dest').forEach(function(x){x.classList.remove('on');}); b.classList.add('on'); el.querySelector('.chanwrap').classList.toggle('show', b.dataset.dest==='channel'); }; });
    el.querySelector('.rm').onclick=function(){ el.remove(); };
    return el;
  }

  function renderOverview(username){
    var initial=(username||'D').charAt(0).toUpperCase();
    app.innerHTML =
      '<div class="linked"><div class="ava">'+initial+'</div><div><div class="nm">'+username+'</div><div class="st">Linked &middot; alerts will be sent to you</div></div><span class="unlink" id="unlink">unlink</span></div>'+
      '<div class="rowhead"><h2>Your alerts</h2><button class="btn ghost" id="add">+ Add alert</button></div>'+
      '<div id="list"></div>'+
      '<div class="foot"><button class="btn" id="save">Save alerts</button><span class="saved-note" id="note">Saved &check;</span></div>'+
      '<div class="hint">Prices are checked every few minutes. You get one ping when an item crosses your threshold; it re-arms once the price crosses back. For <b>Channel</b> alerts, enable Discord Developer Mode (Settings &rarr; Advanced), then right-click a channel &rarr; Copy Channel ID — and make sure the bot can post there.</div>';

    var list=document.getElementById('list');
    function draw(){ list.innerHTML=''; (alerts.length?alerts:[null]).forEach(function(a){ list.appendChild(alertRow(a)); }); }
    draw();
    document.getElementById('add').onclick=function(){ list.appendChild(alertRow(null)); };
    document.getElementById('unlink').onclick=function(){
      if(!confirm('Unlink this Discord? Use /unlink in Discord to fully remove it. This clears the code from this browser.')) return;
      localStorage.removeItem(KEY); location.reload();
    };
    document.getElementById('save').onclick=function(){ save(list); };
  }

  function collect(list){
    var out=[];
    list.querySelectorAll('.alert').forEach(function(el){
      var amount=parseAmt(el.querySelector('.num').value);
      if(!amount) return;
      out.push({
        id: el.dataset.id||undefined,
        item: el.querySelector('.item').value,
        dir: el.querySelector('.dir.on').dataset.dir,
        amount: amount,
        dest: el.querySelector('.dest.on').dataset.dest,
        channelId: el.querySelector('.chan').value.trim()
      });
    });
    return out;
  }

  async function save(list){
    var btn=document.getElementById('save'); btn.disabled=true; btn.textContent='Saving…';
    try{
      var payload=collect(list);
      var r=await fetch(API+'?alerts='+encodeURIComponent(code),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({alerts:payload})});
      var j=await r.json();
      if(j&&j.alerts){ alerts=j.alerts; var n=document.getElementById('note'); n.classList.add('show'); setTimeout(function(){n.classList.remove('show');},2000); }
      else alert('Could not save: '+(j&&j.error||'unknown'));
    }catch(e){ alert('Error: '+e.message); }
    finally{ btn.disabled=false; btn.textContent='Save alerts'; }
  }

  // ---- boot: poll link status ----
  let polling=null, linkedShown=false;
  async function checkStatus(first){
    try{
      var r=await fetch(API+'?status='+encodeURIComponent(code)); var j=await r.json();
      if(j&&j.linked){
        if(linkedShown) return;
        linkedShown=true; if(polling){clearInterval(polling);polling=null;}
        try{ var ar=await fetch(API+'?alerts='+encodeURIComponent(code)); var aj=await ar.json(); alerts=(aj&&aj.alerts)||[]; }catch(e){}
        renderOverview(j.username||'Discord user');
      } else if(first){ renderLink(); if(!polling) polling=setInterval(function(){checkStatus(false);},4000); }
    }catch(e){ if(first){ renderLink(); if(!polling) polling=setInterval(function(){checkStatus(false);},4000); } }
  }
  checkStatus(true);
