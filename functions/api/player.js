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
    try { const raw = await kv.get('pmh:' + mn); const points = raw ? JSON.parse(raw) : []; return new Response(JSON.stringify({ name: mn, points: points }), { status: 200, headers: mcors }); }
    catch (e) { return new Response(JSON.stringify({ name: mn, points: [], error: String(e) }), { status: 200, headers: mcors }); }
  }

  const name = (url.searchParams.get('name') || '').trim();
  if (!name) { return new Response(JSON.stringify({ error: 'no name' }), { status: 400, headers: cors }); }

  const out = { name: name };
  try { const r = await fetch(base + 'stats/' + encodeURIComponent(name), { headers: auth }); out.statsStatus = r.status; const j = await r.json().catch(() => null); out.stats = (j && j.result !== undefined) ? j.result : j; } catch (e) { out.statsError = String(e); }
  try { const r = await fetch(base + 'lookup/' + encodeURIComponent(name), { headers: auth }); out.lookupStatus = r.status; const j = await r.json().catch(() => null); out.lookup = (j && j.result !== undefined) ? j.result : j; } catch (e) { out.lookupError = String(e); }
  // Money history: opt-in via track=1 (frontend sends it only for saved players). Hourly throttle, per-player key, capped index.
  if (url.searchParams.get('track') === '1' && out.stats && isFinite(Number(out.stats.money))) {
    try {
      const kv = env.PRICE_HISTORY;
      if (kv) {
        const key = 'pmh:' + name.toLowerCase();
        let pts = [];
        try { pts = JSON.parse((await kv.get(key)) || '[]'); } catch (e) { pts = []; }
        const now = Date.now();
        const hb = Math.floor(now / 3600000);
        const lastHb = pts.length ? Math.floor(pts[pts.length - 1].t / 3600000) : -1;
        if (hb !== lastHb) {
          pts.push({ t: now, m: Math.round(Number(out.stats.money)) });
          if (pts.length > 800) pts = pts.slice(pts.length - 800);
          await kv.put(key, JSON.stringify(pts));
          try {
            let idx = JSON.parse((await kv.get('pmh:index')) || '[]');
            const nl = name.toLowerCase();
            if (idx.indexOf(nl) < 0) {
              idx.push(nl);
              while (idx.length > 12) { const drop = idx.shift(); try { await kv.delete('pmh:' + drop); } catch (e2) {} }
              await kv.put('pmh:index', JSON.stringify(idx));
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
  }
  return new Response(JSON.stringify(out), { status: 200, headers: cors });
}
