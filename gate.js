// Site paywall gate. Redirects visitors without valid access to /access.html.
// Included in the <head> of every gated page. access.html and /api/* are not gated.
(function () {
  var p = location.pathname;
  if (/\/access(\.html)?$/.test(p)) return; // never gate the unlock page itself
  var KEY = 'acToken';
  var tk = localStorage.getItem(KEY);
  // Hide the page immediately until access is confirmed (avoids a content flash).
  var hide = document.createElement('style');
  hide.id = '__gate';
  hide.textContent = 'html{visibility:hidden!important}';
  (document.head || document.documentElement).appendChild(hide);
  function show() { var s = document.getElementById('__gate'); if (s && s.parentNode) s.parentNode.removeChild(s); }
  function lock() { location.replace('/access.html'); }
  if (!tk) { lock(); return; }
  fetch('/api/access?check=1&token=' + encodeURIComponent(tk))
    .then(function (r) { return r.json(); })
    .then(function (j) { if (j && j.access) show(); else lock(); })
    .catch(function () { show(); }); // fail-open on network error so the site is not broken if the API hiccups
})();
