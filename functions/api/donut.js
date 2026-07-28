// Cloudflare Pages Function: proxy + aggregator for the official DonutSMP API.
// Token is the secret env var DONUT_TOKEN (set in the Cloudflare Pages dashboard) and never reaches the browser.
// Tracks a fixed WATCHLIST of high-value items, each looked up directly via the API search
// (sorted lowest_price) so expensive items always appear regardless of their price rank.
// ---- Preis-Historie -------------------------------------------------------
// Abtastung, Aufbewahrung und Aufloesung an einer Stelle konfigurierbar.
const SAMPLE_MS   = 120000;        // Abtastintervall: 2 Minuten
const COARSE_MS   = 600000;        // Grobraster fuer aeltere Daten: 10 Minuten
const FINE_WINDOW = 86400000;      // volle Aufloesung fuer die letzten 24 Stunden
const RETENTION   = 8 * 86400000;  // Aufbewahrung: 8 Tage

async function ensureSchema(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS price_samples (item TEXT NOT NULL, t INTEGER NOT NULL, o INTEGER, s INTEGER, PRIMARY KEY (item, t))'),
    db.prepare('CREATE TABLE IF NOT EXISTS sale_events (item TEXT NOT NULL, t INTEGER NOT NULL, p INTEGER NOT NULL, PRIMARY KEY (item, t, p))'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_ps_t ON price_samples(t)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_se_t ON sale_events(t)')
  ]);
}

// Liefert Punkte und Verkaufsevents fuer ein Item.
// Letzte 24 h in voller Aufloesung, aelteres nur auf dem 10-Minuten-Raster,
// damit die Charts nicht mit zehntausenden Punkten geflutet werden.
async function readHistory(env, hid) {
  let points = [];
  let sales = [];
  const db = env.DB;
  if (db) {
    const cut = Date.now() - FINE_WINDOW;
    const rs = await db.batch([
      db.prepare('SELECT t, o, s FROM price_samples WHERE item = ?1 AND t >= ?2 ORDER BY t').bind(hid, cut),
      db.prepare('SELECT t, o, s FROM price_samples WHERE item = ?1 AND t < ?2 AND t % 600000 = 0 ORDER BY t').bind(hid, cut),
      db.prepare('SELECT t, p FROM sale_events WHERE item = ?1 ORDER BY t').bind(hid)
    ]);
    const fine = (rs[0] && rs[0].results) || [];
    const coarse = (rs[1] && rs[1].results) || [];
    points = coarse.concat(fine);
    sales = ((rs[2] && rs[2].results) || []).map(r => ({ t: r.t, p: r.p }));
  }
  // Altbestand aus KV nur fuer den Zeitraum ergaenzen, den D1 noch nicht abdeckt.
  try {
    const kv = env.PRICE_HISTORY;
    if (kv) {
      const raw = await kv.get('phist');
      const hp = raw ? JSON.parse(raw) : null;
      const series = (hp && Array.isArray(hp.series)) ? hp.series : [];
      const firstT = points.length ? points[0].t : Infinity;
      const legacy = [];
      for (const row of series) {
        if (!row || row.t >= firstT) continue;
        const val = row.p ? row.p[hid] : null;
        if (val == null) continue;
        if (typeof val === 'number') legacy.push({ t: row.t, o: val, s: null });
        else legacy.push({ t: row.t, o: (val.o != null ? val.o : null), s: (val.s != null ? val.s : null) });
      }
      if (legacy.length) points = legacy.concat(points);
      const firstS = sales.length ? sales[0].t : Infinity;
      const sev = (hp && hp.sevents) ? hp.sevents : {};
      const oldSales = (sev[hid] || []).filter(x => x && x.t < firstS);
      if (oldSales.length) sales = oldSales.concat(sales);
    }
  } catch (e) {}
  points = points.filter(x => x && (x.o != null || x.s != null));
  return { points: points, sales: sales };
}

