// Cloudflare Pages Function: DonutSMP player stats + lookup proxy.
// Token is the secret env var DONUT_TOKEN; never reaches the browser.
// Money history lives in D1 (binding DB, table money_samples). Legacy points in KV 'mtrack'
// are still read and merged, so existing history survives. If DB is missing everything
// transparently falls back to the old KV-only behaviour.
export async function onRequest(context) {
  const request = context.request;
  const env = context.env || {};
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' };
  const nostore = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  const token = env.DONUT_TOKEN;
  const base = 'https://api.donutsmp.net/v1/';
  const url = new URL(request.url);
  const kv = env.PRICE_HISTORY;
  const db = env.DB || null;

  const FAV_MS = 900000, STD_MS = 3600000, WEEK = 604800000, RETAIN = 2592000000;
  const MAX_PER_RUN = 45; // stay under the 50 external-subrequest limit per invocation

  async function ensureSchema() {
    await db.batch([
      db.prepare('CREATE TABLE IF NOT EXISTS money_samples (player TEXT NOT NULL, t INTEGER NOT NULL, m INTEGER NOT NULL, PRIMARY KEY (player, t))'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ms_t ON money_samples(t)')
    ]);
  }

  if (!token) { return new Response(JSON.stringify({ error: 'no token configured' }), { status: 500, headers: cors }); }
  const auth = { Authorization: 'Bearer ' + token, Accept: 'application/json' };

  // ---- ungated: health, diagnostics, cron trigger (idempotent, bucket-gated) ----
  if (url.searchParams.get('ping')) {
    try { const r = await fetch(base + 'leaderboards/money/1', { headers: auth }); return new Response(JSON.stringify({ up: r.status < 500, status: r.status }), { status: 200, headers: cors }); }
    catch (e) { return new Response(JSON.stringify({ up: false, status: 0, error: String(e) }), { status: 200, headers: cors }); }
  }

  if (url.searchParams.get('d1check')) {
    const o = { d1Bound: !!db, kvBound: !!kv };
    if (db) {
      try { await ensureSchema(); const r = await db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT player) AS p, MAX(t) AS last FROM money_samples').first(); o.rows = r ? r.n : null; o.players = r ? r.p : null; o.last = r ? r.last : null; }
      catch (e) { o.error = String(e); }
    }
    return new Response(JSON.stringify(o), { status: 200, headers: nostore });
  }

  if (url.searchParams.get('sample')) {
    if (!kv) { return new Response(JSON.stringify({ error: 'no-kv' }), { status: 500, headers: nostore }); }
    let meta = {}; try { meta = JSON.parse((await kv.get('mtrack')) || '{}') || {}; } catch (e) { meta = {}; }
    const now = Date.now();
    let metaDirty = false, evicted = 0;
    const names = [];
    for (const nl of Object.keys(meta)) {
      let e = meta[nl];
      if (Array.isArray(e)) { e = { last: (e.length ? e[e.length - 1].t : 0), pts: e }; meta[nl] = e; metaDirty = true; }
      if (!e || (e.last || 0) < now - WEEK) { delete meta[nl]; evicted++; metaDirty = true; continue; }
      names.push(nl);
    }
    if (!names.length) {
      if (metaDirty) await kv.put('mtrack', JSON.stringify(meta));
      return new Response(JSON.stringify({ ok: true, tracked: 0, sampled: 0, evicted: evicted, skipped: true, store: db ? 'd1' : 'kv' }), { status: 200, headers: nostore });
    }

    const lastT = {};
    let useD1 = false;
    if (db) {
      try {
        await ensureSchema();
        const rs = await db.prepare('SELECT player, MAX(t) AS lt FROM money_samples WHERE t >= ? GROUP BY player').bind(now - STD_MS).all();
        (rs.results || []).forEach(function (r) { lastT[r.player] = r.lt; });
        useD1 = true;
      } catch (e) { useD1 = false; }
    }
    names.forEach(function (nl) {
      const p = (meta[nl] && meta[nl].pts) || [];
      const lp = p.length ? p[p.length - 1].t : 0;
      if (lp > (lastT[nl] || 0)) lastT[nl] = lp;
    });

    const due = names.filter(function (nl) {
      const bs = meta[nl].fav ? FAV_MS : STD_MS;
      return Math.floor(now / bs) !== Math.floor((lastT[nl] || 0) / bs);
    }).slice(0, MAX_PER_RUN);

    if (!due.length) {
      if (metaDirty) await kv.put('mtrack', JSON.stringify(meta));
      return new Response(JSON.stringify({ ok: true, tracked: names.length, sampled: 0, evicted: evicted, skipped: true, store: useD1 ? 'd1' : 'kv' }), { status: 200, headers: nostore });
    }

    const results = await Promise.all(due.map(function (nl) {
      return fetch(base + 'stats/' + encodeURIComponent(nl), { headers: auth })
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (j) { const s = (j && j.result !== undefined) ? j.result : j; return { nl: nl, s: s }; })
        .catch(function () { return { nl: nl, s: null }; });
    }));

    const rows = [];
    for (const it of results) {
      const s = it.s;
      if (!s || !isFinite(Number(s.money))) continue;
      rows.push({ nl: it.nl, m: Math.round(Number(s.money)) });
    }

    let sampled = 0;
    if (useD1 && rows.length) {
      try {
        const stmt = db.prepare('INSERT OR IGNORE INTO money_samples (player, t, m) VALUES (?, ?, ?)');
        await db.batch(rows.map(function (r) { return stmt.bind(r.nl, now, r.m); }));
        sampled = rows.length;
      } catch (e) { useD1 = false; }
    }
    if (!useD1 && rows.length) {
      rows.forEach(function (r) {
        const e = meta[r.nl]; let pts = e.pts || [];
        pts.push({ t: now, m: r.m });
        if (pts.length > 400) pts = pts.slice(pts.length - 400);
        e.pts = pts; meta[r.nl] = e; sampled++;
      });
      metaDirty = true;
    }
    if (metaDirty) await kv.put('mtrack', JSON.stringify(meta));
    if (useD1 && Math.random() < 0.01) { try { await db.prepare('DELETE FROM money_samples WHERE t < ?').bind(now - RETAIN).run(); } catch (e) {} }

    return new Response(JSON.stringify({ ok: true, tracked: names.length, sampled: sampled, evicted: evicted, store: useD1 ? 'd1' : 'kv' }), { status: 200, headers: nostore });
  }

  // ---- access gate for everything below ----
  const _admin = token && (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim() === token;
  if (!_admin) {
    const _acc = request.headers.get('X-Access-Token') || '';
    let _ok = false;
    try { if (_acc && kv) { const _r = await kv.get('ac:token:' + _acc); if (_r) { const _t = JSON.parse(_r); _ok = _t && _t.expires > Date.now(); } } } catch (e) {}
    if (!_ok) { try { const _oc = await kv.get('ac:config'); if (_oc) { const _ocf = JSON.parse(_oc); if (_ocf && _ocf.open === true) _ok = true; } } catch (e) {} }
    if (!_ok) return new Response(JSON.stringify({ error: 'locked' }), { status: 403, headers: nostore });
  }

  if (url.searchParams.get('money')) {
    const mn = String(url.searchParams.get('money')).trim().toLowerCase();
    const mcors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=120' };
    let pts = [];
    try {
      if (kv) { const meta = JSON.parse((await kv.get('mtrack')) || '{}') || {}; const e = meta[mn]; const legacy = (e && Array.isArray(e.pts)) ? e.pts : (Array.isArray(e) ? e : []); pts = legacy.slice(); }
    } catch (e) {}
    if (db) {
      try { const rs = await db.prepare('SELECT t, m FROM money_samples WHERE player = ? ORDER BY t').bind(mn).all(); (rs.results || []).forEach(function (r) { pts.push({ t: r.t, m: r.m }); }); } catch (e) {}
    }
    pts.sort(function (a, b) { return a.t - b.t; });
    const seen = {}, outPts = [];
    pts.forEach(function (p) { if (p && isFinite(p.t) && isFinite(p.m) && !seen[p.t]) { seen[p.t] = 1; outPts.push({ t: p.t, m: p.m }); } });
    return new Response(JSON.stringify({ name: mn, points: outPts }), { status: 200, headers: mcors });
  }

  if (url.searchParams.get('track') && url.searchParams.get('track') !== '1') {
    const tn = String(url.searchParams.get('track')).trim().toLowerCase();
    if (!kv || !tn) { return new Response(JSON.stringify({ ok: false }), { status: 200, headers: nostore }); }
    const _acc = request.headers.get('X-Access-Token') || '';
    let _ign = null;
    try { if (_acc) { const _r = await kv.get('ac:token:' + _acc); if (_r) { const _t = JSON.parse(_r); if (_t && _t.expires > Date.now() && _t.ign) _ign = _t.ign; } } } catch (e) {}
    if (!_ign) { return new Response(JSON.stringify({ ok: false, error: 'login-required' }), { status: 401, headers: nostore }); }
    const favParam = url.searchParams.get('fav');
    let meta = {}; try { meta = JSON.parse((await kv.get('mtrack')) || '{}') || {}; } catch (e) { meta = {}; }
    let entry = meta[tn];
    if (Array.isArray(entry)) entry = { last: 0, pts: entry };
    const now = Date.now();
    if (entry) { entry.last = now; meta[tn] = entry; }
    else {
      entry = { last: now, pts: [] };
      try {
        const r = await fetch(base + 'stats/' + encodeURIComponent(tn), { headers: auth });
        const j = await r.json().catch(function () { return null; });
        const s = (j && j.result !== undefined) ? j.result : j;
        if (s && isFinite(Number(s.money))) {
          const m0 = Math.round(Number(s.money));
          let stored = false;
          if (db) { try { await ensureSchema(); await db.prepare('INSERT OR IGNORE INTO money_samples (player, t, m) VALUES (?, ?, ?)').bind(tn, now, m0).run(); stored = true; } catch (e) {} }
          if (!stored) entry.pts.push({ t: now, m: m0 });
        } else { return new Response(JSON.stringify({ ok: false, error: 'not-found' }), { status: 200, headers: nostore }); }
      } catch (e) { return new Response(JSON.stringify({ ok: false, error: 'fetch' }), { status: 200, headers: nostore }); }
      meta[tn] = entry;
    }
    if (favParam !== null && meta[tn]) {
      const favOn = (favParam === '1' || favParam === 'on' || favParam === 'true');
      meta[tn].fav = favOn;
      if (favOn) { Object.keys(meta).forEach(function (k) { if (k !== tn && meta[k] && meta[k].fav) meta[k].fav = false; }); }
    }
    await kv.put('mtrack', JSON.stringify(meta));
    return new Response(JSON.stringify({ ok: true, tracked: Object.keys(meta).length, fav: !!(meta[tn] && meta[tn].fav) }), { status: 200, headers: nostore });
  }

  const name = (url.searchParams.get('name') || '').trim();
  if (!name) { return new Response(JSON.stringify({ error: 'no name' }), { status: 400, headers: cors }); }

  const out = { name: name };
  try { const r = await fetch(base + 'stats/' + encodeURIComponent(name), { headers: auth }); out.statsStatus = r.status; const j = await r.json().catch(() => null); out.stats = (j && j.result !== undefined) ? j.result : j; } catch (e) { out.statsError = String(e); }
  try { const r = await fetch(base + 'lookup/' + encodeURIComponent(name), { headers: auth }); out.lookupStatus = r.status; const j = await r.json().catch(() => null); out.lookup = (j && j.result !== undefined) ? j.result : j; } catch (e) { out.lookupError = String(e); }
  return new Response(JSON.stringify(out), { status: 200, headers: cors });
}
