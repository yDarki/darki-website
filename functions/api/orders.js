// Cloudflare Pages Function: DonutSMP buy-order search proxy.
// Source: donut.auction (https://donut.auction). Served server-side to avoid CORS.
export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' };
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) { return new Response(JSON.stringify({ error: 'no query' }), { status: 400, headers: cors }); }
  const sort = url.searchParams.get('sort') || 'MaxPrice';
  const cursor = url.searchParams.get('cursor') || '';
  const api = 'https://api.donut.auction/v2/orders/search/?query=' + encodeURIComponent(q) + '&sort=' + encodeURIComponent(sort) + '&cursor=' + encodeURIComponent(cursor);
  try {
    const r = await fetch(api, { headers: { Accept: 'application/json' } });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (!j) { return new Response(JSON.stringify({ error: 'bad upstream', status: r.status }), { status: 502, headers: cors }); }
    return new Response(JSON.stringify({ orders: j.orders || [], nextCursor: j.nextCursor || null, source: 'donut.auction' }), { status: 200, headers: cors });
  } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: cors }); }
}
