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
      let db = {}; try { db = JSON.parse((await kv.get('mtrack')) || '{}') || {}; } catch (e) { db = {}; }
      let e0 = db[mn]; let points = (e0 && Array.isArray(e0.pts)) ? e0.pts : (Array.isArray(e0) ? e0 : null);
      if (!points) points = [];
      return new Response(JSON.stringify({ name: mn, points: points || [] }), { status: 200, headers: mcors });
    } catch (e) { return new Response(JSON.stringify({ name: mn, points: [] }), { status: 200, headers: mcors }); }
  }

  if (url.searchParams.get('sample')) {
    const scors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    // sampling is idempotent (time-bucket gated) -> safe to trigger publicly via page traffic / external pinger; admin token still works. (_admin available if needed)
    const kv = env.PRICE_HISTORY;
    if (!kv) { return new Response(JSON.stringify({ error: 'no-kv' }), { status: 500, headers: scors }); }
    let db = {}; try { db = JSON.parse((await kv.get('mtrack')) || '{}') || {}; } catch (e) { db = {}; }
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
    const due = active.filter(function (nl) {
      const pts = db[nl].pts || [];
      const bs = db[nl].fav ? 900000 : 3600000;
      const lastB = pts.length ? Math.floor(pts[pts.length - 1].t / bs) : -1;
      return Math.floor(now / bs) !== lastB;
    }).slice(0, 45);
    if (due.length === 0) {
      if (evicted > 0) await kv.put('mtrack', JSON.stringify(db));
      return new Response(JSON.stringify({ ok: true, tracked: Object.keys(db).length, sampled: 0, evicted: evicted, skipped: true }), { status: 200, headers: scors });
    }
    const results = await Promise.all(due.map(function (nl) {
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
      const bs = db[it.nl].fav ? 900000 : 3600000;
      const lastB = pts.length ? Math.floor(pts[pts.length - 1].t / bs) : -1;
      if (Math.floor(now / bs) !== lastB) { pts.push({ t: now, m: Math.round(Number(s.money)) }); if (pts.length > 400) pts = pts.slice(pts.length - 400); entry.pts = pts; db[it.nl] = entry; sampled++; }
    }
    await kv.put('mtrack', JSON.stringify(db));
    return new Response(JSON.stringify({ ok: true, tracked: Object.keys(db).length, sampled: sampled, evicted: evicted }), { status: 200, headers: scors });
  }

  if (url.searchParams.get('track') && url.searchParams.get('track') !== '1') {
    const tcors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    const tn = String(url.searchParams.get('track')).trim().toLowerCase();
    const kv = env.PRICE_HISTORY;
    if (!kv || !tn) { return new Response(JSON.stringify({ ok: false }), { status: 200, headers: tcors }); }
    const _acc = request.headers.get('X-Access-Token') || '';
    let _ign = null;
    try { if (_acc) { const _r = await kv.get('ac:token:' + _acc); if (_r) { const _t = JSON.parse(_r); if (_t && _t.expires > Date.now() && _t.ign) _ign = _t.ign; } } } catch (e) {}
    if (!_ign) { return new Response(JSON.stringify({ ok: false, error: 'login-required' }), { status: 401, headers: tcors }); }
    const favParam = url.searchParams.get('fav');
    let db = {}; try { db = JSON.parse((await kv.get('mtrack')) || '{}') || {}; } catch (e) { db = {}; }
    let entry = db[tn];
    if (Array.isArray(entry)) entry = { last: 0, pts: entry };
    const now = Date.now();
    if (entry) {
      entry.last = now; db[tn] = entry;
    } else {
      entry = { last: now, pts: [] };
      try {
        const r = await fetch(base + 'stats/' + encodeURIComponent(tn), { headers: auth });
        const j = await r.json().catch(function () { return null; });
        const s = (j && j.result !== undefined) ? j.result : j;
        if (s && isFinite(Number(s.money))) { entry.pts.push({ t: now, m: Math.round(Number(s.money)) }); }
        else { return new Response(JSON.stringify({ ok: false, error: 'not-found' }), { status: 200, headers: tcors }); }
      } catch (e) { return new Response(JSON.stringify({ ok: false, error: 'fetch' }), { status: 200, headers: tcors }); }
      db[tn] = entry;
    }
    if (favParam !== null && db[tn]) {
      const favOn = (favParam === '1' || favParam === 'on' || favParam === 'true');
      db[tn].fav = favOn;
      // only ONE favourite at a time -> clear the flag on every other tracked player
      if (favOn) { Object.keys(db).forEach(function (k) { if (k !== tn && db[k] && db[k].fav) db[k].fav = false; }); }
    }
    const names = Object.keys(db);
    if (names.length > 40) {
      names.sort(function (a, b) { return ((db[b] && db[b].last) || 0) - ((db[a] && db[a].last) || 0); });
      const keep = {}; names.slice(0, 40).forEach(function (k) { keep[k] = db[k]; });
      db = keep;
    }
    await kv.put('mtrack', JSON.stringify(db));
    return new Response(JSON.stringify({ ok: true, tracked: Object.keys(db).length, fav: !!(db[tn] && db[tn].fav) }), { status: 200, headers: tcors });
  }

  const name = (url.searchParams.get('name') || '').trim();
  if (!name) { return new Response(JSON.stringify({ error: 'no name' }), { status: 400, headers: cors }); }

  const out = { name: name };
  try { const r = await fetch(base + 'stats/' + encodeURIComponent(name), { headers: auth }); out.statsStatus = r.status; const j = await r.json().catch(() => null); out.stats = (j && j.result !== undefined) ? j.result : j; } catch (e) { out.statsError = String(e); }
  try { const r = await fetch(base + 'lookup/' + encodeURIComponent(name), { headers: auth }); out.lookupStatus = r.status; const j = await r.json().catch(() => null); out.lookup = (j && j.result !== undefined) ? j.result : j; } catch (e) { out.lookupError = String(e); }
  // Money history: opt-in via track=1 (frontend sends it only for saved players). Hourly throttle, per-player key, capped index.
  // (money history is recorded only via explicit ?track)
  return new Response(JSON.stringify(out), { status: 200, headers: cors });
}
