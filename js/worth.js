// Item Worth - Seitenlogik. Holt /api/worth, filtert und sortiert clientseitig.
(function(){
  var API='/api/worth';
  var TEX='https://donutsmp.stacksail.com/textures/';
  var searchEl=document.getElementById('search');
  var sortEl=document.getElementById('sort');
  var refreshEl=document.getElementById('refresh');
  var statusEl=document.getElementById('status');
  var wrapEl=document.getElementById('tableWrap');

  var items=[], updated=0;

  function money(n){ return Number(n).toLocaleString('en-US',{maximumFractionDigits:2}); }
  function pretty(id){ return String(id||'').replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();}); }
  function ago(ts){
    if(!ts) return 'never';
    var s=Math.floor((Date.now()-ts)/1000);
    if(s<60) return 'just now';
    var m=Math.floor(s/60); if(m<60) return m+'m ago';
    var h=Math.floor(m/60); if(h<24) return h+'h ago';
    return Math.floor(h/24)+'d ago';
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  function visible(){
    var q=(searchEl.value||'').trim().toLowerCase();
    var list=items;
    if(q) list=list.filter(function(it){
      return it.id.indexOf(q)>=0 || String(it.name||'').toLowerCase().indexOf(q)>=0;
    });
    var mode=sortEl.value;
    return list.slice().sort(function(a,b){
      if(mode==='worth_asc') return a.worth-b.worth;
      if(mode==='name_asc') return a.id.localeCompare(b.id);
      if(mode==='name_desc') return b.id.localeCompare(a.id);
      return b.worth-a.worth;
    });
  }

  function render(){
    var list=visible();
    statusEl.innerHTML='<b>'+list.length+'</b> of <b>'+items.length+'</b> items &middot; updated '+ago(updated);
    if(!items.length){
      wrapEl.innerHTML='<div class="empty">No values yet &mdash; run the Worth scanner in game to fill this list.</div>';
      return;
    }
    if(!list.length){
      wrapEl.innerHTML='<div class="empty">Nothing matches that search.</div>';
      return;
    }
    var rows=list.map(function(it){
      var nm=(it.name && it.name!==it.id) ? it.name : pretty(it.id);
      return '<tr><td><span class="item">'
        +'<img src="'+TEX+esc(it.id)+'.png" alt="" loading="lazy">'
        +'<span class="nm">'+esc(nm)+'</span><span class="id">'+esc(it.id)+'</span>'
        +'</span></td><td class="val">'+money(it.worth)+' $</td></tr>';
    }).join('');
    wrapEl.innerHTML='<table class="worth"><thead><tr><th>Item</th><th class="num">Worth / each</th></tr></thead><tbody>'+rows+'</tbody></table>';
    // Fehlende Texturen ausblenden statt ein kaputtes Bild zu zeigen.
    wrapEl.querySelectorAll('.item img').forEach(function(im){
      im.addEventListener('error', function(){ im.style.visibility='hidden'; });
    });
  }

  async function load(force){
    wrapEl.innerHTML='<div class="loading"><div class="spinner"></div>Loading&hellip;</div>';
    try{
      var r=await fetch(API+(force?('?_='+Date.now()):''));
      if(!r.ok) throw new Error('HTTP '+r.status);
      var j=await r.json();
      items=(j.items||[]).filter(function(x){ return x && isFinite(x.worth); });
      updated=j.updated||0;
      render();
    }catch(e){
      wrapEl.innerHTML='<div class="empty">Could not load the worth list. Please try again.</div>';
      statusEl.textContent='';
    }
  }

  searchEl.addEventListener('input', render);
  sortEl.addEventListener('change', render);
  refreshEl.addEventListener('click', function(){ load(true); });
  load(false);
})();
