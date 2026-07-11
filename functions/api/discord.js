// Cloudflare Pages Function: Discord bot for DonutSMP price alerts.
// Responsibilities:
//   1. Discord Interactions endpoint (POST, Ed25519-verified): /link, /unlink, /alerts.
//   2. Website API: ?status=<code> (link state), ?alerts=<code> (GET/POST alert config).
//   3. Admin (Bearer DONUT_TOKEN): ?register[=guildId] (register slash commands),
//      ?cron (check prices, ping when a threshold is crossed).
// Secrets/env: DISCORD_BOT_TOKEN (secret), DONUT_TOKEN (secret, also admin gate),
//   KV binding PRICE_HISTORY (shared; keys are prefixed "dc:").
// Public constants (safe to hardcode):
const APP_ID = '1524403907550249161';
const PUBLIC_KEY = '8f39f237efb9b9032cc4a5f5974d882a3754552fa9b8f4fc1d7fb2ee019a7930';

// Items the user can watch (must match ids the DonutSMP API understands).
const ITEMS = [
  'netherite_ingot', 'netherite_scrap', 'netherite_block',
  'enchanted_golden_apple', 'elytra', 'dragon_head'
];

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store'
};
const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: CORS });

// ---- helpers -------------------------------------------------------------
function hexToBytes(hex) {
  const a = new Uint8Array(hex.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
  return a;
}

async function verifyDiscord(publicKeyHex, signatureHex, timestamp, bodyText) {
  const data = new TextEncoder().encode(timestamp + bodyText);
  const sig = hexToBytes(signatureHex);
  const keyBytes = hexToBytes(publicKeyHex);
  // Cloudflare supports "Ed25519"; older runtimes used "NODE-ED25519".
  for (const algo of [{ name: 'Ed25519' }, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }]) {
    try {
      const key = await crypto.subtle.importKey('raw', keyBytes, algo, false, ['verify']);
      return await crypto.subtle.verify(algo, key, sig, data);
    } catch (e) { /* try next */ }
  }
  return false;
}

function botHeaders(token) {
  return { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' };
}

async function openDM(token, userId) {
  try {
    const r = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST', headers: botHeaders(token),
      body: JSON.stringify({ recipient_id: userId })
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.id || null;
  } catch (e) { return null; }
}

async function sendMessage(token, channelId, content) {
  try {
    const r = await fetch('https://discord.com/api/v10/channels/' + channelId + '/messages', {
      method: 'POST', headers: botHeaders(token),
      body: JSON.stringify({ content: content, allowed_mentions: { parse: ['users'] } })
    });
    return r.ok;
  } catch (e) { return false; }
}

// Interaction reply (ephemeral).
function reply(content) {
  return json({ type: 4, data: { content: content, flags: 64 } });
}

// ---- KV accessors --------------------------------------------------------
const K_LINK = c => 'dc:link:' + c;      // code -> {discordId, username, linkedAt}
const K_ALERTS = c => 'dc:alerts:' + c;  // code -> [alerts]
const K_INDEX = 'dc:codes';              // [codes] that have >=1 alert (for cron)

async function getJSON(kv, key, def) {
  try { const raw = await kv.get(key); return raw ? JSON.parse(raw) : def; } catch (e) { return def; }
}
async function addToIndex(kv, code) {
  const list = await getJSON(kv, K_INDEX, []);
  if (!list.includes(code)) { list.push(code); await kv.put(K_INDEX, JSON.stringify(list)); }
}

// ---- current unit price for an item -------------------------------------
async function unitPrice(token, item) {
  try {
    const r = await fetch('https://api.donutsmp.net/v1/auction/list/1', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ search: item, sort: 'lowest_price' })
    });
    if (!r.ok) return null;
    const j = await r.json();
    const arr = (j && Array.isArray(j.result)) ? j.result : [];
    let best = null;
    for (const a of arr) {
      const id = a && a.item && a.item.id;
      if (id !== 'minecraft:' + item) continue;
      const count = (a.item && a.item.count) ? a.item.count : 1;
      const unit = a.price / count;
      if (isFinite(unit) && (best === null || unit < best)) best = unit;
    }
    return best;
  } catch (e) { return null; }
}

