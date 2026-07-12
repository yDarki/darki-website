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
      let e0 = db[mn]; let points = (e0 && Array.isArray(e0.pts)) ? e0.pts : (Array.isArray(e0) ? e0 : null);
      if (!points) { try { const raw = await kv.get('pmh:' + mn); points = raw ? JSON.parse(raw) : []; } catch (e) { points = []; } }
      return new Response(JSON.stringify({ name: mn, points: points || [] }), { status: 200, headers: mcors });
    } catch (e) { return new Response(JSON.stringify({ name: mn, points: [] }), { status: 200, headers: mcors }); }
  }

  if (url.searchParams.get('sample')) {
    const scors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    if (!_admin) { return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: scors }); }
    const kv = env.PRICE_HISTORY;
    if (!kv) { return new Response(JSON.stringify({ error: 'no-kv' }), { status: 500, headers: scors }); }
    let db = {}; try { db = JSON.parse((await kv.get('pmh')) || '{}') || {}; } catch (e) { db = {}; }
    const now = Date.now();
    const hb = Math.floor(now / 3600000);
    const week = 604800000;
    let evicted = 0;
    const active = [];
    for (const nl of Object.keys(db)) {
      let entry = db[nl];
      if (Array.isArray(entry)) entry = { last: (entry.length ? entry[entry.length - 1].t : 0), pts: entry };
      if (!entry || (entry.last || 0) < now - week) { delete db[nl]; evicted++; continue; }
      db[nl] = entry; active.push(nl);
    }
    active.sort(function (a, b) { return ((db[b].last) || 0) - ((db[a].last) || 0); });
    const toSample = active.slice(0, 45);
    const results = await Promise.all(toSample.map(function (nl) {
      return fetch(base + 'stats/' + encodeURIComponent(nl), { headers: auth })
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (j) { const s = (j && j.result !== undefined) ? j.result : j; return { nl: nl, s: s }; })
        .catch(function () { return { nl: nl, s: null }; });
    }));
    let sampled = 0;
    for (const it of results) {
      const s = it.s;
      if (!s || !isFinite(Number(s.money))) continue;
      const entry = db[it.nl]; let pts = entry.pts || [];
      const lastHb = pts.length ? Math.floor(pts[pts.length - 1].t / 3600000) : -1;
      if (hb !== lastHb) { pts.push({ t: now, m: Math.round(Number(s.money)) }); if (pts.length > 400) pts = pts.slice(pts.length - 400); entry.pts = pts; db[it.nl] = entry; sampled++; }
    }
    await kv.put('pmh', JSON.stringify(db));
    return new Response(JSON.stringify({ ok: true, tracked: Object.keys(db).length, sampled: sampled, evicted: evicted }), { status: 200, headers: scors });
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
        let entry = db[nl];
        if (Array.isArray(entry)) entry = { last: 0, pts: entry };
        if (!entry) { entry = { last: 0, pts: [] }; try { const legacy = await kv.get('pmh:' + nl); if (legacy) entry.pts = JSON.parse(legacy) || []; } catch (e) {} }
        let pts = entry.pts || [];
        const now = Date.now();
        const hb = Math.floor(now / 3600000);
        const lastHb = pts.length ? Math.floor(pts[pts.length - 1].t / 3600000) : -1;
        const newHour = (hb !== lastHb);
        if (newHour || (now - (entry.last || 0)) >= 1800000) {
          if (newHour) { pts.push({ t: now, m: Math.round(Number(out.stats.money)) }); if (pts.length > 400) pts = pts.slice(pts.length - 400); }
          entry.pts = pts; entry.last = now; db[nl] = entry;
          const names = Object.keys(db);
          if (names.length > 40) {
            names.sort(function (a, b) { return ((db[b] && db[b].last) || 0) - ((db[a] && db[a].last) || 0); });
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
