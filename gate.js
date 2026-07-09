// Site paywall gate + API access enforcement.
// - Attaches the access token to all same-origin /api/ requests so the server can enforce the paywall.
// - Redirects visitors without valid access to /access.html.
// access.html and /api/access are never gated.
(function () {
  var KEY = 'acToken';
  var tk = localStorage.getItem(KEY) || '';

  // 1) Attach X-Access-Token to same-origin /api/ requests (server-side enforcement).
  if (tk && window.fetch) {
    var _fetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        var isApi = url.indexOf('/api/') === 0 || url.indexOf(location.origin + '/api/') === 0;
        if (isApi) {
          init = init || {};
          var h = new Headers((init && init.headers) || (typeof input !== 'string' && input && input.headers) || {});
          if (!h.has('X-Access-Token')) h.set('X-Access-Token', tk);
          init.headers = h;
        }
      } catch (e) {}
      return _fetch(input, init);
    };
  }

  if (/\/access(\.html)?$/.test(location.pathname)) return; // never gate the unlock page

  // 2) Hide the page until access is confirmed; redirect if not.
  var hide = document.createElement('style');
  hide.id = '__gate';
  hide.textContent = 'html{visibility:hidden!important}';
  (document.head || document.documentElement).appendChild(hide);
  function show() { var s = document.getElementById('__gate'); if (s && s.parentNode) s.parentNode.removeChild(s); }
  function lock() { location.replace('/access.html'); }
  function decide() {
    if (!tk) { lock(); return; }
    fetch('/api/access?check=1&token=' + encodeURIComponent(tk))
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.access) show(); else lock(); })
      .catch(function () { show(); });
  }
  fetch('/api/access?config=1')
    .then(function (r) { return r.json(); })
    .then(function (c) { if (c && c.open === true) { show(); } else { decide(); } })
    .catch(function () { decide(); });
})();
