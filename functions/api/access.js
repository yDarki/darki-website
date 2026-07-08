// Cloudflare Pages Function: site-wide paywall / access system.
// Users pay in-game (/pay to the collector account); a client mod on the always-online
// collector reads the payment message and reports it here, unlocking that IGN for a period.
// KV (env.PRICE_HISTORY, prefix "ac:"):
//   ac:config          -> { price, durationDays, collector, friendCodes:[] }  (admin-editable)
//   ac:paid:<ignLower> -> { expires, boundToken, claimed }
//   ac:token:<token>   -> { expires, ign, friend }
// Admin gate (?paid, ?config POST): Authorization: Bearer DONUT_TOKEN.
const DEFAULTS = { price: 15000000, durationDays: 14, collector: 'Vortex_xy', friendCodes: [] };
const DAY = 86400000;
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store'
};
const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: CORS });
async function getJSON(kv, key, def) { try { const r = await kv.get(key); return r ? JSON.parse(r) : def; } catch (e) { return def; } }
async function getConfig(kv) { const c = await getJSON(kv, 'ac:config', null); return Object.assign({}, DEFAULTS, c || {}); }
const norm = s => String(s || '').trim().toLowerCase();

export async function onRequest(context) {
  const request = context.request, env = context.env || {}, kv = env.PRICE_HISTORY;
  const url = new URL(request.url), method = request.method;
  if (method === 'OPTIONS') return new Response(null, { headers: CORS });
  const isAdmin = () => { const h = request.headers.get('Authorization') || ''; return env.DONUT_TOKEN && h === 'Bearer ' + env.DONUT_TOKEN; };
  if (!kv) return json({ error: 'no-kv' }, 500);

  // ---- config: public GET (price/duration/collector), admin POST to change ----
  if (url.searchParams.has('config')) {
    const cfg = await getConfig(kv);
    if (method === 'POST') {
      if (!isAdmin()) return json({ error: 'unauthorized' }, 401);
      let body = {}; try { body = await request.json(); } catch (e) {}
      const next = Object.assign({}, cfg);
      if (body.price != null) next.price = Math.max(0, Math.round(Number(body.price) || 0));
      if (body.durationDays != null) next.durationDays = Math.max(1, Math.round(Number(body.durationDays) || 1));
      if (typeof body.collector === 'string' && body.collector.trim()) next.collector = body.collector.trim();
      if (Array.isArray(body.friendCodes)) next.friendCodes = body.friendCodes.map(c => String(c).trim()).filter(Boolean);
      await kv.put('ac:config', JSON.stringify(next));
      return json({ ok: true, config: next });
    }
    return json({ price: cfg.price, durationDays: cfg.durationDays, collector: cfg.collector });
  }

  // ---- admin: revoke access (debug/reset) ----
  if (url.searchParams.has('revoke')) {
    if (!isAdmin()) return json({ error: 'unauthorized' }, 401);
    const what = url.searchParams.get('revoke');
    if (what === 'all') {
      let n = 0;
      for (const prefix of ['ac:token:', 'ac:paid:']) {
        let cursor = undefined;
        do {
          const list = await kv.list({ prefix: prefix, cursor: cursor });
          for (const k of list.keys) { await kv.delete(k.name); n++; }
          cursor = list.list_complete ? null : list.cursor;
        } while (cursor);
      }
      return json({ ok: true, revoked: n });
    }
    if (what === 'ign') {
      const ign = norm(url.searchParams.get('name') || '');
      if (!ign) return json({ error: 'no-name' }, 400);
      const rec = await getJSON(kv, 'ac:paid:' + ign, null);
      let removed = 0;
      if (rec) { if (rec.boundToken) { await kv.delete('ac:token:' + rec.boundToken); removed++; } await kv.delete('ac:paid:' + ign); removed++; }
      return json({ ok: true, revoked: removed, ign: ign });
    }
    await kv.delete('ac:token:' + what);
    return json({ ok: true, revoked: 1, token: what });
  }

  // ---- mod reports a payment: POST ?paid { ign, amount } ----
  if (url.searchParams.has('paid')) {
    if (!isAdmin()) return json({ error: 'unauthorized' }, 401);
    let body = {}; try { body = await request.json(); } catch (e) {}
    const ign = norm(body.ign), amount = Math.round(Number(body.amount) || 0);
    if (!ign) return json({ error: 'no-ign' }, 400);
    const cfg = await getConfig(kv);
    if (amount < cfg.price) return json({ ok: false, reason: 'below-price', need: cfg.price, got: amount });
    const rec = await getJSON(kv, 'ac:paid:' + ign, null) || { expires: 0, boundToken: '', claimed: false };
    const base = Math.max(Date.now(), rec.expires || 0);
    rec.expires = base + cfg.durationDays * DAY;
    await kv.put('ac:paid:' + ign, JSON.stringify(rec));
    if (rec.boundToken) await kv.put('ac:token:' + rec.boundToken, JSON.stringify({ expires: rec.expires, ign: ign }));
    return json({ ok: true, ign: ign, expires: rec.expires });
  }

  // ---- browser checks its access: GET ?check&token= ----
  if (url.searchParams.has('check')) {
    const token = url.searchParams.get('token') || '';
    const t = await getJSON(kv, 'ac:token:' + token, null);
    if (t && t.expires > Date.now()) return json({ access: true, expires: t.expires, ign: t.ign || null, friend: !!t.friend });
    return json({ access: false });
  }

  // ---- claim a paid IGN to this browser: POST ?claim { ign, token } ----
  if (url.searchParams.has('claim')) {
    let body = {}; try { body = await request.json(); } catch (e) {}
    const ign = norm(body.ign), token = String(body.token || '').trim();
    if (!ign || !token) return json({ error: 'missing' }, 400);
    const rec = await getJSON(kv, 'ac:paid:' + ign, null);
    if (!rec || !(rec.expires > Date.now())) return json({ access: false, error: 'not-paid' });
    if (rec.boundToken && rec.boundToken !== token) return json({ access: false, error: 'claimed' });
    rec.boundToken = token; rec.claimed = true;
    await kv.put('ac:paid:' + ign, JSON.stringify(rec));
    await kv.put('ac:token:' + token, JSON.stringify({ expires: rec.expires, ign: ign }));
    return json({ access: true, expires: rec.expires, ign: ign });
  }

  // ---- friend code: POST ?redeem { code, token } ----
  if (url.searchParams.has('redeem')) {
    let body = {}; try { body = await request.json(); } catch (e) {}
    const code = String(body.code || '').trim(), token = String(body.token || '').trim();
    if (!code || !token) return json({ error: 'missing' }, 400);
    const cfg = await getConfig(kv);
    const ok = cfg.friendCodes.some(c => c.toLowerCase() === code.toLowerCase());
    if (!ok) return json({ access: false, error: 'bad-code' });
    const expires = Date.now() + 3650 * DAY; // friends: effectively permanent
    await kv.put('ac:token:' + token, JSON.stringify({ expires: expires, friend: true }));
    return json({ access: true, expires: expires, friend: true });
  }

  return json({ ok: true, service: 'access' });
}
