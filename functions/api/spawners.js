// Cloudflare Pages Function: Spawner price reader.
// Reads a "price list" message from configured Discord channels (the bot must be a member of the
// server with View Channel + Read Message History on that channel), parses spawner sell/buy prices,
// stores them in KV and serves them to the website. Edited messages are supported (REST always
// returns the latest content).
// Secrets/env: DISCORD_BOT_TOKEN (bot token), DONUT_TOKEN (admin gate), KV binding PRICE_HISTORY ('sp:*').
//
// Configure source channels here. channelId is required. messageId is optional: set it to read one
// exact message (best when a single price-list message is edited over time); leave it '' to scan the
// last messages of the channel and auto-pick the one that looks like a price list.
const SOURCES = [
  { name: "Marie's server for DonutSMP", guildId: '1517461615484600453', channelId: '1517497598582329464', messageId: '1517499186692755506', invite: '' }
];

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: CORS });

function parseAmount(numStr, suffix) {
  var v = parseFloat(String(numStr).replace(/,/g, ''));
  if (!isFinite(v)) return null;
  var s = (suffix || '').toLowerCase();
  if (s === 'k') v *= 1e3; else if (s === 'm') v *= 1e6; else if (s === 'b') v *= 1e9;
  return Math.round(v);
}
function titleCase(s) {
  return s.replace(/\s+/g, ' ').trim().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

// Parse a freeform price message into [{ name, sell, buy }].
// Recognizes "Selling"/"You Sell To Us" and "Buying"/"We Sell To You" section headers.
function parsePrices(text) {
  if (!text) return [];
  var lines = String(text).split(/\r?\n/);
  var section = 'sell';
  var map = {};
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var low = line.toLowerCase();
    if (low.indexOf('we buy from you') >= 0 || low.indexOf('you sell to us') >= 0 || low.indexOf('sell to us') >= 0) { section = 'sell'; continue; }
    if (low.indexOf('we sell to you') >= 0 || low.indexOf('you buy from us') >= 0 || low.indexOf('buy from us') >= 0) { section = 'buy'; continue; }
    if (low.indexOf('selling') >= 0) { section = 'sell'; continue; }
    if (low.indexOf('buying') >= 0) { section = 'buy'; continue; }
    var m = line.match(/\$?\s*([0-9][0-9.,]*)\s*([kmb])\b/i);
    if (!m) continue;
    var amount = parseAmount(m[1], m[2]);
    if (amount == null || amount <= 0) continue;
    var name = line.slice(0, m.index).replace(/spawners?/ig, '').replace(/[^A-Za-z0-9 ]/g, ' ');
    name = titleCase(name);
    if (!name || name.length < 2) continue;
    var key = name.toLowerCase();
    if (!map[key]) map[key] = { name: name, sell: null, buy: null };
    if (section === 'buy') map[key].buy = amount; else map[key].sell = amount;
  }
  return Object.keys(map).map(function (k) { return map[k]; });
}

async function fetchMessageText(botToken, channelId, messageId) {
  var headers = { Authorization: 'Bot ' + botToken };
  try {
    if (messageId) {
      var r = await fetch('https://discord.com/api/v10/channels/' + channelId + '/messages/' + messageId, { headers: headers });
      if (!r.ok) { var eb = ''; try { eb = await r.text(); } catch (e) {} return { ok: false, status: r.status, detail: eb.slice(0, 200) }; }
      var msg = await r.json();
      return { ok: true, text: (msg && msg.content) || '', ts: msg && (msg.edited_timestamp || msg.timestamp) };
    }
    var r2 = await fetch('https://discord.com/api/v10/channels/' + channelId + '/messages?limit=25', { headers: headers });
    if (!r2.ok) return { ok: false, status: r2.status };
    var arr = await r2.json();
    if (!Array.isArray(arr)) return { ok: false, status: 'bad-response' };
    for (var i = 0; i < arr.length; i++) {
      var c = (arr[i] && arr[i].content) || '';
      if (parsePrices(c).length) return { ok: true, text: c, ts: arr[i].edited_timestamp || arr[i].timestamp };
    }
    return { ok: true, text: '', ts: null };
  } catch (e) { return { ok: false, status: String(e) }; }
}

