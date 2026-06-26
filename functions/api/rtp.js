// Cloudflare Pages Function: RTP map collector + reader.
// POST adds a point (needs Authorization: Bearer <RTP_TOKEN>); GET returns { border, points }.
// KV binding: RTP_MAP. Secret: RTP_TOKEN.
// GET ?check returns { kvBound, tokenSet } for setup verification.
export async function onRequest(context) {
  const { request, env } = context;
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  const json = (obj, status) => new Response(JSON.stringify(obj), { status: status, headers: cors });
  const kv = env.RTP_MAP;
  const url = new URL(request.url);
  if (url.searchParams.get('check')) return json({ ok: true, kvBound: !!kv, tokenSet: !!env.RTP_TOKEN }, 200);

  if (request.method === 'POST') {
    const token = env.RTP_TOKEN;
    if (!token) return json({ error: 'no token configured' }, 500);
    const authHeader = request.headers.get('Authorization') || '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (request.headers.get('X-RTP-Token') || '');
    if (provided !== token) return json({ error: 'unauthorized' }, 401);
    if (!kv) return json({ error: 'no KV bound' }, 500);
    if (url.searchParams.get('reset')) { await kv.put('points', '[]'); return json({ ok: true, reset: true, count: 0 }, 200); }

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    const x = Math.round(Number(body.x));
    const z = Math.round(Number(body.z));
    if (!isFinite(x) || !isFinite(z)) return json({ error: 'bad coords' }, 400);
    const name = String(body.name || 'unknown').slice(0, 32).replace(/[^A-Za-z0-9_ .-]/g, '');
    const t = Date.now();

    let points = [];
    try { points = JSON.parse((await kv.get('points')) || '[]'); } catch (e) { points = []; }
    const last = points[points.length - 1];
    const dup = last && last.x === x && last.z === z && (t - last.t) < 5000;
    if (!dup) {
      points.push({ n: name, x: x, z: z, t: t });
      if (points.length > 5000) points = points.slice(points.length - 5000);
      await kv.put('points', JSON.stringify(points));
    }

    if (body.border && Number(body.border.size) > 0) {
      const b = {
        size: Math.round(Number(body.border.size)),
        cx: Math.round(Number(body.border.cx) || 0),
        cz: Math.round(Number(body.border.cz) || 0)
      };
      await kv.put('border', JSON.stringify(b));
    }

    return json({ ok: true, count: points.length }, 200);
  }

  if (!kv) return json({ border: null, points: [] }, 200);
  let points = [];
  let border = null;
  try { points = JSON.parse((await kv.get('points')) || '[]'); } catch (e) {}
  try { border = JSON.parse((await kv.get('border')) || 'null'); } catch (e) {}
  return json({ border: border, points: points }, 200);
}