export async function onRequest(context) {
  const request = context.request;
  const env = context.env || {};
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=120' };
  const token = env.DONUT_TOKEN;
  if (!token) { return new Response(JSON.stringify({ error: 'no token configured' }), { status: 500, headers: cors }); }
  const auth = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
  const postHeaders = { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' };
  const base = 'https://api.donutsmp.net/v1/';
  const url = new URL(request.url);
  // Paywall: allow admin (Bearer DONUT_TOKEN) and the sampler cron; everyone else needs a valid access token.
  const _admin = env.DONUT_TOKEN && (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim() === env.DONUT_TOKEN;
  if (!_admin) {
    const _acc = request.headers.get('X-Access-Token') || '';
    let _ok = false;
    try { const _kv = env.PRICE_HISTORY; if (_acc && _kv) { const _r = await _kv.get('ac:token:' + _acc); if (_r) { const _t = JSON.parse(_r); _ok = _t && _t.expires > Date.now(); } } } catch (e) {}
    if (!_ok) { try { const _oc = await env.PRICE_HISTORY.get('ac:config'); if (_oc) { const _ocf = JSON.parse(_oc); if (_ocf && _ocf.open === true) _ok = true; } } catch (e) {} }
      if (!_ok) return new Response(JSON.stringify({ error: 'locked' }), { status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
  }
  if (url.searchParams.get('reset')) { const provided = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim(); if (!env.DONUT_TOKEN || provided !== env.DONUT_TOKEN) { return new Response(JSON.stringify({ reset: false, error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } }); } try { const kv = env.PRICE_HISTORY; if (kv) { await kv.put('series', '[]'); await kv.put('sevents', '{}'); try { await kv.delete('phist'); } catch (e2) {} } if (env.DB) { try { await env.DB.batch([env.DB.prepare('DELETE FROM price_samples'), env.DB.prepare('DELETE FROM sale_events')]); } catch (e3) {} } return new Response(JSON.stringify({ reset: true, cleared: ['series','sevents'] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } catch (e) { return new Response(JSON.stringify({ reset: false, error: String(e) }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } }
  if (url.searchParams.get('history')) {
    const hid = url.searchParams.get('history');
    const hcors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=120' };
    try {
      const h = await readHistory(env, hid);
      return new Response(JSON.stringify({ id: hid, points: h.points, sales: h.sales }), { status: 200, headers: hcors });
    } catch (e) {
      return new Response(JSON.stringify({ id: hid, points: [], sales: [], error: String(e) }), { status: 200, headers: hcors });
    }
  }

  const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  const exact = id => (x => x === 'minecraft:' + id);
  const WATCH = [
    { id: 'netherite_ingot', q: 'netherite_ingot', match: exact('netherite_ingot') },
    { id: 'netherite_scrap', q: 'netherite_scrap', match: exact('netherite_scrap') },
    { id: 'netherite_block', q: 'netherite_block', match: exact('netherite_block') },
    { id: 'enchanted_golden_apple', q: 'enchanted_golden_apple', match: exact('enchanted_golden_apple') },
    { id: 'elytra', q: 'elytra', match: exact('elytra') },
    { id: 'dragon_head', q: 'dragon_head', match: exact('dragon_head') }
  ];

  async function searchPage(q, p) {
    try {
      const r = await fetch(base + 'auction/list/' + p, { method: 'POST', headers: postHeaders, body: JSON.stringify({ search: q, sort: 'lowest_price' }) });
      if (!r.ok) return null;
      const j = await r.json();
      return (j && Array.isArray(j.result)) ? j.result.filter(Boolean) : [];
    } catch (e) { return null; }
  }

  async function collect(cfg, maxSearchPages) {
    const matches = [];
    let foundAtPage = null;
    for (let p = 1; p <= maxSearchPages; p++) {
      const arr = await searchPage(cfg.q, p);
      if (arr === null) break;
      const pageSize = arr.length;
      for (const l of arr) {
        if (!l) continue;
        const it = l.item || {};
        if (it.id && cfg.match(it.id) && typeof l.price === 'number') { matches.push(l); if (foundAtPage === null) foundAtPage = p; }
      }
      if (pageSize < 40) break;
      if (foundAtPage !== null && p >= foundAtPage + 1) break;
    }
    return matches;
  }

  async function getTxPages(maxPages) {
    let all = [];
    let size = 0;
    for (let p = 1; p <= maxPages; p++) {
      let r;
      try { r = await fetch(base + 'auction/transactions/' + p, { headers: auth }); } catch (e) { break; }
      if (!r.ok) break;
      const j = await r.json();
      const arr = (j && Array.isArray(j.result)) ? j.result.filter(Boolean) : [];
      if (!arr.length) break;
      if (!size) size = arr.length;
      all = all.concat(arr);
      if (arr.length < size) break;
    }
    return all;
  }

  try {
    const maxSearchPages = Math.min(parseInt(url.searchParams.get('pages'), 10) || 6, 8);
    const tx = await getTxPages(6);
    const concurrency = 5;
    const active = WATCH.filter(c => !c.soon);
    const items = [];
    // Letzte bekannte Verkaeufe aus KV laden (ausserhalb der Batch-Schleife,
    // damit die Werte beim Zurueckschreiben nach der Schleife noch im Scope sind).
    let _lsMap = {}; let _lsDirty = false;
    try { const _lskv = env.PRICE_HISTORY; if (_lskv) { const _r = await _lskv.get('lastsold'); if (_r) _lsMap = JSON.parse(_r) || {}; } } catch (e) { _lsMap = {}; }
    for (let i = 0; i < active.length; i += concurrency) {
      const slice = active.slice(i, i + concurrency);
    const results = await Promise.all(slice.map(cfg => collect(cfg, maxSearchPages)));
      for (let k = 0; k < slice.length; k++) {
        const cfg = slice[k];
        const listings = results[k].slice().sort((a, b) => a.price - b.price);
        let cheapest1 = null, cheapestAny = null, unit = null;
        const ah = []; const listUnits = [];
        for (const l of listings) {
          if (!l) continue;
          const count = (l.item && l.item.count) || 1;
          const per = count > 0 ? l.price / count : l.price;
          if (cheapestAny === null || l.price < cheapestAny) cheapestAny = l.price;
          if (unit === null || per < unit) unit = per;
          listUnits.push(per);
          if (count === 1 && (cheapest1 === null || l.price < cheapest1)) cheapest1 = l.price;
          ah.push({ seller: (l.seller && l.seller.name) || '?', price: l.price, count: count });
        }
        ah.sort((a, b) => (a.price / a.count) - (b.price / b.count));
        const sales = [];
        for (const t of tx) {
          if (!t) continue;
          const it = t.item || {};
          if (it.id && cfg.match(it.id) && typeof t.price === 'number') {
            sales.push({ seller: (t.seller && t.seller.name) || '?', price: t.price, count: it.count || 1, time: t.unixMillisDateSold || 0 });
          }
        }
        const sUnits = sales.map(s => ({ per: (s.count > 0 ? s.price / s.count : s.price), count: (s.count || 1) }));
        const soldUnits = sUnits.map(x => x.per);
        const soldU = soldUnits.length ? Math.round(Math.min.apply(null, soldUnits)) : null;
        sales.sort((a, b) => b.time - a.time);
        let last = sales[0] || null;
        if (last) { const _prev = _lsMap[cfg.id]; if (!_prev || _prev.time !== last.time || _prev.price !== last.price) { _lsMap[cfg.id] = { price: last.price, count: last.count, time: last.time, seller: last.seller }; _lsDirty = true; } }
        else if (_lsMap && _lsMap[cfg.id]) { last = _lsMap[cfg.id]; }
        const lus = listUnits.slice().sort((a, b) => a - b);
        const cluster = lus.length ? median(lus.slice(0, Math.min(5, lus.length))) : null;
        const listUnit = (cluster === null ? null : Math.round(cluster));
        let medSold = null;
        if (sUnits.length >= 3) { const a = sUnits.slice().sort((x, y) => x.per - y.per); const cut = Math.floor(a.length * 0.15); let mid = a.slice(cut, a.length - cut); if (!mid.length) mid = a; let sp = 0, sc = 0; for (const z of mid) { sp += z.per * z.count; sc += z.count; } medSold = sc > 0 ? Math.round(sp / sc) : null; }
        const approx = (medSold !== null ? medSold : listUnit); items.push({ id: 'minecraft:' + cfg.id, listings: listings.length, unit: listUnit, soldUnit: soldU, soldCount: soldUnits.length, price: (approx === null ? null : Math.round(approx)), lastSold: (last ? { unit: Math.round(last.price / (last.count || 1)), time: last.time } : null), cheapest1: cheapest1, cheapestAny: cheapestAny, ah: ah.slice(0, 12), sales: sales.slice(0, 12) });
      }
    }
    for (const cfg of WATCH) { if (cfg.soon) items.push({ id: 'minecraft:' + cfg.id, soon: true, listings: 0, unit: null, soldUnit: null, price: null, lastSold: null, cheapest1: null, cheapestAny: null, ah: [], sales: [] }); }
    // ---- Historie schreiben (D1) ---------------------------------------
    try {
      const db = env.DB;
      if (db) {
        await ensureSchema(db);
        const bucket = Math.round(Date.now() / SAMPLE_MS) * SAMPLE_MS;
        const stmts = [];
        for (const it of items) {
          if (it.soon) continue;
          const sid = it.id.replace('minecraft:', '');
          const o = (it.unit != null) ? it.unit : null;
          const s = (it.lastSold ? it.lastSold.unit : null);
          if (o == null && s == null) continue;
          stmts.push(db.prepare('INSERT OR REPLACE INTO price_samples (item, t, o, s) VALUES (?1, ?2, ?3, ?4)').bind(sid, bucket, o, s));
        }
        for (const it of items) {
          if (!it.sales || !it.sales.length) continue;
          const sid = it.id.replace('minecraft:', '');
          for (const sale of it.sales) {
            if (!sale.time) continue;
            const per = Math.round(sale.price / (sale.count || 1));
            stmts.push(db.prepare('INSERT OR IGNORE INTO sale_events (item, t, p) VALUES (?1, ?2, ?3)').bind(sid, sale.time, per));
          }
        }
        if (stmts.length) await db.batch(stmts);
        // Aufraeumen einmal pro Stunde, nicht bei jedem Lauf.
        if (bucket % 3600000 < SAMPLE_MS) {
          const oldest = Date.now() - RETENTION;
          await db.batch([
            db.prepare('DELETE FROM price_samples WHERE t < ?1').bind(oldest),
            db.prepare('DELETE FROM sale_events WHERE t < ?1').bind(oldest)
          ]);
        }
      }
    } catch (e) {}
    try { if (_lsDirty) { const _lskv2 = env.PRICE_HISTORY; if (_lskv2) await _lskv2.put('lastsold', JSON.stringify(_lsMap)); } } catch (e) {}
    const body = JSON.stringify({ lastUpdated: Date.now(), ver: 'listing-v2', watchlist: WATCH.length, salesScanned: tx.length, items: items });
    return new Response(body, { status: 200, headers: cors });
  } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: cors }); }
}
