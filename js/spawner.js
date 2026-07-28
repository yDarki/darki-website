// Spawner-Rechner - Seitenlogik (ausgelagert aus spawner.html)
var SK={a:0.39567,k:0.00134606,c:8.24358,L:1505.35};
    function rateSkel(x){ return Math.max(0, -SK.a*Math.exp(-SK.k*x+SK.c)+SK.L); }
    var fitL=null, fitK=null;
    function rateCustom(x){ if(fitL==null) return null; return Math.max(0, fitL*(1-Math.exp(-fitK*x))); }
    function curMode(){ return document.getElementById('type').value; }
    function unit(){ return curMode()==='skel'?'bones':'drops'; }
    function unitS(){ return curMode()==='skel'?'bone':'drop'; }
    function asymptote(){ return curMode()==='skel'? SK.L : (fitL!=null? fitL : null); }
    function rateAt(x){ return curMode()==='skel'? rateSkel(x) : rateCustom(x); }
    var fmt=function(n){ return (n==null||isNaN(n))?'\u2013':Math.round(n).toLocaleString('en-US'); };
    var fmt1=function(n){ return (n==null||isNaN(n))?'\u2013':(Math.round(n*10)/10).toLocaleString('en-US'); };

    function applyLabels(){ var u=unit(); var U=u.charAt(0).toUpperCase()+u.slice(1);
      document.getElementById('lblRpm').textContent=U+' / min (per pile)';
      document.getElementById('lblRph').textContent=U+' / hour (all piles)';
      document.getElementById('lblPrice').textContent='Sell price per '+unitS()+' ($)';
      document.getElementById('price').placeholder= curMode()==='skel'?'e.g. 60':'e.g. 2';
    }

    function syncTypeBtn(){ var t=document.getElementById("typeBtnTxt"); if(t) t.textContent=(curMode()==='skel'?'Skeleton':'Custom'); }
    function parseData(){ var t=document.getElementById('data').value; var pts=[];
      t.split(/\n+/).forEach(function(line){ var m=line.split(/[ ,;\t]+/).filter(Boolean); if(m.length>=2){ var x=parseFloat(m[0]), r=parseFloat(m[1]); if(!isNaN(x)&&!isNaN(r)&&x>0) pts.push({x:x,r:r}); } });
      return pts; }
    function fit(points){ if(points.length<2) return null; var best=null;
      for(var i=0;i<=600;i++){ var lk=-5+(i/600)*(Math.log(0.05)/Math.LN10+5); var k=Math.pow(10,lk);
        var su=0,sru=0; points.forEach(function(p){ var u=1-Math.exp(-k*p.x); su+=u*u; sru+=p.r*u; });
        if(su<=0) continue; var L=sru/su; if(L<=0) continue;
        var sse=0; points.forEach(function(p){ var u=1-Math.exp(-k*p.x); var d=p.r-L*u; sse+=d*d; });
        if(!best||sse<best.sse) best={L:L,k:k,sse:sse}; }
      if(best){ var mean=points.reduce(function(a,p){return a+p.r;},0)/points.length; var sst=points.reduce(function(a,p){return a+(p.r-mean)*(p.r-mean);},0); best.r2= sst>0?1-best.sse/sst:1; }
      return best; }

    function drawGraph(){
      var el=document.getElementById('graph'); var L=asymptote();
      if(L==null){ el.innerHTML='<p class="note">Enter your data and click Fit curve to see the graph.</p>'; return; }
      var x0=Math.max(0, +document.getElementById('pile').value||0);
      var maxX = curMode()==='skel'? Math.max(2500, x0*1.4) : Math.max(x0*1.4, 50);
      if(curMode()==='custom' && fitK>0){ maxX=Math.max(maxX, Math.log(50)/fitK); }
      var W=620,H=300,padL=66,padR=18,padT=20,padB=40;
      var N=140; var pts=[]; for(var i=0;i<=N;i++){ var x=maxX*i/N; pts.push({x:x, y:rateAt(x)}); }
      var ymax=L*1.06;
      var sx=function(x){ return padL+(x/maxX)*(W-padL-padR); };
      var sy=function(y){ return padT+(1-y/ymax)*(H-padT-padB); };
      var d=''; pts.forEach(function(p,i){ d+=(i?' L':'M')+sx(p.x).toFixed(1)+' '+sy(p.y).toFixed(1); });
      var area='M'+sx(0).toFixed(1)+' '+(H-padB)+' '+d.replace(/^M/,'L')+' L'+sx(maxX).toFixed(1)+' '+(H-padB)+' Z';
      var grid=''; for(var g=0;g<=4;g++){ var gy=padT+(g/4)*(H-padT-padB); var gv=ymax-(g/4)*ymax;
        grid+='<line x1="'+padL+'" y1="'+gy.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+gy.toFixed(1)+'" stroke="rgba(255,255,255,.08)"/>';
        grid+='<text x="'+(padL-8)+'" y="'+(gy+4).toFixed(1)+'" fill="#9a9ab2" font-size="11" text-anchor="end">'+fmt(gv)+'</text>'; }
      var ay=sy(L);
      var asym='<line x1="'+padL+'" y1="'+ay.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+ay.toFixed(1)+'" stroke="#b8bccc" stroke-width="1.2" stroke-dasharray="5 4"/><text x="'+(W-padR)+'" y="'+(ay-6).toFixed(1)+'" fill="#b8bccc" font-size="11" text-anchor="end">max '+fmt(L)+' '+unit()+'/min</text>';
      var cxx=Math.min(x0,maxX); var cx=sx(cxx), cy=sy(rateAt(cxx));
      var marker='<line x1="'+cx.toFixed(1)+'" y1="'+padT+'" x2="'+cx.toFixed(1)+'" y2="'+(H-padB)+'" stroke="rgba(255,255,255,.25)" stroke-dasharray="3 3"/><circle cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="4.2" fill="#5bd99a"/>';
      var xl='<text x="'+padL+'" y="'+(H-12)+'" fill="#9a9ab2" font-size="11">0</text><text x="'+(W-padR)+'" y="'+(H-12)+'" fill="#9a9ab2" font-size="11" text-anchor="end">'+fmt(maxX)+' spawners</text>';
      el.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5bd99a" stop-opacity=".28"/><stop offset="100%" stop-color="#5bd99a" stop-opacity="0"/></linearGradient></defs>'+grid+asym+'<path d="'+area+'" fill="url(#g)"/><path d="'+d+'" fill="none" stroke="#5bd99a" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" style="filter:drop-shadow(0 0 5px #5bd99a99)"/>'+marker+xl+'</svg>';
    }

    function recompute(){
      applyLabels(); syncTypeBtn();
      var x=Math.max(0,+document.getElementById('pile').value||0);
      var piles=Math.max(1,+document.getElementById('piles').value||1);
      var price=parseFloat(document.getElementById('price').value);
      var r=rateAt(x);
      if(r==null){ ['rPm','rPh','profit','marg'].forEach(function(id){document.getElementById(id).textContent='\u2013';}); document.getElementById('advice').textContent=''; drawGraph(); return; }
      var perHourAll=r*60*piles;
      document.getElementById('rPm').textContent=fmt1(r);
      document.getElementById('rPh').textContent=fmt(perHourAll);
      document.getElementById('profit').textContent=(!isNaN(price)&&price>0)?('$'+fmt(perHourAll*price)):'\u2013';
      var marg=rateAt(x+1)-rateAt(x);
      var mtxt=fmt1(marg)+' '+unit()+'/min';
      if(!isNaN(price)&&price>0) mtxt+=' (~$'+fmt(marg*60*price)+'/h)';
      document.getElementById('marg').textContent=mtxt;
      var L=asymptote(); var adv=''; var u=unit();
      if(L!=null){ var total=x*piles; var oneRate=rateAt(total)*60;
        if(piles>1){ adv='With '+fmt(total)+' spawners across '+piles+' piles you make '+fmt(perHourAll)+' '+u+'/h. In ONE pile they would make only '+fmt(oneRate)+' '+u+'/h \u2014 spreading wins by '+fmt(perHourAll-oneRate)+' '+u+'/h.'; }
        else { adv='One pile maxes out near '+fmt(L)+' '+u+'/min. Splitting into more piles multiplies output \u2014 try raising Number of piles.'; } }
      document.getElementById('advice').textContent=adv;
      drawGraph();
    }
    function doFit(){
      var pts=parseData(); var info=document.getElementById('fitInfo'); var eq=document.getElementById('eqBox');
      if(pts.length<2){ info.textContent='Enter at least 2 data points.'; fitL=null;fitK=null; eq.classList.add('hidden'); recompute(); return; }
      var f=fit(pts); fitL=f.L; fitK=f.k;
      info.textContent='Fitted from '+pts.length+' points - R\u00b2 = '+(Math.round(f.r2*1000)/1000);
      eq.classList.remove('hidden'); eq.textContent='rate(x) = '+fmt1(f.L)+' x (1 - e^(-'+f.k.toExponential(3)+' * x))';
      recompute();
    }

    var SKEY='donutSpawnerSetups';
    function loadSetups(){ try{ return JSON.parse(localStorage.getItem(SKEY)||'[]'); }catch(e){ return []; } }
    function storeSetups(a){ try{ localStorage.setItem(SKEY, JSON.stringify(a)); }catch(e){} }
    function summary(s){ var t=s.type==='skel'?'Skeleton':'Custom'; return t+' \u00b7 '+(s.pile||0)+'/pile \u00d7 '+(s.piles||1)+(s.price?(' \u00b7 $'+s.price):''); }
    function renderSetups(){ var box=document.getElementById('setupList'); var a=loadSetups();
      if(!a.length){ box.innerHTML='<div class="muted">No saved setups yet.</div>'; return; }
      box.innerHTML=a.map(function(s,i){ return '<div class="setrow"><div class="si"><div class="sn">'+(s.name||('Setup '+(i+1)))+'</div><div class="sm">'+summary(s)+'</div></div><button data-load="'+i+'">Load</button><button class="x" data-del="'+i+'" title="Remove">\u00d7</button></div>'; }).join('');
      box.querySelectorAll('[data-load]').forEach(function(b){ b.onclick=function(){ applySetup(loadSetups()[+b.getAttribute('data-load')]); }; });
      box.querySelectorAll('[data-del]').forEach(function(b){ b.onclick=function(){ var a=loadSetups(); a.splice(+b.getAttribute('data-del'),1); storeSetups(a); renderSetups(); document.getElementById('setupMsg').textContent=''; }; });
    }
    function applySetup(s){ if(!s) return;
      document.getElementById('type').value=s.type;
      document.getElementById('customBox').classList.toggle('hidden', s.type!=='custom');
      document.getElementById('pile').value=s.pile; document.getElementById('piles').value=s.piles; document.getElementById('price').value=s.price;
      fitL=null; fitK=null; document.getElementById('eqBox').classList.add('hidden'); document.getElementById('fitInfo').textContent='';
      if(s.type==='custom'){ document.getElementById('data').value=s.data||''; if(s.fitL!=null){ fitL=s.fitL; fitK=s.fitK; document.getElementById('fitInfo').textContent='Loaded saved fit'; var eq=document.getElementById('eqBox'); eq.classList.remove('hidden'); eq.textContent='rate(x) = '+fmt1(fitL)+' x (1 - e^(-'+fitK.toExponential(3)+' * x))'; } }
      recompute();
    }
    document.getElementById('saveSetup').onclick=function(){ var a=loadSetups(); var msg=document.getElementById('setupMsg');
      if(a.length>=5){ msg.textContent='Max 5 - remove one first.'; return; }
      var s={ type:curMode(), pile:document.getElementById('pile').value, piles:document.getElementById('piles').value, price:document.getElementById('price').value, data:document.getElementById('data').value, fitL:fitL, fitK:fitK };
      var nm=document.getElementById('setupName').value.trim(); s.name=nm||((s.type==='skel'?'Skeleton':'Custom')+' \u2013 '+(s.pile||0)+'/'+(s.piles||1));
      a.push(s); storeSetups(a); document.getElementById('setupName').value=''; msg.textContent='Saved.'; setTimeout(function(){ if(msg.textContent==='Saved.') msg.textContent=''; },1500); renderSetups();
    };

    document.getElementById('type').addEventListener('change',function(){ document.getElementById('customBox').classList.toggle('hidden', this.value!=='custom'); recompute(); });
    ['pile','piles','price'].forEach(function(id){ document.getElementById(id).addEventListener('input',recompute); });
    document.getElementById('fitBtn').addEventListener('click',doFit);
    (function(){ var dd=document.getElementById("typeDD"), btn=document.getElementById("typeBtn"), menu=document.getElementById("typeMenu"), sel=document.getElementById("type");
      btn.onclick=function(e){ e.stopPropagation(); menu.classList.toggle("hidden"); };
      menu.querySelectorAll(".dd-opt").forEach(function(o){ o.onclick=function(){ sel.value=o.getAttribute("data-v"); sel.dispatchEvent(new Event("change",{bubbles:true})); menu.classList.add("hidden"); }; });
      document.addEventListener("click",function(e){ if(!dd.contains(e.target)) menu.classList.add("hidden"); }); })();
    renderSetups();
    recompute();
