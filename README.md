# darki-website

Source for [donutsmpstats.com](https://donutsmpstats.com) — tools for the DonutSMP Minecraft server. Hosted on Cloudflare Pages; every push to `main` auto-deploys.

## Pages
- `index.html` — dashboard
- `donutprices.html` — live auction-house prices, with per-item price graph
- `playerstats.html` — player stats lookup
- `spawner.html` — spawner drops / profit calculator
- `rtpmap.html` — live map of where players land when they /rtp

## Backend (Cloudflare Pages Functions)
- `functions/api/donut.js` — auction price aggregator (KV: PRICE_HISTORY)
- `functions/api/player.js` — player stats proxy
- `functions/api/rtp.js` — RTP map collector (KV: RTP_MAP, secret: RTP_TOKEN)
- `functions/_middleware.js` — redirect *.pages.dev to donutsmpstats.com

## Shared
- `theme.css` — design tokens, reset, dot-grid background
- `favicon.svg` — donut logo

## RTP map flow

Fabric mod (on /rtp) → POST `/api/rtp` with `Authorization: Bearer <RTP_TOKEN>` → KV `RTP_MAP` → rendered on `rtpmap.html`.
