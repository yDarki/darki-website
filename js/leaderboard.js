// Leaderboard - Seitenlogik (ausgelagert aus leaderboard.html)
var API='/api/leaderboard', PER=45, SKEY='donutSavedPlayers';
  var app=document.getElementById('app'), catEl=document.getElementById('cat');
  var prevEl=document.getElementById('prev'), nextEl=document.getElementById('next'), pgnumEl=document.getElementById('pgnum');
  var page=1, fmtMap={money:'money',sell:'money',kills:'int',deaths:'int',playtime:'time',shards:'int'};
  var lastCount=0;

  function abbr(n){ n=+n; var a=Math.abs(n); if(a>=1e12)return (n/1e12).toFixed(2).replace(/\.?0+$/,'')+'T'; if(a>=1e9)return (n/1e9).toFixed(2).replace(/\.?0+$/,'')+'B'; if(a>=1e6)return (n/1e6).toFixed(2).replace(/\.?0+$/,'')+'M'; if(a>=1e3)return (n/1e3).toFixed(1).replace(/\.?0+$/,'')+'k'; return String(Math.round(n)); }
  function fullNum(n){ return Math.round(+n).toLocaleString('en-US'); }
  function playtime(ms){ var s=Math.floor((+ms)/1000); var d=Math.floor(s/86400); var h=Math.floor((s%86400)/3600); var m=Math.floor((s%3600)/60); if(d>0)return d+'d '+h+'h'; if(h>0)return h+'h '+m+'m'; return m+'m'; }
  function fmtVal(v,f){ if(f==='time')return playtime(v); if(f==='int')return fullNum(v); return abbr(v); }
  function fullVal(v,f){ if(f==='time')return playtime(v); if(f==='money')return fullNum(v)+' $'; return fullNum(v); }
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function saved(){ try{ return JSON.parse(localStorage.getItem(SKEY)||'[]'); }catch(e){ return []; } }
  function isSaved(n){ return saved().map(function(x){return x.toLowerCase();}).indexOf(n.toLowerCase())>=0; }
  function toggleSave(n,btn){ var a=saved(); var i=a.map(function(x){return x.toLowerCase();}).indexOf(n.toLowerCase()); if(i>=0){ a.splice(i,1); btn.classList.remove('on'); } else { a.push(n); btn.classList.add('on'); } try{ localStorage.setItem(SKEY, JSON.stringify(a)); }catch(e){} }

  function render(rows, f){
    if(!rows || !rows.length){ app.innerHTML='<div class="msg">No leaderboard data.</div>'; return; }
    var base=(page-1)*PER;
    var h='<div class="list">';
    rows.forEach(function(e,i){
      var rank=base+i+1;
      var name=esc(e.username||'?');
      var rc = rank<=3 ? ' r'+rank : '';
      h+='<div class="row'+rc+'">'+
        '<span class="rank">'+rank+'</span>'+
        '<img class="ava" src="https://minotar.net/helm/'+encodeURIComponent(e.username||'')+'/34.png" alt="" onerror="this.style.visibility=\'hidden\'">'+
        '<a class="pname" href="playerstats.html?name='+encodeURIComponent(e.username||'')+'">'+name+'</a>'+
        '<span class="val" title="'+esc(fullVal(e.value,f))+'">'+esc(fmtVal(e.value,f))+'</span>'+
        '<button class="save'+(isSaved(e.username||'')?' on':'')+'" data-n="'+name+'" title="Save to your players">&#9733;</button>'+
        '</div>';
    });
    h+='</div>';
    app.innerHTML=h;
    app.querySelectorAll('.save').forEach(function(b){ b.addEventListener('click',function(){ toggleSave(b.getAttribute('data-n'), b); }); });
  }

  function load(){
    var stat=catEl.value, f=fmtMap[stat]||'int';
    app.innerHTML='<div class="msg"><div class="spinner"></div>Loading&hellip;</div>';
    pgnumEl.textContent='Page '+page;
    prevEl.disabled=(page<=1);
    fetch(API+'?stat='+encodeURIComponent(stat)+'&page='+page+'&cb='+Date.now(),{cache:'no-store'})
      .then(function(r){return r.json();})
      .then(function(j){
        if(j.status && j.status>=400){ app.innerHTML='<div class="msg">This leaderboard is not available.</div>'; nextEl.disabled=true; return; }
        var rows=j.result||[];
        lastCount=rows.length;
        nextEl.disabled=(rows.length<PER);
        render(rows, f);
      })
      .catch(function(e){ app.innerHTML='<div class="msg">Could not load: '+esc(e.message)+'</div>'; });
  }

  catEl.addEventListener('change',function(){ page=1; load(); });
  document.getElementById('refresh').addEventListener('click',load);
  prevEl.addEventListener('click',function(){ if(page>1){ page--; load(); } });
  nextEl.addEventListener('click',function(){ if(!nextEl.disabled){ page++; load(); } });
  load();
