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

  // Alle verfolgten Spieler werden im selben Takt abgetastet (kein Favoriten-Sonderfall mehr).
  const SAMPLE_MS = 900000, WEEK = 604800000, RETAIN = 2592000000;
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
      if (e.fav !== undefined) { delete e.fav; metaDirty = true; } // Altlast aus der Favoriten-Zeit
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
        const rs = await db.prepare('SELECT player, MAX(t) AS lt FROM money_samples WHERE t >= ? GROUP BY player').bind(now - SAMPLE_MS).all();
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
      return Math.floor(now / SAMPLE_MS) !== Math.floor((lastT[nl] || 0) / SAMPLE_MS);
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

    // Ein erfolgreich abgetasteter Spieler gilt als aktiv - sonst wuerde er nach einer
    // Woche aus mtrack fliegen, obwohl er durchgehend abgetastet wurde.
    rows.forEach(function (r) { if (meta[r.nl]) { meta[r.nl].last = now; metaDirty = true; } });

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


  // ---- Besitz-Logik: jeder Account verfolgt bis zu MAX_OWNED Spieler, die Historie
  // ---- ist danach aber fuer alle sichtbar. -----------------------------------
  const MAX_OWNED = 3;
  const ownersOf = (e) => (e && Array.isArray(e.owners)) ? e.owners : [];
  const countOwned = (meta, ign) => ign ? Object.keys(meta).filter(function (k) { return ownersOf(meta[k]).indexOf(ign) >= 0; }).length : 0;
  async function callerIgn() {
    const acc = request.headers.get('X-Access-Token') || '';
    if (!acc || !kv) return null;
    try {
      const r = await kv.get('ac:token:' + acc);
      if (!r) return null;
      const t = JSON.parse(r);
      if (t && t.expires > Date.now() && t.ign) return String(t.ign).trim().toLowerCase();
    } catch (e) {}
    return null;
  }

  if (url.searchParams.get('money')) {
    const mn = String(url.searchParams.get('money')).trim().toLowerCase();
    // Antwort haengt vom Aufrufer ab (mine/mineCount), deshalb bewusst nicht cachen.
    const mcors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    const ign = await callerIgn();
    let pts = [], isTracked = false, mine = false, mineCount = 0, ownerCount = 0;
    try {
      if (kv) {
        const meta = JSON.parse((await kv.get('mtrack')) || '{}') || {};
        const e = meta[mn];
        isTracked = !!e;
        const own = ownersOf(e);
        ownerCount = own.length;
        mine = !!ign && own.indexOf(ign) >= 0;
        mineCount = countOwned(meta, ign);
        const legacy = (e && Array.isArray(e.pts)) ? e.pts : (Array.isArray(e) ? e : []);
        pts = legacy.slice();
      }
    } catch (e) {}
    if (db) {
      try { const rs = await db.prepare('SELECT t, m FROM money_samples WHERE player = ? ORDER BY t').bind(mn).all(); (rs.results || []).forEach(function (r) { pts.push({ t: r.t, m: r.m }); }); } catch (e) {}
    }
    pts.sort(function (a, b) { return a.t - b.t; });
    const seen = {}, outPts = [];
    pts.forEach(function (p) { if (p && isFinite(p.t) && isFinite(p.m) && !seen[p.t]) { seen[p.t] = 1; outPts.push({ t: p.t, m: p.m }); } });
    return new Response(JSON.stringify({ name: mn, points: outPts, tracked: isTracked, mine: mine, mineCount: mineCount, owners: ownerCount, slots: MAX_OWNED }), { status: 200, headers: mcors });
  }

  // ---- track / untrack (Login noetig; Besitz zaehlt, Sichtbarkeit ist global) ----
  const _tp = url.searchParams.get('track');
  const _up = url.searchParams.get('untrack');
  if (_up || (_tp && _tp !== '1')) {
    const tn = String(_up || _tp).trim().toLowerCase();
    if (!kv || !tn) return new Response(JSON.stringify({ ok: false, error: 'bad-request' }), { status: 200, headers: nostore });
    const ign = await callerIgn();
    if (!ign) return new Response(JSON.stringify({ ok: false, error: 'login-required' }), { status: 401, headers: nostore });

    let meta = {}; try { meta = JSON.parse((await kv.get('mtrack')) || '{}') || {}; } catch (e) { meta = {}; }
    const now = Date.now();

    if (_up) {
      const e = meta[tn];
      if (e) {
        const rest = ownersOf(e).filter(function (o) { return o !== ign; });
        if (rest.length) { e.owners = rest; meta[tn] = e; }
        else { delete meta[tn]; } // niemand verfolgt ihn mehr -> Abtastung stoppt
      }
      await kv.put('mtrack', JSON.stringify(meta));
      return new Response(JSON.stringify({ ok: true, mine: false, tracked: !!meta[tn], mineCount: countOwned(meta, ign), slots: MAX_OWNED }), { status: 200, headers: nostore });
    }

    let entry = meta[tn];
    if (Array.isArray(entry)) entry = { last: 0, pts: entry };
    const alreadyMine = ownersOf(entry).indexOf(ign) >= 0;
    // Ein Spieler gehoert genau einem Account. Wird er schon von jemandem verfolgt,
    // waere ein zweiter Slot verschwendet - die Historie ist ohnehin fuer alle sichtbar.
    if (!alreadyMine && ownersOf(entry).length > 0) {
      return new Response(JSON.stringify({ ok: false, error: 'owned', mineCount: countOwned(meta, ign), slots: MAX_OWNED }), { status: 200, headers: nostore });
    }
    if (!alreadyMine && countOwned(meta, ign) >= MAX_OWNED) {
      return new Response(JSON.stringify({ ok: false, error: 'limit', mineCount: countOwned(meta, ign), slots: MAX_OWNED }), { status: 200, headers: nostore });
    }

    if (entry) { entry.last = now; }
    else {
      entry = { last: now, pts: [], owners: [] };
      try {
        const r = await fetch(base + 'stats/' + encodeURIComponent(tn), { headers: auth });
        const j = await r.json().catch(function () { return null; });
        const st = (j && j.result !== undefined) ? j.result : j;
        if (st && isFinite(Number(st.money))) {
          const m0 = Math.round(Number(st.money));
          let stored = false;
          if (db) { try { await ensureSchema(); await db.prepare('INSERT OR IGNORE INTO money_samples (player, t, m) VALUES (?, ?, ?)').bind(tn, now, m0).run(); stored = true; } catch (e) {} }
          if (!stored) entry.pts.push({ t: now, m: m0 });
        } else { return new Response(JSON.stringify({ ok: false, error: 'not-found' }), { status: 200, headers: nostore }); }
      } catch (e) { return new Response(JSON.stringify({ ok: false, error: 'fetch' }), { status: 200, headers: nostore }); }
    }
    const own = ownersOf(entry);
    if (own.indexOf(ign) < 0) own.push(ign);
    entry.owners = own;
    meta[tn] = entry;
    await kv.put('mtrack', JSON.stringify(meta));
    return new Response(JSON.stringify({ ok: true, mine: true, tracked: true, mineCount: countOwned(meta, ign), slots: MAX_OWNED }), { status: 200, headers: nostore });
  }

  const name = (url.searchParams.get('name') || '').trim();
  if (!name) { return new Response(JSON.stringify({ error: 'no name' }), { status: 400, headers: cors }); }

  const out = { name: name };
  try { const r = await fetch(base + 'stats/' + encodeURIComponent(name), { headers: auth }); out.statsStatus = r.status; const j = await r.json().catch(() => null); out.stats = (j && j.result !== undefined) ? j.result : j; } catch (e) { out.statsError = String(e); }
  try { const r = await fetch(base + 'lookup/' + encodeURIComponent(name), { headers: auth }); out.lookupStatus = r.status; const j = await r.json().catch(() => null); out.lookup = (j && j.result !== undefined) ? j.result : j; } catch (e) { out.lookupError = String(e); }
  return new Response(JSON.stringify(out), { status: 200, headers: cors });
}
