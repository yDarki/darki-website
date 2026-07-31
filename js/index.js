// Dashboard - Seitenlogik (ausgelagert aus index.html)
(function(){
    fetch('/api/player?ping=1').then(function(r){return r.json();}).then(function(j){
      if(j && j.up===false){
        document.querySelectorAll('a.tile[href="donutprices.html"], a.tile[href="playerstats.html"]').forEach(function(t){
          t.classList.add('api-down');
          var b=document.createElement('span'); b.className='api-badge';
          b.innerHTML='<span class="d"></span>API offline';
          t.appendChild(b);
        });
      }
    }).catch(function(){});
  })();

(function(){
  var pn=document.getElementById("pcNum");
  fetch("https://api.mcstatus.io/v2/status/java/donutsmp.net",{cache:"no-store"}).then(function(r){return r.json();}).then(function(j){
    if(pn && j && j.players && typeof j.players.online==="number"){ pn.textContent=j.players.online.toLocaleString("en-US"); }
    else if(pn){ pn.textContent="\u2014"; }
  }).catch(function(){ if(pn) pn.textContent="\u2014"; });
  try{
    var tk=localStorage.getItem("acToken");
    if(tk){
      fetch("/api/access?check=1&token="+encodeURIComponent(tk)).then(function(r){return r.json();}).then(function(j){
        var chip=document.getElementById("acChip"), txt=document.getElementById("acTxt");
        if(!chip||!txt||!j||!j.access) return;
        if(j.friend){ txt.innerHTML="Access: <b>permanent</b>"; }
        else if(j.expires){
          var ms=j.expires-Date.now(); var dd=Math.floor(ms/86400000); var hh=Math.floor((ms%86400000)/3600000);
          var when=new Date(j.expires).toLocaleDateString("en-US",{day:"2-digit",month:"2-digit",year:"numeric"});
          var left = dd>0 ? (dd+"d "+hh+"h") : (hh+"h");
          txt.innerHTML="Access expires in <b>"+left+"</b> &middot; "+when;
        } else { return; }
        chip.style.display="";
      }).catch(function(){});
    }
  }catch(e){}
})();

(function(){
  var chip=document.getElementById('authChip'); if(!chip) return;
  var A='/api/access';
  function guest(){ chip.innerHTML='<span style="opacity:.65">Guest</span> &middot; <a href="login.html" style="color:var(--accent);font-weight:700;text-decoration:none">Sign in</a>'; chip.style.display=''; }
  function friendChip(){ chip.innerHTML='<span style="opacity:.65">Friend access</span> <span class="ac-lo" title="Sign out" style="margin-left:5px;cursor:pointer;opacity:.55">&#9211;</span>'; chip.style.display=''; var lo=chip.querySelector('.ac-lo'); if(lo) lo.addEventListener('click',function(){ try{localStorage.removeItem('acToken');localStorage.removeItem('donutIgn');localStorage.setItem('donutGuest','1');}catch(e){} location.reload(); }); }
  function logged(ign){ chip.innerHTML='<img src="https://minotar.net/helm/'+encodeURIComponent(ign)+'/18.png" alt="" style="width:18px;height:18px;border-radius:4px;image-rendering:pixelated;vertical-align:-4px"> signed in as <b style="color:var(--text)">'+ign+'</b> <span class="ac-lo" title="Sign out" style="margin-left:5px;cursor:pointer;opacity:.55">&#9211;</span>'; chip.style.display=''; var lo=chip.querySelector('.ac-lo'); if(lo) lo.addEventListener('click',function(){ try{localStorage.removeItem('acToken');localStorage.removeItem('donutIgn');localStorage.setItem('donutGuest','1');}catch(e){} location.reload(); }); }
  var tok=null,ign=null; try{tok=localStorage.getItem('acToken');ign=localStorage.getItem('donutIgn');}catch(e){}
  if(!tok){ guest(); return; }
  fetch(A+'?check&token='+encodeURIComponent(tok)+'&_='+Date.now(),{cache:'no-store'}).then(function(r){return r.json();}).then(function(j){ if(j&&j.access){ if(j.ign){ try{localStorage.setItem('donutIgn',j.ign);}catch(e){} logged(j.ign); } else { friendChip(); } } else { try{localStorage.removeItem('acToken');}catch(e){} guest(); } }).catch(function(){ if(ign) logged(ign); else guest(); });
})();

(function(){
  function pcChip(){var pn=document.getElementById('pcNum');return pn?pn.closest('.chip'):null;}
  function center(){var c=pcChip();if(c)c.classList.add('pc-center');}
  function buildPop(){
    var a=document.getElementById('authChip');
    if(!a||getComputedStyle(a).display==='none')return false;
    if(a.querySelector('.ac-pop'))return true;
    var t=document.getElementById('acTxt');
    if(!t||!t.textContent.trim())return false;
    var pop=document.createElement('span');pop.className='ac-pop';pop.innerHTML=t.innerHTML;
    a.appendChild(pop);return true;
  }
  function init(){
    center();
    var a=document.getElementById('authChip');
    if(a){
      a.addEventListener('click',function(e){if(e.target.closest('.ac-lo'))return;e.stopPropagation();buildPop();a.classList.toggle('pop-open');});
      a.addEventListener('mouseenter',buildPop);
      document.addEventListener('click',function(e){if(!e.target.closest('#authChip'))a.classList.remove('pop-open');});
    }
    var n=0,iv=setInterval(function(){center();if(buildPop()||++n>40)clearInterval(iv);},250);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
