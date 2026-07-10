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
function statsEmbed(name, s) {
  const money = Number(s.money) || 0, shards = Number(s.shards) || 0, kills = Number(s.kills) || 0, deaths = Number(s.deaths) || 0;
  const kd = deaths > 0 ? (kills / deaths).toFixed(2) : String(kills);
  return {
    title: name + ' — DonutSMP stats',
    url: 'https://donutsmpstats.com/playerstats.html?name=' + encodeURIComponent(name),
    color: 0xa78bfa,
    thumbnail: { url: 'https://minotar.net/helm/' + encodeURIComponent(name) + '/64.png' },
    fields: [
      { name: 'Money', value: abbrNum(money) + ' $', inline: true },
      { name: 'Shards', value: intNum(shards), inline: true },
      { name: 'Playtime', value: playtimeStr(s.playtime), inline: true },
      { name: 'Kills', value: intNum(kills), inline: true },
      { name: 'Deaths', value: intNum(deaths), inline: true },
      { name: 'K/D', value: kd, inline: true },
      { name: 'Blocks mined', value: intNum(s.broken_blocks), inline: true },
      { name: 'Blocks placed', value: intNum(s.placed_blocks), inline: true },
      { name: 'Mobs killed', value: intNum(s.mobs_killed), inline: true }
    ],
    footer: { text: 'donutsmpstats.com' }
  };
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
        return json({ type: 4, data: { content: '**DonutSMP Stats** — pick a tool:', flags: 64, components: [ { type: 1, components: [ { type: 2, style: 1, label: 'Player Stats', custom_id: 'menu:playerstats' } ] } ] } });
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
