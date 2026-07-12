// Cloudflare Pages Function: DonutSMP player stats + lookup proxy.
// Token is the secret env var DONUT_TOKEN; never reaches the browser.
export async function onRequest(context) {
  const request = context.request;
  const env = context.env || {};
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' };
  const token = env.DONUT_TOKEN;
  const _admin = env.DONUT_TOKEN && (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim() === env.DONUT_TOKEN;
  if (!_admin) {
    const _acc = request.headers.get('X-Access-Token') || '';
    let _ok = false;
    try { const _kv = env.PRICE_HISTORY; if (_acc && _kv) { const _r = await _kv.get('ac:token:' + _acc); if (_r) { const _t = JSON.parse(_r); _ok = _t && _t.expires > Date.now(); } } } catch (e) {}
    if (!_ok) { try { const _oc = await env.PRICE_HISTORY.get('ac:config'); if (_oc) { const _ocf = JSON.parse(_oc); if (_ocf && _ocf.open === true) _ok = true; } } catch (e) {} }
    if (!_ok) return new Response(JSON.stringify({ error: 'locked' }), { status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
  }
  if (!token) { return new Response(JSON.stringify({ error: 'no token configured' }), { status: 500, headers: cors }); }
  const auth = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
  const base = 'https://api.donutsmp.net/v1/';
  const url = new URL(request.url);

  if (url.searchParams.get('ping')) {
    try {
      const r = await fetch(base + 'leaderboards/money/1', { headers: auth });
      return new Response(JSON.stringify({ up: r.status < 500, status: r.status }), { status: 200, headers: cors });
    } catch (e) {
      return new Response(JSON.stringify({ up: false, status: 0, error: String(e) }), { status: 200, headers: cors });
    }
  }

  if (url.searchParams.get('money')) {
    const mn = String(url.searchParams.get('money')).trim().toLowerCase();
    const mcors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=120' };
    const kv = env.PRICE_HISTORY;
    if (!kv) { return new Response(JSON.stringify({ name: mn, points: [] }), { status: 200, headers: mcors }); }
    try {
      let db = {}; try { db = JSON.parse((await kv.get('pmh')) || '{}') || {}; } catch (e) { db = {}; }
      let points = Array.isArray(db[mn]) ? db[mn] : null;
      if (!points) { try { const raw = await kv.get('pmh:' + mn); points = raw ? JSON.parse(raw) : []; } catch (e) { points = []; } }
      return new Response(JSON.stringify({ name: mn, points: points || [] }), { status: 200, headers: mcors });
    } catch (e) { return new Response(JSON.stringify({ name: mn, points: [] }), { status: 200, headers: mcors }); }
  }

  const name = (url.searchParams.get('name') || '').trim();
  if (!name) { return new Response(JSON.stringify({ error: 'no name' }), { status: 400, headers: cors }); }

  const out = { name: name };
  try { const r = await fetch(base + 'stats/' + encodeURIComponent(name), { headers: auth }); out.statsStatus = r.status; const j = await r.json().catch(() => null); out.stats = (j && j.result !== undefined) ? j.result : j; } catch (e) { out.statsError = String(e); }
  try { const r = await fetch(base + 'lookup/' + encodeURIComponent(name), { headers: auth }); out.lookupStatus = r.status; const j = await r.json().catch(() => null); out.lookup = (j && j.result !== undefined) ? j.result : j; } catch (e) { out.lookupError = String(e); }
  // Money history: opt-in via track=1 (frontend sends it only for saved players). Hourly throttle, per-player key, capped index.
  if (out.stats && isFinite(Number(out.stats.money))) {
    try {
      const kv = env.PRICE_HISTORY;
      if (kv) {
        const nl = name.toLowerCase();
        let db = {};
        try { db = JSON.parse((await kv.get('pmh')) || '{}') || {}; } catch (e) { db = {}; }
        if (!db[nl]) { try { const legacy = await kv.get('pmh:' + nl); if (legacy) db[nl] = JSON.parse(legacy) || []; } catch (e) {} }
        let pts = Array.isArray(db[nl]) ? db[nl] : [];
        const now = Date.now();
        const hb = Math.floor(now / 600000);
        const lastHb = pts.length ? Math.floor(pts[pts.length - 1].t / 600000) : -1;
        if (hb !== lastHb) {
          pts.push({ t: now, m: Math.round(Number(out.stats.money)) });
          if (pts.length > 1080) pts = pts.slice(pts.length - 1080);
          db[nl] = pts;
          const names = Object.keys(db);
          if (names.length > 40) {
            names.sort(function (a, b) { const la = (db[a][db[a].length - 1] || {}).t || 0; const lb = (db[b][db[b].length - 1] || {}).t || 0; return lb - la; });
            const keep = {}; names.slice(0, 40).forEach(function (k) { keep[k] = db[k]; });
            db = keep;
          }
          await kv.put('pmh', JSON.stringify(db));
        }
      }
    } catch (e) {}
  }
  return new Response(JSON.stringify(out), { status: 200, headers: cors });
}
