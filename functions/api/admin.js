// functions/api/admin.js
// Admin panel backend for donutsmpstats.com.
// Auth: a SEPARATE admin password (Cloudflare env var ADMIN_PASSWORD) is exchanged
// for a short-lived session token stored in KV (ac:admin:<token>). The real
// DONUT_TOKEN is never handled by the browser. Shares all state with access.js
// through the same KV binding (PRICE_HISTORY).
//
// All requests are POST /api/admin with a JSON body { op, ... }.
//   op=login      { pw }                      -> { ok, token, exp }
//   op=session    (auth)                      -> { ok }               (token still valid?)
//   op=getConfig  (auth)                      -> { ok, config }
//   op=setConfig  (auth) { config:{...} }     -> { ok, config }
//   op=listAccess (auth)                      -> { ok, access:[...] }
//   op=revoke     (auth) { ign }              -> { ok, ign, tokensRemoved }

const SESSION_TTL_S = 7 * 86400; // admin session lives 7 days
const ADMIN_PREFIX = 'ac:admin:';
const CONFIG_KEY = 'ac:config';
const PAID_PREFIX = 'ac:paid:';
const TOKEN_PREFIX = 'ac:token:';

const CONFIG_DEFAULTS = {
  price: 15000000,
  durationDays: 14,
  collector: 'Vortex_xy',
  open: true,
  friendCodes: [],
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// Constant-time string compare (avoids timing side channels on the password).
function ctEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function randToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function readConfig(kv) {
  let c = {};
  try {
    c = JSON.parse((await kv.get(CONFIG_KEY)) || '{}') || {};
  } catch (e) {}
  return { ...CONFIG_DEFAULTS, ...c };
}

// Valid if the bearer/token is the master DONUT_TOKEN or a live admin session.
async function authed(request, env, body) {
  const kv = env.PRICE_HISTORY;
  let tok = '';
  const h = request.headers.get('Authorization') || '';
  if (h.startsWith('Bearer ')) tok = h.slice(7).trim();
  if (!tok && body && body.token) tok = String(body.token).trim();
  if (!tok) return false;
  if (env.DONUT_TOKEN && ctEqual(tok, env.DONUT_TOKEN)) return true;
  const rec = await kv.get(ADMIN_PREFIX + tok);
  return !!rec;
}

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.PRICE_HISTORY;
  if (!kv) return json({ ok: false, error: 'kv-unavailable' }, 500);
  if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

  let body = {};
  try {
    body = await request.json();
  } catch (e) {}
  const op = String(body.op || '');

  // ---- login: password -> session token ----
  if (op === 'login') {
    if (!env.ADMIN_PASSWORD) return json({ ok: false, error: 'not-configured' }, 503);
    const pw = String(body.pw || '');
    if (!pw || !ctEqual(pw, env.ADMIN_PASSWORD)) {
      return json({ ok: false, error: 'bad-password' }, 401);
    }
    const tk = randToken();
    const exp = Date.now() + SESSION_TTL_S * 1000;
    await kv.put(ADMIN_PREFIX + tk, JSON.stringify({ exp }), { expirationTtl: SESSION_TTL_S });
    return json({ ok: true, token: tk, exp });
  }

  // ---- all other ops require a valid admin session ----
  if (!(await authed(request, env, body))) return json({ ok: false, error: 'unauthorized' }, 401);

  if (op === 'session') {
    return json({ ok: true });
  }

  if (op === 'getConfig') {
    return json({ ok: true, config: await readConfig(kv) });
  }

  if (op === 'setConfig') {
    const cur = await readConfig(kv);
    const p = body.config || {};
    const next = { ...cur };
    if (p.price !== undefined) next.price = Math.max(0, Math.floor(Number(p.price) || 0));
    if (p.durationDays !== undefined) next.durationDays = Math.max(1, Math.floor(Number(p.durationDays) || 1));
    if (p.collector !== undefined) next.collector = String(p.collector).trim().slice(0, 16);
    if (p.open !== undefined) next.open = !!p.open;
    if (p.friendCodes !== undefined && Array.isArray(p.friendCodes)) {
      // Preserve the existing per-code object schema (code, durationDays, max,
      // expires, friend, ...). Only sanitize code + durationDays; keep the rest.
      next.friendCodes = p.friendCodes
        .map((it) => {
          if (typeof it === 'string') {
            const c = it.trim();
            return c ? { code: c } : null;
          }
          if (it && typeof it === 'object') {
            const o = { ...it };
            o.code = String(o.code || '').trim();
            if (!o.code) return null;
            if (o.durationDays === undefined || o.durationDays === null || o.durationDays === '') {
              delete o.durationDays;
            } else {
              o.durationDays = Math.max(1, Math.floor(Number(o.durationDays) || 1));
            }
            if (o.max === undefined || o.max === null || o.max === '') {
              delete o.max;
            } else {
              o.max = Math.max(1, Math.floor(Number(o.max) || 1));
            }
            return o;
          }
          return null;
        })
        .filter(Boolean)
        .slice(0, 200);
    }
    await kv.put(CONFIG_KEY, JSON.stringify(next));
    return json({ ok: true, config: next });
  }

  if (op === 'listAccess') {
    const out = [];
    let cursor;
    do {
      const res = await kv.list({ prefix: PAID_PREFIX, cursor });
      for (const k of res.keys) {
        const ign = k.name.slice(PAID_PREFIX.length);
        let rec = {};
        try {
          rec = JSON.parse((await kv.get(k.name)) || '{}') || {};
        } catch (e) {}
        out.push({ ign, expires: rec.expires || rec.exp || rec.until || null, ...rec });
      }
      cursor = res.list_complete ? null : res.cursor;
    } while (cursor);
    out.sort((a, b) => (b.expires || 0) - (a.expires || 0));
    return json({ ok: true, access: out });
  }

  if (op === 'revoke') {
    const ign = String(body.ign || '').trim();
    if (!ign) return json({ ok: false, error: 'no-ign' }, 400);
    await kv.delete(PAID_PREFIX + ign);
    // also drop any active login/access tokens issued for that ign
    let cursor;
    let removed = 0;
    do {
      const res = await kv.list({ prefix: TOKEN_PREFIX, cursor });
      for (const k of res.keys) {
        let rec = {};
        try {
          rec = JSON.parse((await kv.get(k.name)) || '{}') || {};
        } catch (e) {}
        if (rec && String(rec.ign || '').toLowerCase() === ign.toLowerCase()) {
          await kv.delete(k.name);
          removed++;
        }
      }
      cursor = res.list_complete ? null : res.cursor;
    } while (cursor);
    return json({ ok: true, ign, tokensRemoved: removed });
  }

  return json({ ok: false, error: 'unknown-op' }, 400);
}