// ==========================================================================
// ---- player stats (for the /menu Player Stats button) -------------------
function abbrNum(n) { n = Number(n) || 0; const a = Math.abs(n); if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T'; if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return (n / 1e3).toFixed(2) + 'k'; return String(Math.round(n)); }
function intNum(n) { return (Math.round(Number(n) || 0)).toLocaleString('en-US'); }
function playtimeStr(ms) { ms = Number(ms) || 0; const s = Math.floor(ms / 1000); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); if (d > 0) return d + 'd ' + h + 'h'; if (h > 0) return h + 'h ' + m + 'm'; return m + 'm'; }
async function playerStats(token, name) {
  try {
    const r = await fetch('https://api.donutsmp.net/v1/stats/' + encodeURIComponent(name), { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    const j = await r.json().catch(function () { return null; });
    const s = (j && j.result !== undefined) ? j.result : j;
    return { status: r.status, stats: s };
  } catch (e) { return { status: 0, stats: null, error: String(e) }; }
}
function padCol(label, val, w) { const l = String(label); return l + ' '.repeat(Math.max(1, w - l.length)) + val; }
function statsEmbed(name, s) {
  const money = Number(s.money) || 0, shards = Number(s.shards) || 0, kills = Number(s.kills) || 0, deaths = Number(s.deaths) || 0;
  const spent = Number(s.money_spent_on_shop) || 0, earned = Number(s.money_made_from_sell) || 0;
  const mined = Number(s.broken_blocks) || 0, placed = Number(s.placed_blocks) || 0, mobs = Number(s.mobs_killed) || 0;
  const kd = deaths > 0 ? (kills / deaths).toFixed(2) : String(kills);
  const eco = '```\n' + padCol('Money', abbrNum(money) + ' $', 9) + '\n' + padCol('Shards', intNum(shards), 9) + '\n' + padCol('Spent', abbrNum(spent) + ' $', 9) + '\n' + padCol('Earned', abbrNum(earned) + ' $', 9) + '\n```';
  const combat = '```\n' + padCol('Kills', intNum(kills), 9) + '\n' + padCol('Deaths', intNum(deaths), 9) + '\n' + padCol('K/D', kd, 9) + '\n```';
  const activity = '```\n' + padCol('Playtime', playtimeStr(s.playtime), 15) + '\n' + padCol('Blocks mined', intNum(mined), 15) + '\n' + padCol('Blocks placed', intNum(placed), 15) + '\n' + padCol('Mobs killed', intNum(mobs), 15) + '\n```';
  return {
    author: { name: 'DonutSMP Stats' },
    title: name,
    url: 'https://donutsmpstats.com/playerstats.html?name=' + encodeURIComponent(name),
    color: 0xa78bfa, // Player Stats tile colour on the website
    thumbnail: { url: 'https://minotar.net/helm/' + encodeURIComponent(name) + '/128.png' },
    fields: [
      { name: '💰 Economy', value: eco, inline: false },
      { name: '⚔️ Combat', value: combat, inline: false },
      { name: '⛏️ Activity', value: activity, inline: false }
    ],
    footer: { text: 'donutsmpstats.com' },
    timestamp: new Date().toISOString()
  };
}

// ---- auction prices (for the /menu Auction Prices button) ---------------
function prettyItem(item) { return String(item || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
async function auctionInfo(token, item) {
  try {
    const r = await fetch('https://api.donutsmp.net/v1/auction/list/1', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ search: item.replace(/_/g, ' '), sort: 'lowest_price' })
    });
    if (!r.ok) return { status: r.status, info: null };
    const j = await r.json().catch(function () { return null; });
    const arr = (j && Array.isArray(j.result)) ? j.result : [];
    let best = null, listing = null, matches = 0;
    for (const a of arr) {
      const id = a && a.item && a.item.id;
      if (id !== 'minecraft:' + item) continue;
      matches++;
      const count = (a.item && a.item.count) ? a.item.count : 1;
      const unit = a.price / count;
      if (isFinite(unit) && (best === null || unit < best)) { best = unit; listing = { count: count, total: a.price }; }
    }
    return { status: 200, info: best === null ? null : { unit: best, listing: listing, matches: matches } };
  } catch (e) { return { status: 0, info: null }; }
}
async function priceHistory(kv, item) {
  if (!kv) return [];
  try {
    let hh = null;
    try { const raw = await kv.get('phist'); hh = raw ? JSON.parse(raw) : null; } catch (e) {}
    let series = (hh && Array.isArray(hh.series)) ? hh.series : [];
    if (!series.length) { try { const raw2 = await kv.get('series'); if (raw2) series = JSON.parse(raw2) || []; } catch (e) {} }
    return series.map(function (s) {
      var v = (s.p && s.p[item] != null) ? s.p[item] : null;
      if (v == null) return null;
      if (typeof v === 'number') return { t: s.t, o: v, s: null };
      return { t: s.t, o: (v.o != null ? v.o : null), s: (v.s != null ? v.s : null) };
    }).filter(function (x) { return x && (x.o != null || x.s != null); });
  } catch (e) { return []; }
}
function histStats(points) {
  const o = (points || []).map(function (p) { return (p && p.o != null) ? p.o : null; }).filter(function (v) { return v != null; });
  if (!o.length) return null;
  let sum = 0, mn = o[0], mx = o[0];
  for (const v of o) { sum += v; if (v < mn) mn = v; if (v > mx) mx = v; }
  let ls = null;
  for (let i = points.length - 1; i >= 0; i--) { if (points[i] && points[i].s != null) { ls = points[i].s; break; } }
  return { cur: o[o.length - 1], avg: sum / o.length, min: mn, max: mx, n: o.length, lastSale: ls };
}
const PR_ITEMS = [
  { id: 'netherite_ingot', label: 'Netherite Ingot', emoji: '🔶' },
  { id: 'netherite_scrap', label: 'Netherite Scrap', emoji: '🟠' },
  { id: 'netherite_block', label: 'Netherite Block', emoji: '⬛' },
  { id: 'enchanted_golden_apple', label: 'God Apple', emoji: '🍏' },
  { id: 'elytra', label: 'Elytra', emoji: '🪶' },
  { id: 'dragon_head', label: 'Dragon Head', emoji: '🐉' }
];
function itemMenuComponents() {
  const rows = []; let row = [];
  PR_ITEMS.forEach(function (it) {
    row.push({ type: 2, style: 2, label: it.label, emoji: { name: it.emoji }, custom_id: 'pr:' + it.id });
    if (row.length === 3) { rows.push({ type: 1, components: row }); row = []; }
  });
  if (row.length) rows.push({ type: 1, components: row });
  return rows;
}
function itemViewComponents(item, range) {
  const ranges = ['1h', '1d', '1w'];
  const r1 = { type: 1, components: ranges.map(function (rg) { return { type: 2, style: rg === range ? 1 : 2, label: rg, custom_id: 'prg:' + item + ':' + rg }; }) };
  const r2 = { type: 1, components: [
    { type: 2, style: 2, label: 'Items', emoji: { name: '🔙' }, custom_id: 'menu:prices' },
    { type: 2, style: 5, label: 'Website', emoji: { name: '🌐' }, url: 'https://donutsmpstats.com/donutprices.html' }
  ] };
  return [r1, r2];
}
function filterRange(points, range) {
  if (!points || !points.length) return [];
  const span = range === '1h' ? 3600e3 : range === '1w' ? 7 * 864e5 : 864e5;
  const cut = Date.now() - span;
  const f = points.filter(function (p) { return p && p.t >= cut; });
  return f.length >= 2 ? f : points;
}
function chartUrl(points, range) {
  const pts = (points || []).filter(function (p) { return p && p.o != null; });
  if (pts.length < 2) return null;
  const target = range === '1h' ? 40 : 34;
  const step = Math.max(1, Math.ceil(pts.length / target));
  const sel = [];
  for (let i = 0; i < pts.length; i += step) sel.push(pts[i]);
  if (sel[sel.length - 1] !== pts[pts.length - 1]) sel.push(pts[pts.length - 1]);
  const wk = range === '1w';
  function pad(n) { return ('0' + n).slice(-2); }
  function lab(p) { const dt = new Date(p.t); return wk ? (pad(dt.getUTCDate()) + '.' + pad(dt.getUTCMonth() + 1)) : (pad(dt.getUTCHours()) + ':' + pad(dt.getUTCMinutes())); }
  const dataStr = '[' + sel.map(function (p) { return Math.round(p.o); }).join(',') + ']';
  const yCb = 'function(v){v=+v;var a=Math.abs(v);if(a>=1e9)return (v/1e9).toFixed(a>=1e10?0:1)+"b";if(a>=1e6)return (v/1e6).toFixed(a>=1e8?0:1)+"m";if(a>=1e3)return (v/1e3).toFixed(0)+"k";return ""+v;}';
  const pr = sel.length > 55 ? 0 : 2;
  function make(labels) {
    const cfg = '{type:"line",data:{labels:' + labels + ',datasets:[{data:' + dataStr + ',borderColor:"#f5b942",backgroundColor:"rgba(245,185,66,0.15)",fill:true,pointRadius:' + pr + ',pointBackgroundColor:"#f5b942",borderWidth:2,lineTension:0.35}]},options:{legend:{display:false},scales:{xAxes:[{ticks:{fontColor:"#8c8ca3",maxTicksLimit:5,maxRotation:0,autoSkip:true},gridLines:{display:false}}],yAxes:[{ticks:{fontColor:"#8c8ca3",callback:' + yCb + '},gridLines:{color:"rgba(255,255,255,0.06)"}}]}}}';
    return 'https://quickchart.io/chart?bkg=' + encodeURIComponent('#15151f') + '&w=560&h=260&c=' + encodeURIComponent(cfg);
  }
  const withLabels = make('[' + sel.map(function (p) { return '"' + lab(p) + '"'; }).join(',') + ']');
  if (withLabels.length <= 1900) return withLabels;
  return make('[' + sel.map(function () { return '""'; }).join(',') + ']');
}
function priceEmbed(item, points, range) {
  const pretty = prettyItem(item);
  const fp = filterRange(points, range);
  const use = fp.length ? fp : (points || []);
  const hs = histStats(use);
  const rangeLabel = range === '1h' ? 'last hour' : (range === '1w' ? 'last week' : 'last day');
  const ovals = use.map(function (p) { return (p && p.o != null) ? p.o : null; }).filter(function (v) { return v != null; });
  const chg = (ovals.length >= 2 && ovals[0] > 0) ? ((ovals[ovals.length - 1] - ovals[0]) / ovals[0] * 100) : null;
  let rows;
  if (hs) {
    rows = padCol('Current', abbrNum(Math.round(hs.cur)) + ' $', 10)
      + '\n' + padCol('Average', abbrNum(Math.round(hs.avg)) + ' $', 10)
      + '\n' + padCol('Min', abbrNum(Math.round(hs.min)) + ' $', 10)
      + '\n' + padCol('Max', abbrNum(Math.round(hs.max)) + ' $', 10);
    if (hs.lastSale != null) rows += '\n' + padCol('Last sale', abbrNum(Math.round(hs.lastSale)) + ' $', 10);
  } else {
    rows = 'No price history yet.';
  }
  let desc = 'Price · ' + rangeLabel;
  if (chg != null) desc += '  ·  ' + (chg >= 0 ? '▲ +' : '▼ ') + Math.abs(chg).toFixed(1) + '%';
  const embed = {
    author: { name: 'DonutSMP Auction Prices' },
    title: pretty,
    url: 'https://donutsmpstats.com/donutprices.html',
    color: 0xf5b942,
    description: desc,
    fields: [ { name: '💰 Price', value: '```\n' + rows + '\n```', inline: false } ],
    footer: { text: 'donutsmpstats.com · live auction house' },
    timestamp: new Date().toISOString()
  };
  const cu = chartUrl(use, range);
  if (cu) embed.image = { url: cu };
  return embed;
}

export async function onRequest(context) {
  const request = context.request;
  const env = context.env || {};
  const kv = env.PRICE_HISTORY;
  const url = new URL(request.url);
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { headers: CORS });

  const isAdmin = () => {
    const h = request.headers.get('Authorization') || '';
    return env.DONUT_TOKEN && h === 'Bearer ' + env.DONUT_TOKEN;
  };

  // ---- ADMIN: register slash commands -----------------------------------
  if (url.searchParams.has('register')) {
    if (!isAdmin()) return json({ error: 'unauthorized' }, 401);
    const guild = url.searchParams.get('register');
    const commands = [
      {
        name: 'link', description: 'Link this Discord to your DonutSMP Stats price alerts',
        options: [{ name: 'code', description: 'The code shown on the website', type: 3, required: true }]
      },
      { name: 'unlink', description: 'Stop price alerts and unlink this Discord' },
      { name: 'alerts', description: 'Show your current DonutSMP price alerts' },
      { name: 'menu', description: 'Open the DonutSMP Stats menu' }
    ];
    commands.forEach(function (c) { c.integration_types = [0, 1]; c.contexts = [0, 1, 2]; });
    const useGuild = (guild && guild !== 'true' && guild !== '1');
    const endpoint = useGuild
      ? 'https://discord.com/api/v10/applications/' + APP_ID + '/guilds/' + guild + '/commands'
      : 'https://discord.com/api/v10/applications/' + APP_ID + '/commands';
    const r = await fetch(endpoint, { method: 'PUT', headers: botHeaders(env.DISCORD_BOT_TOKEN), body: JSON.stringify(commands) });
    const txt = await r.text();
    return json({ registered: r.ok, status: r.status, scope: useGuild ? 'guild:' + guild : 'global', body: txt.slice(0, 400) });
  }

  // ---- ADMIN: cron price check ------------------------------------------
  if (url.searchParams.has('cron')) {
    if (!isAdmin()) return json({ error: 'unauthorized' }, 401);
    if (!kv) return json({ error: 'no kv' }, 500);
    const codes = await getJSON(kv, K_INDEX, []);
    const priceCache = {};
    let checked = 0, fired = 0;
    for (const code of codes) {
      const link = await getJSON(kv, K_LINK(code), null);
      if (!link) continue;
      const alerts = await getJSON(kv, K_ALERTS(code), []);
      if (!alerts.length) continue;
      let changed = false;
      for (const al of alerts) {
        if (!al || al.active === false) continue;
        checked++;
        if (!(al.item in priceCache)) priceCache[al.item] = await unitPrice(env.DONUT_TOKEN, al.item);
        const price = priceCache[al.item];
        if (price === null || price === undefined) continue;
        const hit = al.dir === 'below' ? (price <= al.amount) : (price >= al.amount);
        if (hit && al.state !== 'fired') {
          al.state = 'fired';
          changed = true;
          const arrow = al.dir === 'below' ? 'dropped to/below' : 'rose to/above';
          const msg = ':bell: **' + al.item.replace(/_/g, ' ') + '** ' + arrow + ' **' + al.amount.toLocaleString('en-US') +
            '$** — now **' + Math.round(price).toLocaleString('en-US') + '$** each.\n<https://donutsmpstats.com/donutprices.html>';
          if (al.dest === 'channel' && al.channelId) {
            await sendMessage(env.DISCORD_BOT_TOKEN, al.channelId, '<@' + link.discordId + '> ' + msg);
          } else {
            let dm = link.dmChannelId;
            if (!dm) dm = await openDM(env.DISCORD_BOT_TOKEN, link.discordId);
            if (dm) await sendMessage(env.DISCORD_BOT_TOKEN, dm, msg);
          }
          fired++;
        } else if (!hit && al.state === 'fired') {
          al.state = 'armed'; changed = true; // re-arm once it crosses back
        }
      }
      if (changed) await kv.put(K_ALERTS(code), JSON.stringify(alerts));
    }
    return json({ ok: true, codes: codes.length, checked: checked, fired: fired });
  }

  // ---- WEBSITE: link status ---------------------------------------------
  if (url.searchParams.has('status')) {
    if (!kv) return json({ linked: false, note: 'no-kv' });
    const code = url.searchParams.get('status');
    const link = await getJSON(kv, K_LINK(code), null);
    if (!link) return json({ linked: false });
    return json({ linked: true, username: link.username || 'Discord user' });
  }

  // ---- WEBSITE: alerts get/save -----------------------------------------
  if (url.searchParams.has('alerts')) {
    if (!kv) return json({ error: 'no-kv' }, 500);
    const code = url.searchParams.get('alerts');
    const link = await getJSON(kv, K_LINK(code), null);
    if (!link) return json({ error: 'not-linked' }, 403);
    if (method === 'GET') {
      return json({ items: ITEMS, alerts: await getJSON(kv, K_ALERTS(code), []) });
    }
    if (method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const incoming = Array.isArray(body.alerts) ? body.alerts : [];
      const prev = await getJSON(kv, K_ALERTS(code), []);
      const prevById = {};
      prev.forEach(a => { if (a && a.id) prevById[a.id] = a; });
      const clean = [];
      for (const a of incoming.slice(0, 40)) {
        if (!a || ITEMS.indexOf(a.item) < 0) continue;
        const amount = Math.max(0, Math.round(Number(a.amount) || 0));
        if (!amount) continue;
        const dir = a.dir === 'above' ? 'above' : 'below';
        const dest = a.dest === 'channel' ? 'channel' : 'dm';
        const id = a.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
        const keep = prevById[id];
        clean.push({
          id: id, item: a.item, dir: dir, amount: amount, dest: dest,
          channelId: dest === 'channel' ? String(a.channelId || '').trim() : '',
          active: a.active !== false,
          state: (keep && keep.item === a.item && keep.dir === dir && keep.amount === amount) ? (keep.state || 'armed') : 'armed'
        });
      }
      await kv.put(K_ALERTS(code), JSON.stringify(clean));
      await addToIndex(kv, code);
      return json({ ok: true, alerts: clean });
    }
  }

  // ---- DISCORD: interactions (POST, signed) -----------------------------
  if (method === 'POST') {
    const sig = request.headers.get('x-signature-ed25519');
    const ts = request.headers.get('x-signature-timestamp');
    const bodyText = await request.text();
    if (!sig || !ts) return json({ error: 'bad request' }, 400);
    const ok = await verifyDiscord(PUBLIC_KEY, sig, ts, bodyText);
    if (!ok) return new Response('invalid request signature', { status: 401 });

    let interaction = {};
    try { interaction = JSON.parse(bodyText); } catch (e) {}

    if (interaction.type === 1) return json({ type: 1 }); // PING -> PONG

    if (interaction.type === 2) { // APPLICATION_COMMAND
      const name = interaction.data && interaction.data.name;
      const user = (interaction.member && interaction.member.user) || interaction.user || {};
      const uname = user.global_name || user.username || 'Discord user';
      const opts = {};
      ((interaction.data && interaction.data.options) || []).forEach(o => { opts[o.name] = o.value; });

      if (name === 'menu') {
        return json({ type: 4, data: { flags: 64, embeds: [ { title: '🍩 DonutSMP Stats', description: 'Pick a tool below to get started.', color: 0xe8a44c, footer: { text: 'donutsmpstats.com' } } ], components: [ { type: 1, components: [ { type: 2, style: 1, label: 'Player Stats', emoji: { name: '📊' }, custom_id: 'menu:playerstats' }, { type: 2, style: 3, label: 'Auction Prices', emoji: { name: '💰' }, custom_id: 'menu:prices' } ] } ] } });
      }

      if (!kv) return reply(':warning: Storage not configured. Try again later.');

      if (name === 'link') {
        const code = String(opts.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!code) return reply(':warning: Please provide the code shown on the website.');
        const ch = interaction.channel; const dmChannelId = (ch && ch.type === 1) ? ch.id : '';
        await kv.put(K_LINK(code), JSON.stringify({ discordId: user.id, username: uname, dmChannelId: dmChannelId, linkedAt: Date.now() }));
        return reply(':white_check_mark: Linked as **' + uname + '**! Head back to the website — you can now set up price alerts, and I will ping you here.');
      }
      if (name === 'unlink') {
        const codes = await getJSON(kv, K_INDEX, []);
        let removed = 0;
        for (const c of codes) {
          const l = await getJSON(kv, K_LINK(c), null);
          if (l && l.discordId === user.id) { await kv.delete(K_LINK(c)); removed++; }
        }
        return reply(removed ? ':wave: Unlinked. You will not get price alerts anymore.' : ':information_source: Nothing was linked to this account.');
      }
      if (name === 'alerts') {
        const codes = await getJSON(kv, K_INDEX, []);
        let lines = [];
        for (const c of codes) {
          const l = await getJSON(kv, K_LINK(c), null);
          if (!l || l.discordId !== user.id) continue;
          const als = await getJSON(kv, K_ALERTS(c), []);
          als.forEach(a => lines.push('- **' + a.item.replace(/_/g, ' ') + '** ' + a.dir + ' ' + a.amount.toLocaleString('en-US') + '$ (' + a.dest + ')'));
        }
        return reply(lines.length ? '**Your price alerts:**\n' + lines.join('\n') : ':information_source: No alerts yet. Add some on the website.');
      }
      return reply(':grey_question: Unknown command.');
    }
    if (interaction.type === 3) { // MESSAGE_COMPONENT (button)
      const cid = (interaction.data && interaction.data.custom_id) || '';
      if (cid === 'menu:playerstats') {
        return json({ type: 9, data: { custom_id: 'ps_modal', title: 'Player Stats', components: [ { type: 1, components: [ { type: 4, custom_id: 'ps_name', label: 'Minecraft username', style: 1, min_length: 1, max_length: 16, required: true, placeholder: 'e.g. Ikeacpvp' } ] } ] } });
      }
      if (cid === 'menu:prices') {
        return json({ type: 7, data: { content: '**Auction Prices** — pick an item:', embeds: [], components: itemMenuComponents() } });
      }
      if (cid.indexOf('pr:') === 0) {
        const it = cid.slice(3);
        const pts = await priceHistory(kv, it);
        return json({ type: 7, data: { content: '', embeds: [priceEmbed(it, pts, '1d')], components: itemViewComponents(it, '1d') } });
      }
      if (cid.indexOf('prg:') === 0) {
        const parts = cid.split(':');
        const it = parts[1], rg = parts[2] || '1d';
        const pts = await priceHistory(kv, it);
        return json({ type: 7, data: { content: '', embeds: [priceEmbed(it, pts, rg)], components: itemViewComponents(it, rg) } });
      }
      
      return json({ type: 4, data: { content: ':grey_question: Unknown button.', flags: 64 } });
    }
    if (interaction.type === 5) { // MODAL_SUBMIT
      const cid = (interaction.data && interaction.data.custom_id) || '';
      if (cid === 'ps_modal') {
        let nameVal = '';
        try { for (const row of (interaction.data.components || [])) for (const comp of (row.components || [])) if (comp.custom_id === 'ps_name') nameVal = comp.value; } catch (e) {}
        nameVal = String(nameVal || '').trim();
        if (!nameVal) return reply(':warning: Please enter a username.');
        const res = await playerStats(env.DONUT_TOKEN, nameVal);
        if (res.status === 401 || res.status === 403 || res.status >= 500) return reply(':warning: DonutSMP API is temporarily restricted — stats can’t load right now.');
        const s = res.stats;
        if (!s || s.money === undefined) return reply(':mag: Player **' + nameVal + '** not found, or no data.');
        return json({ type: 4, data: { embeds: [statsEmbed(nameVal, s)], flags: 64 } });
      }
      return reply(':grey_question: Unknown form.');
    }

    return json({ type: 4, data: { content: 'Unsupported interaction.', flags: 64 } });
  }

  return json({ ok: true, service: 'discord', hint: 'POST from Discord, or use the website.' });
}
