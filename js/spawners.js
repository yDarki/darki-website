// Spawner-Preise - Seitenlogik (ausgelagert aus spawners.html)
var API='/api/spawners';
  var app=document.getElementById('app');
  function abbr(n){ if(n==null) return null; n=+n; var a=Math.abs(n); if(a>=1e9)return (n/1e9).toFixed(2).replace(/\.?0+$/,'')+'B'; if(a>=1e6)return (n/1e6).toFixed(2).replace(/\.?0+$/,'')+'M'; if(a>=1e3)return (n/1e3).toFixed(1).replace(/\.?0+$/,'')+'k'; return String(Math.round(n)); }
  function full(n){ return n==null?'':Math.round(+n).toLocaleString('en-US')+' $'; }
  function ago(ms){ if(!ms) return ''; var s=Math.floor((Date.now()-ms)/1000); if(s<60)return 'just now'; var m=Math.floor(s/60); if(m<60)return m+'m ago'; var h=Math.floor(m/60); if(h<24)return h+'h ago'; return Math.floor(h/24)+'d ago'; }
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

  function render(data){
    var sources=(data&&data.sources)||[];
    var withData=sources.filter(function(s){return s.spawners&&s.spawners.length;});
    if(!withData.length){
      app.innerHTML='<div class="msg">No spawner prices loaded yet.<br><small>Once a market channel is connected, prices appear here and refresh automatically.</small></div>';
      return;
    }
    var h='';
    withData.forEach(function(s){
      var _nm=esc(s.name||'Market'); var _ic=s.icon?'<img class="sicon" src="'+esc(s.icon)+'" alt="">':''; var _ext='<svg class="ext" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"></path><path d="M8 7h9v9"></path></svg>'; var _head=s.link?('<a class="srclink" href="'+esc(s.link)+'" target="_blank" rel="noopener">'+_ic+'<span class="nm">'+_nm+'</span>'+_ext+'</a>'):(_ic+'<span class="nm">'+_nm+'</span>'); h+='<div class="src"><div class="h">'+_head+'<span class="up">updated '+ago(s.updated||data.updated)+'</span></div>';
      h+='<table><thead><tr><th>Spawner</th><th>Sell (you&rarr;them)</th><th>Buy (them&rarr;you)</th></tr></thead><tbody>';
      s.spawners.forEach(function(sp){
        var sell=abbr(sp.sell), buy=abbr(sp.buy);
        h+='<tr><td class="sp-name">'+esc(sp.name)+'</td>'+
           '<td>'+(sell?'<span class="sell" title="'+full(sp.sell)+'">'+sell+'</span>':'<span class="dash">&mdash;</span>')+'</td>'+
           '<td>'+(buy?'<span class="buy" title="'+full(sp.buy)+'">'+buy+'</span>':'<span class="dash">&mdash;</span>')+'</td></tr>';
      });
      h+='</tbody></table><div class="legend"><b>Sell</b> = what the market pays you &middot; <b>Buy</b> = what they charge you. Prices are read from the market’s Discord and refresh on reload.</div></div>';
    });
    app.innerHTML=h;
  }

  function load(){
    app.innerHTML='<div class="msg"><div class="spinner"></div>Loading&hellip;</div>';
    fetch(API+'?cb='+Date.now(),{cache:'no-store'}).then(function(r){return r.json();}).then(function(j){ render(j); }).catch(function(e){ app.innerHTML='<div class="msg">Could not load: '+esc(e.message)+'</div>'; });
  }
  document.getElementById('refresh').addEventListener('click',load);
  load();
