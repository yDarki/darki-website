// Cloudflare Pages Function: DonutSMP leaderboard proxy.
// GET ?stat=<stat>&page=<n>  ->  { stat, page, status, result }
// Proxies https://api.donutsmp.net/v1/leaderboards/{stat}/{page} using the secret DONUT_TOKEN.
// Paywall-gated like the other tools (admin Bearer, X-Access-Token, or site "open" mode).
export async function onRequest(context) {
  const request = context.request, env = context.env || {}, kv = env.PRICE_HISTORY;
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' };
  const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: cors });
  const token = env.DONUT_TOKEN;
  if (!token) return json({ error: 'no token configured' }, 500);

  // ---- paywall gate ----
  const _admin = (request.headers.get('Authorization') || '') === 'Bearer ' + token;
  if (!_admin) {
    const _acc = request.headers.get('X-Access-Token') || '';
    let _ok = false;
    try { if (_acc && kv) { const _r = await kv.get('ac:token:' + _acc); if (_r) { const _t = JSON.parse(_r); _ok = _t && _t.expires > Date.now(); } } } catch (e) {}
    if (!_ok) { try { if (kv) { const _oc = await kv.get('ac:config'); if (_oc) { const _ocf = JSON.parse(_oc); if (_ocf && _ocf.open === true) _ok = true; } } } catch (e) {} }
    if (!_ok) return json({ error: 'locked' }, 403);
  }

  const url = new URL(request.url);
  const stat = (url.searchParams.get('stat') || 'money').toLowerCase().replace(/[^a-z_]/g, '');
  let page = parseInt(url.searchParams.get('page'), 10) || 1;
  if (page < 1) page = 1; if (page > 100) page = 100;

  try {
    const r = await fetch('https://api.donutsmp.net/v1/leaderboards/' + stat + '/' + page, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    });
    let j = null; const txt = await r.text();
    try { j = JSON.parse(txt); } catch (e) {}
    return json({ stat: stat, page: page, status: r.status, result: (j && (j.result !== undefined ? j.result : j)) || null, raw: j ? null : txt.slice(0, 200) });
  } catch (e) {
    return json({ error: String(e), stat: stat, page: page }, 502);
  }
}
