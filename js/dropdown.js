// Ersetzt jedes <select> optisch durch ein Menue im Seitenstil.
// Das <select> bleibt im DOM und ist weiterhin die Datenquelle: die Seitenlogik
// kann unveraendert auf 'change' hoeren, und dynamisch erzeugte Selects werden
// per MutationObserver automatisch mitgenommen.
//
// Ausnahmen: <select data-plain>, mehrfach-Auswahl und bereits versteckte
// Selects (z.B. der Spawner-Rechner, der schon ein eigenes Menue hat).
(function(){
  function build(sel){
    if(sel.dataset.ddDone) return;
    if(sel.multiple || sel.size > 1) return;
    if(sel.hasAttribute('data-plain')) return;
    if(sel.classList.contains('hidden')) return;
    sel.dataset.ddDone = '1';

    var dd = document.createElement('div');
    dd.className = 'dd';
    dd.innerHTML = '<button type="button" class="dd-btn"><span class="dd-txt"></span>'
                 + '<span class="dd-car">&#9662;</span></button>'
                 + '<div class="dd-menu hidden"></div>';
    sel.classList.add('hidden');
    sel.parentNode.insertBefore(dd, sel.nextSibling);

    var btn  = dd.querySelector('.dd-btn');
    var txt  = dd.querySelector('.dd-txt');
    var menu = dd.querySelector('.dd-menu');

    function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

    function paint(){
      var cur = sel.options[sel.selectedIndex];
      txt.textContent = cur ? cur.textContent : '';
      menu.innerHTML = Array.prototype.map.call(sel.options, function(o, i){
        return '<div class="dd-opt' + (i === sel.selectedIndex ? ' on' : '') + '" data-i="' + i + '">'
             + esc(o.textContent) + '</div>';
      }).join('');
    }
    function close(){ menu.classList.add('hidden'); btn.classList.remove('open'); }
    function open(){ paint(); menu.classList.remove('hidden'); btn.classList.add('open'); }

    btn.addEventListener('click', function(e){
      e.stopPropagation();
      if(menu.classList.contains('hidden')) open(); else close();
    });
    menu.addEventListener('click', function(e){
      var o = e.target.closest ? e.target.closest('.dd-opt') : null;
      if(!o) return;
      sel.selectedIndex = +o.getAttribute('data-i');
      paint(); close();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    document.addEventListener('click', function(e){ if(!dd.contains(e.target)) close(); });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape') close(); });
    // Wenn die Seite den Wert selbst setzt, zieht die Beschriftung nach.
    sel.addEventListener('change', paint);
    paint();
  }

  function scan(root){
    var list = (root || document).querySelectorAll('select');
    Array.prototype.forEach.call(list, build);
  }

  function boot(){
    scan();
    if(!window.MutationObserver) return;
    new MutationObserver(function(muts){
      for(var i = 0; i < muts.length; i++){
        var added = muts[i].addedNodes;
        for(var j = 0; j < added.length; j++){
          var n = added[j];
          if(n.nodeType !== 1) continue;
          if(n.tagName === 'SELECT') build(n); else scan(n);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
