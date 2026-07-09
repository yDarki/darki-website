// Cloudflare Pages Function: proxy + aggregator for the official DonutSMP API.
// Token is the secret env var DONUT_TOKEN (set in the Cloudflare Pages dashboard) and never reaches the browser.
// Tracks a fixed WATCHLIST of high-value items, each looked up directly via the API search
// (sorted lowest_price) so expensive items always appear regardless of their price rank.
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
  if (url.searchParams.get('reset')) { const provided = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim(); if (!env.DONUT_TOKEN || provided !== env.DONUT_TOKEN) { return new Response(JSON.stringify({ reset: false, error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } }); } try { const kv = env.PRICE_HISTORY; if (kv) { await kv.put('series', '[]'); await kv.put('sevents', '{}'); } return new Response(JSON.stringify({ reset: true, cleared: ['series','sevents'] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } catch (e) { return new Response(JSON.stringify({ reset: false, error: String(e) }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } }
  if (url.searchParams.get('history')) {
    const hid = url.searchParams.get('history');
    const hcors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=120' };
    const hkv = env.PRICE_HISTORY;
    if (!hkv) return new Response(JSON.stringify({ id: hid, points: [], note: 'no-kv' }), { status: 200, headers: hcors });
    try { let _hh = null; try { const _hhr = await hkv.get('phist'); _hh = _hhr ? JSON.parse(_hhr) : null; } catch (_e5) {} let series = (_hh && Array.isArray(_hh.series)) ? _hh.series : []; if (!series.length) { try { const raw = await hkv.get('series'); if (raw) series = JSON.parse(raw) || []; } catch (_e6) {} } const points = series.map(s => { var v = (s.p && s.p[hid] != null) ? s.p[hid] : null; if (v == null) return null; if (typeof v === "number") return { t: s.t, o: v, s: null }; return { t: s.t, o: (v.o != null ? v.o : null), s: (v.s != null ? v.s : null) }; }).filter(x => x && (x.o != null || x.s != null)); let sales = []; try { let sev = (_hh && _hh.sevents) ? _hh.sevents : null; if (!sev) { const sraw = await hkv.get('sevents'); sev = sraw ? JSON.parse(sraw) : {}; } sales = sev[hid] || []; } catch (e8) {} return new Response(JSON.stringify({ id: hid, points: points, sales: sales }), { status: 200, headers: hcors }); } catch (e) { return new Response(JSON.stringify({ id: hid, points: [], error: String(e) }), { status: 200, headers: hcors }); }
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
        const last = sales[0] || null;
        const lus = listUnits.slice().sort((a, b) => a - b);
        const cluster = lus.length ? median(lus.slice(0, Math.min(5, lus.length))) : null;
        const listUnit = (cluster === null ? null : Math.round(cluster));
        let medSold = null;
        if (sUnits.length >= 3) { const a = sUnits.slice().sort((x, y) => x.per - y.per); const cut = Math.floor(a.length * 0.15); let mid = a.slice(cut, a.length - cut); if (!mid.length) mid = a; let sp = 0, sc = 0; for (const z of mid) { sp += z.per * z.count; sc += z.count; } medSold = sc > 0 ? Math.round(sp / sc) : null; }
        const approx = (medSold !== null ? medSold : listUnit); items.push({ id: 'minecraft:' + cfg.id, listings: listings.length, unit: listUnit, soldUnit: soldU, soldCount: soldUnits.length, price: (approx === null ? null : Math.round(approx)), lastSold: (last ? { unit: Math.round(last.price / (last.count || 1)), time: last.time } : null), cheapest1: cheapest1, cheapestAny: cheapestAny, ah: ah.slice(0, 12), sales: sales.slice(0, 12) });
      }
    }
    for (const cfg of WATCH) { if (cfg.soon) items.push({ id: 'minecraft:' + cfg.id, soon: true, listings: 0, unit: null, soldUnit: null, price: null, lastSold: null, cheapest1: null, cheapestAny: null, ah: [], sales: [] }); }
    try { const skv = env.PRICE_HISTORY; if (skv) { let _hpRaw = await skv.get('phist'); let _hp = null; try { _hp = _hpRaw ? JSON.parse(_hpRaw) : null; } catch (_e0) {} let series = (_hp && Array.isArray(_hp.series)) ? _hp.series : []; if (!series.length) { try { const _lgs = await skv.get('series'); if (_lgs) series = JSON.parse(_lgs) || []; } catch (_e1) {} } let _sevPre = (_hp && _hp.sevents && typeof _hp.sevents === 'object') ? _hp.sevents : null; const last = series.length ? series[series.length - 1].t : 0; var t10 = Math.round(Date.now() / 600000) * 600000; if (last !== t10) { const pm = {}; for (const it of items) { const sid = it.id.replace('minecraft:', ''); var _o=(it.unit!=null?it.unit:null); var _s=(it.lastSold?it.lastSold.unit:null); if (_o!=null || _s!=null) pm[sid] = {o:_o,s:_s}; } series.push({ t: t10, p: pm }); if (series.length > 2100) series = series.slice(series.length - 2100); let sev = _sevPre || {}; if (!_sevPre) { try { const sraw = await skv.get('sevents'); sev = sraw ? JSON.parse(sraw) : {}; } catch (_e4) {} } try { for (const it of items) { if (!it.sales || !it.sales.length) continue; const sid2 = it.id.replace('minecraft:',''); let arr = sev[sid2] || []; const seen = {}; for (const ev of arr) seen[ev.t + ':' + ev.p] = 1; for (const s of it.sales) { if (!s.time) continue; const per = Math.round(s.price / (s.count || 1)); const k = s.time + ':' + per; if (!seen[k]) { arr.push({ t: s.time, p: per }); seen[k] = 1; } } arr.sort(function(a,b){return a.t-b.t;}); if (arr.length > 400) arr = arr.slice(arr.length - 400); sev[sid2] = arr; } } catch (e9) {} try { await skv.put('phist', JSON.stringify({ series: series, sevents: sev })); } catch (e10) {} } } } catch (e) {}
    const body = JSON.stringify({ lastUpdated: Date.now(), ver: 'listing-v2', watchlist: WATCH.length, salesScanned: tx.length, items: items });
    return new Response(body, { status: 200, headers: cors });
  } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: cors }); }
}
