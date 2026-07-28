// Donut Prices - Seitenlogik (ausgelagert aus donutprices.html)
(function(){
  var ovl=document.getElementById('ovl');
  var ovlGraph=document.getElementById('ovlGraph');
  var ovlList=document.getElementById('ovlList');
  var ovlGCap=document.getElementById('ovlGCap');
  var ovlRange=document.getElementById('ovlRange');
  var ovlRangeCustom=document.getElementById('ovlRangeCustom');
  var tOff=document.getElementById('ovlTabOffers');
  var tSal=document.getElementById('ovlTabSales');
  var curItem=null, curTabO='offers', offerSeries=[], saleSeries=[];
  function loadRange(){ try{ var v=parseFloat(localStorage.getItem('donutGraphRange')); return (!isNaN(v)&&v>0)?v:604800000; }catch(e){ return 604800000; } }
  function saveRange(ms){ try{ localStorage.setItem('donutGraphRange', String(ms)); }catch(e){} }
  var rangeMs=loadRange();
  var tip=document.getElementById('ovlTip'); if(!tip){ tip=document.createElement('div'); tip.id='ovlTip'; tip.style.cssText='position:fixed;z-index:90;display:none;background:#0b0b12;border:1px solid rgba(255,255,255,.18);color:#f3f3f7;font-size:12px;line-height:1.35;padding:7px 10px;border-radius:9px;pointer-events:none;box-shadow:0 10px 30px rgba(0,0,0,.5);font-variant-numeric:tabular-nums'; document.body.appendChild(tip); }
  function fmt(n){ return (n==null)?'-':Math.round(n).toLocaleString('en-US'); }
  function pad(n){ return (n<10?'0':'')+n; }
  function ago(ts){ if(!ts) return '-'; var s=Math.floor((Date.now()-ts)/1000); if(s<60)return 'just now'; var m=Math.floor(s/60); if(m<60)return m+'m ago'; var h=Math.floor(m/60); if(h<24)return h+'h ago'; return Math.floor(h/24)+'d ago'; }
  function fmtTick(t){ var d=new Date(t); if(rangeMs<=129600000) return pad(d.getHours())+':'+pad(d.getMinutes()); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
  function niceStep(span){ var m=60000; var s=[10*m,15*m,30*m,60*m,120*m,180*m,360*m,720*m,1440*m,2880*m,10080*m]; for(var i=0;i<s.length;i++){ if(span/s[i]<=8) return s[i]; } return s[s.length-1]; }
  function showTip(e){ var c=e.currentTarget; var p=+c.getAttribute('data-p'); var t=+c.getAttribute('data-t'); var d=new Date(t); tip.innerHTML='<b>'+fmt(p)+'</b><br>'+d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+', '+pad(d.getHours())+':'+pad(d.getMinutes()); tip.style.display='block'; var x=e.clientX+14, y=e.clientY-12; if(x>window.innerWidth-160) x=e.clientX-150; tip.style.left=x+'px'; tip.style.top=y+'px'; }
  function hideTip(){ tip.style.display='none'; }
  function setTab(which){ curTabO=which; tOff.classList.toggle('active',which==='offers'); tSal.classList.toggle('active',which==='sales'); renderList(); drawForTab(); }
  tOff.onclick=function(){ setTab('offers'); };
  tSal.onclick=function(){ setTab('sales'); };
  function renderList(){ var it=curItem; if(!it){ ovlList.innerHTML=''; return; } var list = curTabO==='offers' ? (it.ah||[]) : (it.sales||[]); if(!list.length){ ovlList.innerHTML='<div class="ovl-empty">'+(curTabO==='offers'?'No offers in the AH.':'No AH sales found.')+'</div>'; return; } ovlList.innerHTML=list.map(function(e){ var c=e.count||1; var per=(c>1?('ea. '+fmt(e.price/c)):'per unit'); var sub=curTabO==='offers'?(c+'x units'):(c+'x \u00b7 '+ago(e.time)); return '<div class="ovl-row"><div class="who">'+e.seller+'<br><small>'+sub+'</small></div><div class="pr">'+fmt(e.price)+'<small>'+per+'</small></div></div>'; }).join(''); }
  function niceNum(rng, round){ var e=Math.floor(Math.log(rng)/Math.LN10); var f=rng/Math.pow(10,e); var nf; if(round){ nf=f<1.5?1:(f<3?2:(f<7?5:10)); } else { nf=f<=1?1:(f<=2?2:(f<=5?5:10)); } return nf*Math.pow(10,e); }
  function niceScale(mn,mx){ var mid=(mn+mx)/2, span=mx-mn; var minSpan=Math.abs(mid)*0.012; if(!(span>0)||span<minSpan) span=minSpan||1; var lo=mid-span/2, hi=mid+span/2; var pad=(hi-lo)*0.05; lo-=pad; hi+=pad; var step=niceNum((hi-lo)/4,true); if(!(step>0)) step=1; return {min:Math.floor(lo/step)*step, max:Math.ceil(hi/step)*step, step:step}; }
  function fmtAxis(n, step){ var a=Math.abs(n), unit, div; if(a>=1e9){ unit='B'; div=1e9; } else if(a>=1e6){ unit='M'; div=1e6; } else if(a>=1e3){ unit='k'; div=1e3; } else { return ''+Math.round(n); } var dec=0; if(step){ var su=step/div; dec=su>=1?0:(su>=0.1?1:(su>=0.01?2:3)); } return parseFloat((n/div).toFixed(dec))+unit; }
  function svgGraph(points, W, H, opts){
    if(!points||points.length<2) return null;
    var padL=50,padR=18,padT=18,padB=30;
    var ys=points.map(function(p){return p.y;});
    var dmin=Math.min.apply(null,ys), dmax=Math.max.apply(null,ys); var sc=niceScale(dmin,dmax); var y0=sc.min, y1=sc.max; if(y1===y0){y1=y0+1;}
    var X0=opts.x0, X1=opts.x1;
    var sx=function(x){ return padL+(X1===X0?0:(x-X0)/(X1-X0))*(W-padL-padR); };
    var sy=function(y){ return padT+(1-(y-y0)/(y1-y0))*(H-padT-padB); };
    var d=''; points.forEach(function(p,i){ d+=(i?' L':'M')+sx(p.x).toFixed(1)+' '+sy(p.y).toFixed(1); });
    var area='M'+sx(points[0].x).toFixed(1)+' '+(H-padB)+' '+d.replace(/^M/,'L')+' L'+sx(points[points.length-1].x).toFixed(1)+' '+(H-padB)+' Z';
    var grid='', nL=Math.round((y1-y0)/sc.step); if(!(nL>0)||nL>12) nL=4; for(var gi=0;gi<=nL;gi++){ var gv=y0+gi*sc.step; var gy=sy(gv); grid+='<line x1="'+padL+'" y1="'+gy.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+gy.toFixed(1)+'" stroke="rgba(255,255,255,.07)"/>'; grid+='<text x="'+(padL-8)+'" y="'+(gy+4).toFixed(1)+'" fill="#8b8ba0" font-size="10" text-anchor="end">'+fmtAxis(gv, sc.step)+'</text>'; }
    var GUP='#5bd99a', GDN='#ff6b6b', base=(H-padB), dUp='', dDn='', fUp='', fDn='';
    var _gg=[]; for(var gk=1;gk<points.length;gk++) _gg.push(points[gk].x-points[gk-1].x); var _gs=_gg.slice().sort(function(a,b){return a-b;}); var _med=_gs.length?_gs[Math.floor(_gs.length/2)]:0; var GAPMS=(opts&&opts.noGap)?Infinity:Math.max(1800000, _med*4);
    for(var si=1;si<points.length;si++){ if(points[si].x-points[si-1].x>GAPMS) continue; var ax=sx(points[si-1].x).toFixed(1), ay=sy(points[si-1].y).toFixed(1), bx=sx(points[si].x).toFixed(1), by=sy(points[si].y).toFixed(1); var ln='M'+ax+' '+ay+' L'+bx+' '+by+' '; var ar='M'+ax+' '+base+' L'+ax+' '+ay+' L'+bx+' '+by+' L'+bx+' '+base+' Z '; if(points[si].y>=points[si-1].y){ dUp+=ln; fUp+=ar; } else { dDn+=ln; fDn+=ar; } }
    var dots='', hits=''; points.forEach(function(p,di){ var X=sx(p.x).toFixed(1), Y=sy(p.y).toFixed(1); var dc=(di===0)?((points.length>1&&points[1].y>=points[0].y)?GUP:GDN):((points[di].y>=points[di-1].y)?GUP:GDN); dots+='<circle cx="'+X+'" cy="'+Y+'" r="2.6" fill="'+dc+'"/>'; hits+='<circle cx="'+X+'" cy="'+Y+'" r="11" fill="transparent" class="ovl-hit" data-p="'+p.y+'" data-t="'+p.x+'" style="pointer-events:all;cursor:pointer"/>'; });
    var xlab=(opts.ticks||[]).map(function(tk){ var x=sx(tk.x); var anc=(x<padL+14)?'start':((x>W-padR-14)?'end':'middle'); return '<line x1="'+x.toFixed(1)+'" y1="'+padT+'" x2="'+x.toFixed(1)+'" y2="'+(H-padB)+'" stroke="rgba(255,255,255,.05)"/><text x="'+x.toFixed(1)+'" y="'+(H-7)+'" fill="#8b8ba0" font-size="10" text-anchor="'+anc+'">'+tk.label+'</text>'; }).join('');
    return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="ovlUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+GUP+'" stop-opacity=".24"/><stop offset="100%" stop-color="'+GUP+'" stop-opacity="0"/></linearGradient><linearGradient id="ovlDn" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+GDN+'" stop-opacity=".24"/><stop offset="100%" stop-color="'+GDN+'" stop-opacity="0"/></linearGradient></defs>'+grid+'<path d="'+fUp+'" fill="url(#ovlUp)"/><path d="'+fDn+'" fill="url(#ovlDn)"/><path d="'+dDn+'" fill="none" stroke="'+GDN+'" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" style="filter:drop-shadow(0 0 4px '+GDN+'88)"/><path d="'+dUp+'" fill="none" stroke="'+GUP+'" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" style="filter:drop-shadow(0 0 4px '+GUP+'88)"/>'+dots+xlab+hits+'</svg>';
  }
  function curOffer(){ var it=curItem; if(!it) return null; return it.unit!=null?it.unit:(it.cheapest1!=null?it.cheapest1:(it.cheapestAny!=null?it.cheapestAny:null)); }
  function wireHits(el){ el.querySelectorAll('.ovl-hit').forEach(function(c){ c.addEventListener('mousemove',showTip); c.addEventListener('mouseenter',showTip); c.addEventListener('mouseleave',hideTip); }); }
  function drawInto(el, big){
    var W=big?1040:560, H=big?470:240;
    var now=Date.now();
    var lastT=(((curTabO==='offers')?offerSeries:saleSeries).slice(-1)[0]||{}).t||now;
    var x1=(now-lastT>60000)?lastT:now;
    var x0=x1-rangeMs;
    var src=(curTabO==='offers')?offerSeries:saleSeries;
    var pts=src.filter(function(p){return p.t>=x0 && p.t<=x1;}).map(function(p){return {x:p.t,y:p.p};});
    if(pts.length<2){ el.innerHTML='<div class="ovl-empty">Not enough '+(curTabO==='offers'?'offer':'sales')+' history in this range yet \u2014 it fills in over time.</div>'; return; }
    var step=niceStep(x1-x0); var ticks=[]; for(var tt=Math.ceil(x0/step)*step; tt<=x1+1; tt+=step){ ticks.push({x:tt,label:fmtTick(tt)}); } if(ticks.length>9){ ticks=ticks.filter(function(_,ix){return ix%2===0;}); }
    el.innerHTML=svgGraph(pts,W,H,{x0:x0,x1:x1,ticks:ticks,noGap:(function(){try{var _t=document.getElementById('ovlTabOffers');return !(_t&&_t.classList.contains('active'));}catch(_e){return false;}})()});
    wireHits(el);
  }
  function drawForTab(){ if(ovlGCap) ovlGCap.textContent=(curTabO==='offers'?'Cheapest offer \u00b7 over time':'Sales \u00b7 per unit \u00b7 over time'); drawInto(ovlGraph,false); }
  function applyChip(){ if(!ovlRange) return; var matched=false; ovlRange.querySelectorAll('button[data-r]').forEach(function(b){ var dr=b.getAttribute('data-r'); var on=(dr!=='custom' && parseFloat(dr)===rangeMs); b.classList.toggle('on', on); if(on) matched=true; }); if(!matched){ var cb=ovlRange.querySelector('button[data-r=\'custom\']'); if(cb) cb.classList.add('on'); if(ovlRangeCustom){ ovlRangeCustom.classList.remove('hidden'); ovlRangeCustom.value=Math.round(rangeMs/3600000); } } }
  if(ovlRange){ ovlRange.querySelectorAll('button[data-r]').forEach(function(b){ b.onclick=function(){ ovlRange.querySelectorAll('button[data-r]').forEach(function(x){x.classList.remove('on');}); b.classList.add('on'); if(b.getAttribute('data-r')==='custom'){ ovlRangeCustom.classList.remove('hidden'); ovlRangeCustom.focus(); var h=parseFloat(ovlRangeCustom.value); if(!isNaN(h)&&h>0){ rangeMs=Math.min(h,168)*3600000; saveRange(rangeMs); } } else { ovlRangeCustom.classList.add('hidden'); rangeMs=parseFloat(b.getAttribute('data-r')); saveRange(rangeMs); } drawForTab(); }; });
    ovlRangeCustom.addEventListener('input',function(){ var h=parseFloat(this.value); if(isNaN(h)||h<=0) return; if(h>168){h=168;this.value=168;} rangeMs=h*3600000; saveRange(rangeMs); drawForTab(); });
    applyChip(); }
  window.openItemOverlay=function(it){
    curItem=it;
    document.getElementById('ovlNm').textContent=pretty(it.id);
    var img=document.getElementById('ovlImg'); img.src=tex(it.id); img.onerror=function(){this.style.visibility='hidden';};
    document.getElementById('ovlMeta').textContent='~ '+fmt(priceOf(it))+' / each \u00b7 '+it.listings+' offers';
    var so=(it.sales||[]).filter(function(s){return s.time;}).map(function(s){return {t:s.time,p:Math.round(s.price/(s.count||1))};}).sort(function(a,b){return a.t-b.t;});
    saleSeries=so; offerSeries=[];
    if(ovlRange) ovlRange.classList.add('show');
    setTab('offers');
    ovl.classList.add('open');
    var id=(it.id||'').replace(/^minecraft:/,'');
    fetch('/api/donut?history='+encodeURIComponent(id)+'&_='+Date.now()).then(function(r){return r.json();}).then(function(j){ if(curItem!==it) return; var pts=(j.points||[]); var hO=pts.filter(function(p){return p.o!=null;}).map(function(p){return {t:p.t,p:p.o};}); var hSal=(j.sales||[]).map(function(p){return {t:p.t,p:p.p};}); offerSeries=hO.sort(function(a,b){return a.t-b.t;}); var mrg=hSal.concat(so).sort(function(a,b){return a.t-b.t;}); var sn={}, outS=[]; for(var qi=0;qi<mrg.length;qi++){ var kk=mrg[qi].t+':'+mrg[qi].p; if(!sn[kk]){sn[kk]=1; outS.push(mrg[qi]);} } saleSeries=outS; drawForTab(); }).catch(function(){});
  };
  function closeOvl(){ ovl.classList.remove('open'); curItem=null; hideTip(); }
  document.getElementById('ovlX').onclick=closeOvl;
  ovl.addEventListener('click',function(e){ if(e.target===ovl) closeOvl(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape') closeOvl(); });
  var ovlBig=document.getElementById('ovlBig');
  var expBtn=document.getElementById('ovlExpand');
  if(expBtn){ expBtn.onclick=function(){ if(!curItem) return; var tt=document.getElementById('ovlBigTitle'); if(tt) tt.textContent=pretty(curItem.id); var bs=document.getElementById('ovlBigSub'); if(bs) bs.textContent=(curTabO==='offers'?'Cheapest offer \u00b7 over time':'Sales \u00b7 per unit \u00b7 over time'); drawInto(document.getElementById('ovlBigGraph'), true); ovlBig.classList.add('open'); }; }
  var bx=document.getElementById('ovlBigX'); if(bx) bx.onclick=function(){ ovlBig.classList.remove('open'); hideTip(); };
  if(ovlBig) ovlBig.addEventListener('click',function(e){ if(e.target===ovlBig){ ovlBig.classList.remove('open'); hideTip(); } });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape' && ovlBig && ovlBig.classList.contains('open')){ ovlBig.classList.remove('open'); hideTip(); } });
  function refreshItem(){ if(!curItem) return; var id=curItem.id; var sid=id.replace('minecraft:',''); var rb=document.getElementById('ovlRefresh'); if(rb) rb.classList.add('spin'); fetch('/api/donut?_='+Date.now()).then(function(r){return r.json();}).then(function(data){ var arr=(data.items||[]); try{ if(typeof items!=='undefined' && Array.isArray(items)){ items.length=0; for(var i=0;i<arr.length;i++) items.push(arr[i]); try{localStorage.setItem('donutPricesV3',JSON.stringify({ts:Date.now(),items:arr}));}catch(e1){} if(typeof render==='function') render(); } }catch(e2){} var fresh=arr.filter(function(x){return x.id===id;})[0]; if(fresh){ curItem=fresh; var mt=document.getElementById('ovlMeta'); if(mt) mt.textContent='~ '+fmt(priceOf(fresh))+' / each \u00b7 '+fresh.listings+' offers'; } var so=((curItem.sales)||[]).filter(function(s){return s.time;}).map(function(s){return {t:s.time,p:Math.round(s.price/(s.count||1))};}).sort(function(a,b){return a.t-b.t;}); return fetch('/api/donut?history='+encodeURIComponent(sid)+'&_='+Date.now()).then(function(r){return r.json();}).then(function(j){ var pts=(j.points||[]); var hO=pts.filter(function(p){return p.o!=null;}).map(function(p){return {t:p.t,p:p.o};}); var hSal=(j.sales||[]).map(function(p){return {t:p.t,p:p.p};}); offerSeries=hO.sort(function(a,b){return a.t-b.t;}); var mrg=hSal.concat(so).sort(function(a,b){return a.t-b.t;}); var sn={}, outS=[]; for(var qi=0;qi<mrg.length;qi++){ var kk=mrg[qi].t+':'+mrg[qi].p; if(!sn[kk]){sn[kk]=1; outS.push(mrg[qi]);} } saleSeries=outS; renderList(); drawForTab(); var ob=document.getElementById('ovlBig'); if(ob && ob.classList.contains('open')){ drawInto(document.getElementById('ovlBigGraph'), true); } }); }).catch(function(){}).then(function(){ var rb2=document.getElementById('ovlRefresh'); if(rb2) rb2.classList.remove('spin'); }); }
  var rfb=document.getElementById('ovlRefresh'); if(rfb) rfb.onclick=refreshItem;
  openPanel=function(it){ openItemOverlay(it); };
})();

fetch('/api/player?ping=1').then(function(r){return r.json();}).then(function(j){if(j&&(j.up===false||(j.status&&j.status>=400)))document.getElementById('apiDown').classList.add('show');}).catch(function(){});

document.querySelectorAll('.btn').forEach(function(b){b.addEventListener('click',function(){b.classList.add('flash');});b.addEventListener('animationend',function(){b.classList.remove('flash');});});