export async function onRequest(context) {
  const request = context.request, env = context.env || {}, kv = env.PRICE_HISTORY;
  const url = new URL(request.url), method = request.method;
  if (method === 'OPTIONS') return new Response(null, { headers: CORS });
  const isAdmin = () => { const h = request.headers.get('Authorization') || ''; return env.DONUT_TOKEN && h === 'Bearer ' + env.DONUT_TOKEN; };

  // ---- admin: cron — read all sources, parse, store (write only on change) ----
  if (url.searchParams.has('cron')) {
    if (!isAdmin()) return json({ error: 'unauthorized' }, 401);
    if (!kv) return json({ error: 'no-kv' }, 500);
    const bot = env.DISCORD_BOT_TOKEN;
    if (!bot) return json({ error: 'no-bot-token' }, 500);
    const out = [];
    for (const src of SOURCES) {
      if (!src || !src.channelId) continue;
      const res = await fetchMessageText(bot, src.channelId, src.messageId);
      if (!res.ok) { out.push({ name: src.name || 'Market', channelId: src.channelId, error: res.status, detail: res.detail || null, spawners: [] }); continue; }
      let _icon = null; if (src.guildId) { try { const _g = await fetch('https://discord.com/api/v10/guilds/' + src.guildId, { headers: { Authorization: 'Bot ' + bot } }); if (_g.ok) { const _gj = await _g.json(); if (_gj && _gj.icon) _icon = 'https://cdn.discordapp.com/icons/' + src.guildId + '/' + _gj.icon + '.png?size=64'; } } catch (e) {} } const _link = src.invite || (src.guildId ? ('https://discord.com/channels/' + src.guildId + '/' + src.channelId) : ''); out.push({ name: src.name || 'Market', channelId: src.channelId, icon: _icon, link: _link, updated: Date.now(), sourceTs: res.ts || null, spawners: parsePrices(res.text) });
    }
    const payload = { updated: Date.now(), sources: out };
    let prevStr = null; try { prevStr = await kv.get('sp:prices'); } catch (e) {}
    const core = (list) => JSON.stringify((list || []).map(function (s) { return { n: s.name, c: s.channelId, sp: s.spawners, e: s.error || null, d: s.detail || null, ic: s.icon || null, lk: s.link || null }; }));
    const nextCore = core(out);
    let prevCore = null; try { const p = prevStr ? JSON.parse(prevStr) : null; prevCore = p ? core(p.sources) : null; } catch (e) {}
    let wrote = false;
    if (nextCore !== prevCore) { await kv.put('sp:prices', JSON.stringify(payload)); wrote = true; }
    return json({ ok: true, sources: out.length, wrote: wrote, detail: out.map(function (s) { return { name: s.name, count: (s.spawners || []).length, error: s.error || null }; }) });
  }

  // ---- public GET: return stored prices (paywall-gated like the other tools) ----
  const _admin = env.DONUT_TOKEN && (request.headers.get('Authorization') || '') === 'Bearer ' + env.DONUT_TOKEN;
  if (!_admin) {
    const _acc = request.headers.get('X-Access-Token') || '';
    let _ok = false;
    try { if (_acc && kv) { const _r = await kv.get('ac:token:' + _acc); if (_r) { const _t = JSON.parse(_r); _ok = _t && _t.expires > Date.now(); } } } catch (e) {}
    if (!_ok) { try { if (kv) { const _oc = await kv.get('ac:config'); if (_oc) { const _ocf = JSON.parse(_oc); if (_ocf && _ocf.open === true) _ok = true; } } } catch (e) {} }
    if (!_ok) return json({ error: 'locked' }, 403);
  }
  if (!kv) return json({ updated: null, sources: [] });
  let data = null; try { const raw = await kv.get('sp:prices'); data = raw ? JSON.parse(raw) : null; } catch (e) {}
  return json(data || { updated: null, sources: [] });
}
