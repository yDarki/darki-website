// Cloudflare Pages Function: item worth list, fed by the in-game /worth reader mod.
//   POST (Authorization: Bearer DONUT_TOKEN)  -> merges a batch of items into KV
//   GET                                       -> full list for the website tile
//   ?reset (admin)                            -> clears the list
// KV key 'worth': { updated: <ms>, items: { "<id>": { n: "<display name>", w: <worth>, t: <ms> } } }
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store'
};
const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: CORS });

export async function onRequest(context) {
  const request = context.request;
  const env = context.env || {};
  const kv = env.PRICE_HISTORY;
  const url = new URL(request.url);
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (!kv) return json({ error: 'no-kv' }, 500);

  const isAdmin = () => {
    const h = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    return !!env.DONUT_TOKEN && h === env.DONUT_TOKEN;
  };

  async function load() {
    try {
      const raw = await kv.get('worth');
      const j = raw ? JSON.parse(raw) : null;
      return (j && j.items) ? j : { updated: 0, items: {} };
    } catch (e) { return { updated: 0, items: {} }; }
  }

  // ---- admin: clear everything -------------------------------------------
  if (url.searchParams.has('reset')) {
    if (!isAdmin()) return json({ error: 'unauthorized' }, 401);
    await kv.put('worth', JSON.stringify({ updated: Date.now(), items: {} }));
    return json({ ok: true, cleared: true });
  }

  // ---- the mod reports a batch -------------------------------------------
  if (method === 'POST') {
    if (!isAdmin()) return json({ error: 'unauthorized' }, 401);
    let body = {};
    try { body = await request.json(); } catch (e) {}
    const incoming = Array.isArray(body.items) ? body.items : [];
    if (!incoming.length) return json({ ok: true, stored: 0 });

    const store = await load();
    const now = Date.now();
    let stored = 0;
    for (const it of incoming.slice(0, 500)) {
      if (!it) continue;
      const id = String(it.id || '').trim().toLowerCase().replace(/^minecraft:/, '');
      if (!id || id.length > 64 || !/^[a-z0-9_./-]+$/.test(id)) continue;
      const w = Number(it.worth);
      if (!isFinite(w) || w < 0) continue;
      const name = String(it.name || '').trim().slice(0, 64);
      store.items[id] = { n: name || id, w: Math.round(w * 100) / 100, t: now };
      stored++;
    }
    store.updated = now;
    await kv.put('worth', JSON.stringify(store));
    return json({ ok: true, stored: stored, total: Object.keys(store.items).length });
  }

  // ---- website reads the list (same access gate as the other data endpoints)
  if (!isAdmin()) {
    const acc = request.headers.get('X-Access-Token') || '';
    let ok = false;
    try { if (acc) { const r = await kv.get('ac:token:' + acc); if (r) { const t = JSON.parse(r); ok = !!(t && t.expires > Date.now()); } } } catch (e) {}
    if (!ok) { try { const c = await kv.get('ac:config'); if (c) { const cf = JSON.parse(c); if (cf && cf.open === true) ok = true; } } catch (e) {} }
    if (!ok) return json({ error: 'locked' }, 403);
  }

  const store = await load();
  const items = Object.keys(store.items).map(function (id) {
    const e = store.items[id];
    return { id: id, name: e.n || id, worth: e.w, t: e.t || 0 };
  }).sort(function (a, b) { return b.worth - a.worth; });

  // Die Liste aendert sich selten - kurzes Caching entlastet KV spuerbar.
  const headers = Object.assign({}, CORS, { 'Cache-Control': 'public, max-age=120' });
  return new Response(JSON.stringify({ updated: store.updated || 0, count: items.length, items: items }), { status: 200, headers: headers });
}
