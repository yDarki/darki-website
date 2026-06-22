// Cloudflare Pages Function: DonutSMP player stats + lookup proxy.
// Token is the secret env var DONUT_TOKEN; never reaches the browser.
export async function onRequest(context) {
  const request = context.request;
  const env = context.env || {};
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' };
  const token = env.DONUT_TOKEN;
  if (!token) { return new Response(JSON.stringify({ error: 'no token configured' }), { status: 500, headers: cors }); }
  const auth = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
  const base = 'https://api.donutsmp.net/v1/';
  const url = new URL(request.url);

  // Debug helper to grab a real username from the money leaderboard.
  if (url.searchParams.get('lb')) {
    try { const r = await fetch(base + 'leaderboards/money/1', { headers: auth }); const txt = await r.text(); return new Response(txt, { status: r.status, headers: cors }); } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: cors }); }
  }

  if (url.searchParams.get('ping')) {
    try {
      const r = await fetch(base + 'leaderboards/money/1', { headers: auth });
      return new Response(JSON.stringify({ up: r.status < 500, status: r.status }), { status: 200, headers: cors });
    } catch (e) {
      return new Response(JSON.stringify({ up: false, status: 0, error: String(e) }), { status: 200, headers: cors });
    }
  }

  const name = (url.searchParams.get('name') || '').trim();
  if (!name) { return new Response(JSON.stringify({ error: 'no name' }), { status: 400, headers: cors }); }

  const out = { name: name };
  try { const r = await fetch(base + 'stats/' + encodeURIComponent(name), { headers: auth }); out.statsStatus = r.status; const j = await r.json().catch(() => null); out.stats = (j && j.result !== undefined) ? j.result : j; } catch (e) { out.statsError = String(e); }
  try { const r = await fetch(base + 'lookup/' + encodeURIComponent(name), { headers: auth }); out.lookupStatus = r.status; const j = await r.json().catch(() => null); out.lookup = (j && j.result !== undefined) ? j.result : j; } catch (e) { out.lookupError = String(e); }
  return new Response(JSON.stringify(out), { status: 200, headers: cors });
}
