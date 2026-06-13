// Netlify serverless proxy + aggregator for the official DonutSMP API.
// Token is a secret env var (DONUT_TOKEN) and never reaches the browser.
export default async (req) => {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' };
  const token = process.env.DONUT_TOKEN;
  if (!token) { return new Response(JSON.stringify({ error: 'no token configured' }), { status: 500, headers: cors }); }
  const auth = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
  const base = 'https://api.donutsmp.net/v1/';
  async function getPages(type, maxPages) {
    let all = [];
    for (let p = 1; p <= maxPages; p++) {
      let r;
      try { r = await fetch(base + type + '/' + p, { headers: auth }); } catch (e) { break; }
      if (!r.ok) break;
      const j = await r.json();
      const arr = (j && j.result) || [];
      if (!arr.length) break;
      all = all.concat(arr);
      if (arr.length < 40) break;
    }
    return all;
  }
  try {
    const listings = await getPages('auction/list', 10);
    const tx = await getPages('auction/transactions', 3);
    const map = {};
    function row(id) { if (!map[id]) map[id] = { id: id, listings: 0, cheapest1: null, cheapestAny: null, ah: [], sales: [] }; return map[id]; }
    for (const l of listings) {
      const it = l.item || {};
      if (!it.id) continue;
      const price = l.price;
      if (typeof price !== 'number') continue;
      const count = it.count || 1;
      const m = row(it.id);
      m.listings++;
      if (m.cheapestAny === null || price < m.cheapestAny) m.cheapestAny = price;
      if (count === 1 && (m.cheapest1 === null || price < m.cheapest1)) m.cheapest1 = price;
      m.ah.push({ seller: (l.seller && l.seller.name) || '?', price: price, count: count });
    }
    for (const t of tx) {
      const it = t.item || {};
      if (!it.id) continue;
      if (typeof t.price !== 'number') continue;
      const m = row(it.id);
      m.sales.push({ seller: (t.seller && t.seller.name) || '?', price: t.price, count: it.count || 1, time: t.unixMillisDateSold || 0 });
    }
    const items = Object.values(map).map(function (m) { return { id: m.id, listings: m.listings, cheapest1: m.cheapest1, cheapestAny: m.cheapestAny, ah: m.ah.sort(function (a, b) { return a.price - b.price; }).slice(0, 10), sales: m.sales.sort(function (a, b) { return b.time - a.time; }).slice(0, 10) }; });
    const body = JSON.stringify({ lastUpdated: Date.now(), listingsScanned: listings.length, salesScanned: tx.length, items: items });
    return new Response(body, { status: 200, headers: cors });
  } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: cors }); }
};
