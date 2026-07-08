// Cloudflare Pages Function: RTP map collector + reader.
// Auth model: per-user token whitelist in KV key 'wl' = { "<token>": "<name>" }.
//   - Master token = secret RTP_TOKEN. It can post points, manage the whitelist, and reset.
//   - A point's display name comes from the token (whitelist), so nobody can impersonate.
//   - Points outside the world border are rejected.
//   (A whitelisted user can still fake their OWN coords; real verification would need a server-side plugin.)
// KV binding: RTP_MAP. Secret: RTP_TOKEN.
// Endpoints:
//   GET                  -> { border, points }
//   GET  ?check           -> { kvBound, tokenSet }
//   GET  ?list   (master) -> { count, whitelist }
//   POST          (user)  -> add point(s): { x, z, dim, border } or a batch { points: [ ... ] }
//   POST ?op=add (master) -> body { token, name } : whitelist a user
//   POST ?op=del (master) -> body { token } : remove a user
//   POST ?reset  (master) -> clear all points
export async function onRequest(context) {
  const { request, env } = context;
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  const json = (obj, status) => new Response(JSON.stringify(obj), { status: status, headers: cors });
  const kv = env.RTP_MAP;
  const url = new URL(request.url);
  const master = env.RTP_TOKEN;

  if (url.searchParams.get('check')) return json({ ok: true, kvBound: !!kv, tokenSet: !!master }, 200);

  const authHeader = request.headers.get('Authorization') || '';
  const provided = (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (request.headers.get('X-RTP-Token') || '')).trim();
  const isMaster = !!master && provided === String(master).trim();

  // ---- GET ----
  if (request.method !== 'POST') {
    if (url.searchParams.get('list')) {
      if (!isMaster) return json({ error: 'unauthorized' }, 401);
      if (!kv) return json({ error: 'no KV bound' }, 500);
      let wl = {}; try { wl = JSON.parse((await kv.get('wl')) || '{}'); } catch (e) {}
      return json({ count: Object.keys(wl).length, whitelist: wl }, 200);
    }
    if (!kv) return json({ border: null, points: [] }, 200);
    let points = []; let borders = {};
    try { points = JSON.parse((await kv.get('points')) || '[]'); } catch (e) {}
    try { borders = JSON.parse((await kv.get('borders')) || '{}'); } catch (e) {}
    return json({ border: borders.overworld || null, borders: borders, points: points }, 200);
  }

  // ---- POST ----
  if (!master) return json({ error: 'no token configured' }, 500);
  if (!kv) return json({ error: 'no KV bound' }, 500);

  let wl = {}; try { wl = JSON.parse((await kv.get('wl')) || '{}'); } catch (e) {}

  // admin: manage whitelist (master only)
  const op = url.searchParams.get('op');
  if (op) {
    if (!isMaster) return json({ error: 'unauthorized' }, 401);
    let b = {}; try { b = await request.json(); } catch (e) {}
    if (op === 'add' && b.token) {
      wl[String(b.token)] = String(b.name || 'player').slice(0, 32).replace(/[^A-Za-z0-9_ .-]/g, '');
      await kv.put('wl', JSON.stringify(wl));
      return json({ ok: true, count: Object.keys(wl).length }, 200);
    }
    if (op === 'del' && b.token) {
      delete wl[String(b.token)];
      await kv.put('wl', JSON.stringify(wl));
      return json({ ok: true, count: Object.keys(wl).length }, 200);
    }
    return json({ error: 'bad op' }, 400);
  }

  // admin: reset all points (master only)
  if (url.searchParams.get('reset')) {
    if (!isMaster) return json({ error: 'unauthorized' }, 401);
    const rd = String(url.searchParams.get('reset')).toLowerCase();
    if (rd === 'overworld' || rd === 'nether' || rd === 'end') {
      let pp = []; try { pp = JSON.parse((await kv.get('points')) || '[]'); } catch (e) { pp = []; }
      const kept = pp.filter(function (p) { return (p.d || 'overworld') !== rd; });
      await kv.put('points', JSON.stringify(kept));
      return json({ ok: true, reset: rd, removed: pp.length - kept.length, count: kept.length }, 200);
    }
    await kv.put('points', '[]');
    return json({ ok: true, reset: true, count: 0 }, 200);
  }

  if (url.searchParams.get('prune')) {
    if (!isMaster) return json({ error: 'unauthorized' }, 401);
    const pdim = String(url.searchParams.get('prune')).toLowerCase();
    if (pdim !== 'overworld' && pdim !== 'nether' && pdim !== 'end') return json({ error: 'bad dim' }, 400);
    let pp = []; try { pp = JSON.parse((await kv.get('points')) || '[]'); } catch (e) { pp = []; }
    const tc = {}; for (let i = 0; i < pp.length; i++) tc[pp[i].t] = (tc[pp[i].t] || 0) + 1;
    const kept = pp.filter(function (p) { const d = (p.d || 'overworld'); if (d !== pdim) return true; return tc[p.t] > 1; });
    await kv.put('points', JSON.stringify(kept));
    return json({ ok: true, pruned: pdim, removed: pp.length - kept.length, count: kept.length }, 200);
  }

  // posting a point: must be master or a whitelisted token
  const wlName = wl[provided];
  if (!isMaster && wlName === undefined) return json({ error: 'unauthorized' }, 401);

  let body; try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  // Accept a single point {x,z,dim,border} OR a batch {points:[...]}. Batching keeps KV writes low:
  // one 'points' write per request instead of one per point.
  const items = Array.isArray(body.points) ? body.points : [body];
  if (items.length === 0 || items.length > 200) return json({ error: 'bad batch' }, 400);

  // name is server-controlled (from the token), not client-controlled
  const name = (isMaster ? String(body.name || 'admin') : String(wlName))
    .slice(0, 32).replace(/[^A-Za-z0-9_ .-]/g, '');

  let borders = {}; try { borders = JSON.parse((await kv.get('borders')) || '{}'); } catch (e) {}
  let points = []; try { points = JSON.parse((await kv.get('points')) || '[]'); } catch (e) { points = []; }
  const t = Date.now();
  let added = 0, bordersChanged = false;

  for (const it of items) {
    const x = Math.round(Number(it.x));
    const z = Math.round(Number(it.z));
    if (!isFinite(x) || !isFinite(z)) continue;
    let dim = String(it.dim || 'overworld').toLowerCase();
    if (dim !== 'nether' && dim !== 'end') dim = 'overworld';

    // border: per-dimension, only mark changed (single KV write at the end).
    if (it.border && Number(it.border.size) > 0) {
      const nb = { size: Math.round(Number(it.border.size)), cx: Math.round(Number(it.border.cx) || 0), cz: Math.round(Number(it.border.cz) || 0) };
      const ob = borders[dim];
      if (!ob || ob.size !== nb.size || ob.cx !== nb.cx || ob.cz !== nb.cz) { borders[dim] = nb; bordersChanged = true; }
    }
    const bdim = borders[dim];
    if (bdim && bdim.size > 0) {
      const half = bdim.size / 2 + 64;
      if (Math.abs(x - bdim.cx) > half || Math.abs(z - bdim.cz) > half) continue; // skip out-of-bounds
    }

    const last = points[points.length - 1];
    const dup = last && last.n === name && last.x === x && last.z === z && (last.d || 'overworld') === dim && (t - last.t) < 5000;
    if (!dup) { points.push({ n: name, x: x, z: z, t: t, d: dim }); added++; }
  }

  { var PER_DIM = 5000; var byd = {}; for (var _i = 0; _i < points.length; _i++) { var _p = points[_i]; var _d = _p.d || 'overworld'; (byd[_d] = byd[_d] || []).push(_p); } var merged = []; for (var _k in byd) { var _a = byd[_k]; if (_a.length > PER_DIM) _a = _a.slice(_a.length - PER_DIM); for (var _j = 0; _j < _a.length; _j++) merged.push(_a[_j]); } merged.sort(function (a, b) { return (a.t || 0) - (b.t || 0); }); points = merged; }

  // Daily write budget: cap RTP KV writes so they can't exhaust the shared account write limit (prices + money history).
  const RTP_DAILY_WRITE_CAP = 500;
  const dayStart = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate());
  let priorWrites = 0; { const seen = {}; for (const p of points) { if (p && p.t >= dayStart && p.t !== t) seen[p.t] = 1; } priorWrites = Object.keys(seen).length; }
  if (added > 0 && priorWrites >= RTP_DAILY_WRITE_CAP) {
    return json({ ok: true, added: 0, capped: true, writesToday: priorWrites }, 200);
  }

  if (bordersChanged) await kv.put('borders', JSON.stringify(borders));
  if (added > 0) await kv.put('points', JSON.stringify(points));

  return json({ ok: true, count: points.length, added: added }, 200);
}
