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
//   POST          (user)  -> add a point { x, z, border? }
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
    await kv.put('points', '[]');
    return json({ ok: true, reset: true, count: 0 }, 200);
  }

  // posting a point: must be master or a whitelisted token
  const wlName = wl[provided];
  if (!isMaster && wlName === undefined) return json({ error: 'unauthorized' }, 401);

  let body; try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const x = Math.round(Number(body.x));
  const z = Math.round(Number(body.z));
  if (!isFinite(x) || !isFinite(z)) return json({ error: 'bad coords' }, 400);
  let dim = String(body.dim || 'overworld').toLowerCase();
  if (dim !== 'nether' && dim !== 'end') dim = 'overworld';

  // name is server-controlled (from the token), not client-controlled
  let name = isMaster ? String(body.name || 'admin') : String(wlName);
  name = name.slice(0, 32).replace(/[^A-Za-z0-9_ .-]/g, '');

  // border: per-dimension. Update from the point's own world border, then enforce it for that dimension.
  let borders = {}; try { borders = JSON.parse((await kv.get('borders')) || '{}'); } catch (e) {}
  if (body.border && Number(body.border.size) > 0) {
    const nb = { size: Math.round(Number(body.border.size)), cx: Math.round(Number(body.border.cx) || 0), cz: Math.round(Number(body.border.cz) || 0) };
    const ob = borders[dim];
    // Only write when the border actually changed — it is a server constant, so this saves a KV write per point.
    if (!ob || ob.size !== nb.size || ob.cx !== nb.cx || ob.cz !== nb.cz) {
      borders[dim] = nb;
      await kv.put('borders', JSON.stringify(borders));
    }
  }
  const bdim = borders[dim];
  if (bdim && bdim.size > 0) {
    const half = bdim.size / 2 + 64;
    if (Math.abs(x - bdim.cx) > half || Math.abs(z - bdim.cz) > half) return json({ error: 'out of bounds' }, 400);
  }

  let points = []; try { points = JSON.parse((await kv.get('points')) || '[]'); } catch (e) { points = []; }
  const t = Date.now();
  const last = points[points.length - 1];
  const dup = last && last.n === name && last.x === x && last.z === z && (last.d || 'overworld') === dim && (t - last.t) < 5000;
  if (!dup) {
    points.push({ n: name, x: x, z: z, t: t, d: dim });
    if (points.length > 5000) points = points.slice(points.length - 5000);
    await kv.put('points', JSON.stringify(points));
  }

  return json({ ok: true, count: points.length }, 200);
}
