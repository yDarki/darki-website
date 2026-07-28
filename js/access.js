// Access - Seitenlogik (ausgelagert aus access.html)
var API='/api/access', KEY='acToken';
  var app=document.getElementById('app');
  function mk(){ var a='abcdefghijklmnopqrstuvwxyz0123456789', s=''; for(var i=0;i<24;i++) s+=a[Math.floor(Math.random()*a.length)]; return s; }
  function token(){ var t=localStorage.getItem(KEY); if(!t){ t=mk(); localStorage.setItem(KEY,t); } return t; }
  function abbr(n){ n=+n; if(n>=1e12)return (n/1e12)+'T'; if(n>=1e9)return (n/1e9)+'B'; if(n>=1e6)return (n/1e6)+'M'; if(n>=1e3)return (n/1e3)+'k'; return String(n); }
  function num(n){ return Math.round(+n).toLocaleString('en-US'); }
  function fmtDate(ms){ try{ return new Date(ms).toLocaleDateString('en-US',{day:'2-digit',month:'2-digit',year:'numeric'}); }catch(e){ return ''; } }
  var TK=token();

  function renderGranted(j){
    var friend=j.friend?' (friend access)':'';
    app.innerHTML='<div class="granted">'+
      '<div class="check"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#5bd99a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>'+
      '<p class="ok" style="margin-top:14px;font-size:16px">You have access'+friend+'.</p>'+
      '<p class="note" style="margin-top:4px">'+(j.already?'Code already redeemed \u2014 you already have access.':(j.friend?'Unlocked permanently.':'Valid until <b>'+fmtDate(j.expires)+'</b>.'))+'</p>'+
      '<div class="row" style="justify-content:center;margin-top:18px"><a class="btn" href="index.html">Go to the site &rarr;</a></div></div>';
  }

  function renderUnlock(cfg){
    app.innerHTML=
      '<div id="offbanner"></div>'+
      '<div class="step"><label>Your Minecraft name</label>'+
        '<div class="row"><input id="ign" placeholder="Minecraft name" autocomplete="off"></div></div>'+
      '<hr class="sep">'+
      '<div class="frow"><span class="flabel">Pay</span><span class="pill mono">/pay '+cfg.collector+' '+cfg.price+'</span></div>'+
      '<div class="fhint">Pay <b>'+abbr(cfg.price)+'</b> ('+num(cfg.price)+' $) in-game for '+cfg.durationDays+' days &mdash; or use a friend code.</div>'+
      '<div class="frow"><span class="flabel">Code</span><input id="code" placeholder="Friend code (optional)" autocomplete="off"></div>'+
      '<div class="row" style="justify-content:center;margin-top:16px"><button class="btn" id="submit">Submit</button></div>'+
      '<div class="err" id="err1"></div><div class="err" id="err2"></div>';

    var offb=document.getElementById('offbanner');
    async function checkOnline(){
      var ps=document.getElementById('paystep');
      try {
        var r=await fetch(API+'?online=1'); var j=await r.json();
        if(j && j.online===false){
          offb.innerHTML='<div style="background:rgba(255,90,90,.10);border:1px solid rgba(255,90,90,.4);color:#ff9b9b;border-radius:12px;padding:12px 14px;margin-bottom:18px;font-size:13.5px;line-height:1.55"><b>Do not pay right now.</b><br>'+(j.collector||'The account')+' is offline and cannot process payments. Wait until they are back online &mdash; otherwise your payment cannot be matched to you.</div>';
          if(ps) ps.style.display='none';
        } else {
          offb.innerHTML=''; if(ps) ps.style.display='';
        }
      } catch(e){ offb.innerHTML=''; if(ps) ps.style.display=''; }
    }
    checkOnline();

    var claimBtn=document.getElementById('submit'), ignEl=document.getElementById('ign'), err1=document.getElementById('err1');
    var tries=0, polling=null;
    async function tryClaim(auto){
      var ign=ignEl.value.trim(); if(!ign){ err1.textContent='Please enter a name.'; return; }
      claimBtn.disabled=true; if(!auto) err1.textContent='';
      try{
        var r=await fetch(API+'?claim=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ign:ign,token:TK})});
        var j=await r.json();
        if(j.access){ if(polling){clearInterval(polling);polling=null;} renderGranted(j); return; }
        if(j.error==='claimed'){ err1.textContent='This name is already linked to another device.'; if(polling){clearInterval(polling);polling=null;} }
        else { err1.textContent='No valid payment found for "'+ign+'" yet. Pay first &mdash; I keep checking automatically…'; if(!polling){ polling=setInterval(function(){ tries++; if(tries>40){clearInterval(polling);polling=null;} tryClaim(true); },5000); } }
      }catch(e){ err1.textContent='Error: '+e.message; }
      finally{ claimBtn.disabled=false; }
    }
    function doSubmit(){ var _c=document.getElementById('code'); if(_c && _c.value.trim()){ tryRedeem(); } else { tries=0; checkOnline(); tryClaim(false); } }
    claimBtn.addEventListener('click',doSubmit);
    ignEl.addEventListener('keydown',function(e){ if(e.key==='Enter'){ doSubmit(); } });

    var redeemBtn=document.getElementById('submit'), codeEl=document.getElementById('code'), err2=document.getElementById('err2');
    async function tryRedeem(){
      var code=codeEl.value.trim(); if(!code){ err2.textContent='Please enter a code.'; return; }
      var _ign=(document.getElementById('ign')&&document.getElementById('ign').value.trim())||''; if(!_ign){ err2.textContent='Please enter your Minecraft name above first.'; return; }
      redeemBtn.disabled=true; err2.textContent='';
      try{
        var r=await fetch(API+'?redeem=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code,token:TK,ign:_ign})});
        var j=await r.json();
        if(j.access){ try{ if(_ign) localStorage.setItem('donutIgn',_ign); }catch(e){} renderGranted(j); } else err2.textContent = (j.error==='code-full') ? 'This code has already been used.' : 'Invalid code.';
      }catch(e){ err2.textContent='Error: '+e.message; }
      finally{ redeemBtn.disabled=false; }
    }
    codeEl.addEventListener('keydown',function(e){ if(e.key==='Enter') doSubmit(); });
  }

  (async function(){
    try{
      var r=await fetch(API+'?check=1&token='+encodeURIComponent(TK)); var j=await r.json();
      if(j.access){ renderGranted(j); return; }
      var cr=await fetch(API+'?config=1'); var cfg=await cr.json();
      renderUnlock(cfg);
    }catch(e){ app.innerHTML='<div class="msg">Could not load: '+e.message+'</div>'; }
  })();
