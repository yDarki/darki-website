// Cloudflare Pages deploy trigger 2026-06-14T01:57:54.520Z
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
  const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  const exact = id => (x => x === 'minecraft:' + id);
  const WATCH = [
    { id: 'netherite_ingot', q: 'netherite_ingot', match: exact('netherite_ingot') },
    { id: 'netherite_scrap', q: 'netherite_scrap', match: exact('netherite_scrap') },
    { id: 'netherite_block', q: 'netherite_block', match: exact('netherite_block') },
    { id: 'diamond', q: 'diamond', match: exact('diamond') },
    { id: 'diamond_block', q: 'diamond_block', match: exact('diamond_block') },
    { id: 'iron_ingot', q: 'iron_ingot', match: exact('iron_ingot') },
    { id: 'iron_block', q: 'iron_block', match: exact('iron_block') },
    { id: 'gold_ingot', q: 'gold_ingot', match: exact('gold_ingot') },
    { id: 'gold_block', q: 'gold_block', match: exact('gold_block') },
    { id: 'obsidian', q: 'obsidian', match: exact('obsidian') },
    { id: 'crying_obsidian', q: 'crying_obsidian', match: exact('crying_obsidian') },
    { id: 'respawn_anchor', q: 'respawn_anchor', match: exact('respawn_anchor') },
    { id: 'end_crystal', q: 'end_crystal', match: exact('end_crystal') },
    { id: 'golden_apple', q: 'golden_apple', match: exact('golden_apple') },
    { id: 'enchanted_golden_apple', q: 'enchanted_golden_apple', match: exact('enchanted_golden_apple') },
    { id: 'elytra', q: 'elytra', match: exact('elytra') },
    { id: 'shulker_box', q: 'shulker_box', match: (x => x.indexOf('shulker_box') !== -1) },
    { id: 'shulker_shell', q: 'shulker_shell', match: exact('shulker_shell') },
    { id: 'totem_of_undying', q: 'totem_of_undying', match: exact('totem_of_undying') },
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

  if (url.searchParams.get('tx')) {
    const q2 = url.searchParams.get('q') || 'iron_ingot';
    const out2 = {};
    try { const r = await fetch(base + 'auction/transactions/1', { headers: auth }); const j = await r.json(); const arr = (j && j.result) || []; out2.get = { status: r.status, n: arr.length, first3: arr.slice(0,3).map(t => ({ id: t && t.item ? t.item.id : null, price: t ? t.price : null, c: t && t.item ? t.item.count : null, time: t ? t.unixMillisDateSold : null })) }; } catch (e) { out2.get = String(e); }
    try { const r = await fetch(base + 'auction/transactions/1', { method: 'POST', headers: postHeaders, body: JSON.stringify({ search: q2, sort: 'lowest_price' }) }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {} const arr = (j && j.result) || []; out2.post = { status: r.status, n: arr.length, raw: j ? null : txt.slice(0,150), first5: arr.slice(0,5).map(t => ({ id: t && t.item ? t.item.id : null, price: t ? t.price : null, c: t && t.item ? t.item.count : null })) }; } catch (e) { out2.post = String(e); }
    return new Response(JSON.stringify(out2, null, 1), { status: 200, headers: cors });
  }

  if (url.searchParams.get('debug')) {
    const qp = url.searchParams.get('q'); const q = (qp !== null) ? qp : 'diamond';
    const out = {};
    const target = 'minecraft:' + (url.searchParams.get('id') || q); out.target = target; out.q = q; const maxP = Math.min(parseInt(url.searchParams.get('pages'),10)||10,40); let seen=0,cnt=0,firstPage=null,minTotal=null,minUnit=null; const few=[]; for (let p=1;p<=maxP;p++){ const arr=await searchPage(q,p); if(arr===null) break; for(const l of arr){ if(!l||!l.item) continue; seen++; if(l.item.id===target && typeof l.price==='number'){ cnt++; if(firstPage===null) firstPage=p; const cc=l.item.count||1; if(minTotal===null||l.price<minTotal) minTotal=l.price; const u=Math.round(l.price/cc); if(minUnit===null||u<minUnit) minUnit=u; if(few.length<6) few.push({tot:l.price,c:cc}); } } if(arr.length<40) break; } out.maxP=maxP; out.seen=seen; out.cnt=cnt; out.firstPage=firstPage; out.minTotal=minTotal; out.minUnit=minUnit; out.few=few;
    return new Response(JSON.stringify(out, null, 1), { status: 200, headers: cors });
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
      if (foundAtPage !== null && p >= foundAtPage + 2) break;
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
    const maxSearchPages = Math.min(parseInt(url.searchParams.get('pages'), 10) || 8, 10);
    const tx = await getTxPages(15);
    const concurrency = 5;
    const items = [];
    for (let i = 0; i < WATCH.length; i += concurrency) {
      const slice = WATCH.slice(i, i + concurrency);
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
        const soldUnits = sales.map(s => (s.count > 0 ? s.price / s.count : s.price)); const soldU = soldUnits.length ? Math.round(Math.min.apply(null, soldUnits)) : null; sales.sort((a, b) => b.time - a.time); const last = sales[0] || null; const listUnit = (unit === null ? null : Math.round(unit)); const medSold = median(soldUnits); const medList = median(listUnits); const approx = (medSold !== null ? medSold : medList); items.push({ id: 'minecraft:' + cfg.id, listings: listings.length, unit: listUnit, soldUnit: soldU, soldCount: soldUnits.length, price: (approx === null ? null : Math.round(approx)), lastSold: (last ? { unit: Math.round(last.price / (last.count || 1)), time: last.time } : null), cheapest1: cheapest1, cheapestAny: cheapestAny, ah: ah.slice(0, 12), sales: sales.slice(0, 12) });
      }
    }
    const body = JSON.stringify({ lastUpdated: Date.now(), watchlist: WATCH.length, salesScanned: tx.length, items: items });
    return new Response(body, { status: 200, headers: cors });
  } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: cors }); }
}
