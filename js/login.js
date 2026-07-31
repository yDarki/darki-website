// Login - Seitenlogik (ausgelagert aus login.html)
var API='/api/access';
    function el(id){ return document.getElementById(id); }
    function rndTok(){ var a=new Uint8Array(24); if(window.crypto&&crypto.getRandomValues){ crypto.getRandomValues(a); } else { for(var i=0;i<a.length;i++) a[i]=Math.floor(Math.random()*256); } return Array.prototype.map.call(a,function(b){return b.toString(16).padStart(2,'0');}).join(''); }
    function toDash(){ location.href='index.html'; }
    var token=null, poll=null;
    el('guestBtn').addEventListener('click', function(){ try{ localStorage.setItem('donutGuest','1'); }catch(e){} toDash(); });
    el('loginBtn').addEventListener('click', startLogin);
    el('cancel').addEventListener('click', function(){ if(poll) clearInterval(poll); el('step').classList.remove('show'); el('choose').style.display=''; el('waiting').style.display='flex'; el('err').style.display='none'; });
    async function startLogin(){
      el('choose').style.display='none'; el('step').classList.add('show'); el('err').style.display='none'; el('waiting').style.display='flex';
      token=rndTok();
      try{
        var r=await fetch(API+'?login=start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token})});
        var j=await r.json();
        if(!j||!j.code){ showErr('Could not create a code. Please try again.'); return; }
        el('code').textContent=j.code; el('codeInline').textContent=j.code;
        if(j.collector) el('collector').textContent=j.collector;
        poll=setInterval(check, 2500); check();
      }catch(e){ showErr('Network error. Please try again.'); }
    }
    async function check(){
      if(!token) return;
      try{
        var r=await fetch(API+'?check&token='+encodeURIComponent(token)+'&_='+Date.now(),{cache:'no-store'});
        var j=await r.json();
        if(j&&j.access){
          clearInterval(poll);
          try{ localStorage.setItem('acToken', token); if(j.ign) localStorage.setItem('donutIgn', j.ign); localStorage.removeItem('donutGuest'); }catch(e){}
          toDash();
        }
      }catch(e){}
    }
    function showErr(m){ el('err').textContent=m; el('err').style.display='block'; el('waiting').style.display='none'; }
