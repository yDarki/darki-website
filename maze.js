// Shared animated maze background. Targets the element with class "bg".
(function(){
  var bg = document.querySelector('.bg');
  if(!bg) return;
  function draw(){
    var W = Math.max(window.innerWidth, 320), H = Math.max(window.innerHeight, 320), S = 30, seed = 1337;
    function rnd(){ seed = (seed * 1103515245 + 12345) & 2147483647; return seed / 2147483647; }
    var L = '';
    for(var y = 0; y < H + S; y += S){
      for(var x = 0; x < W + S; x += S){
        if(rnd() < 0.5){ L += '<line x1="' + x + '" y1="' + (y + S) + '" x2="' + (x + S) + '" y2="' + y + '"/>'; }
        else{ L += '<line x1="' + x + '" y1="' + y + '" x2="' + (x + S) + '" y2="' + (y + S) + '"/>'; }
      }
    }
    bg.innerHTML = '<svg class="mz" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><g stroke="rgba(255,255,255,0.07)" stroke-width="1" stroke-linecap="square">' + L + '</g></svg>';
  }
  draw();
  var t;
  window.addEventListener('resize', function(){ clearTimeout(t); t = setTimeout(draw, 250); });
})();
