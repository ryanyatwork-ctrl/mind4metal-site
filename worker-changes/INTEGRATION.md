# Worker changes — integration guide (review before deploying)

These changes are **prepared, not deployed.** They target the live Cloudflare
Worker `mind4metal-art-resolver`. Apply them while you can watch the deploy, then
verify with the checks below. Nothing here touches listeners until you deploy.

## Why
- The Worker is in `LOW_KV_MODE` (no KV writes) because the every-minute cron
  writing the "recently played" list to KV blew the free-tier KV write limit
  (1,000/day). That also empties `/api/recent` and stops persisting album art.
- Fix: move the high-churn recent list to **D1** (free tier 100k writes/day),
  keep album art in **KV**, then turn `LOW_KV_MODE` off so art persists again.
- Bonus: a small `POST /api/art/override` lets the Admin Album Art Manager
  publish a corrected cover to all listeners instantly (writes KV `source:manual`,
  which the resolver already trusts).

## What's in this folder
| File | Purpose |
|------|---------|
| `0001_recent_tracks.sql` | D1 schema (already applied to the DB). |
| `recent-tracks-d1.js` | Drop-in D1 versions of `updateRecentTracks` / `handleRecent` / `handleRecentPoll`. |
| `art-override-endpoint.js` | New `handleArtOverride()` + route for `POST /api/art/override`. |
| `admin-1click-snippet.js` | Optional admin-page wiring for 1-click publish. |
| `wrangler-additions.jsonc` | D1 binding + real KV IDs to merge into wrangler config. |

## Already done for you (safe, reversible)
- D1 database **`mind4metal-recent-tracks`** created — id
  `f648b4ae-bbff-4818-8955-28bdf4343b5a` (region WNAM). Schema applied.

## Steps to deploy
1. **Get the live source** (the repo copy is stale — do not deploy it as-is):
   `wrangler download mind4metal-art-resolver` (or copy from the CF dashboard).
2. **Apply `recent-tracks-d1.js`**: replace the three KV recent functions; in
   `scheduled()` drop the `if (LOW_KV_MODE) return;` guard.
3. **Apply `art-override-endpoint.js`**: add the route in `fetch()` and paste the
   handler.
4. **Flip persistence back on**: set `const LOW_KV_MODE = false;`.
5. **Merge `wrangler-additions.jsonc`** into the deploy config (D1 binding + real
   KV IDs). Set secrets: `wrangler secret put ADMIN_API_TOKEN` (and confirm
   `DISCOGS_TOKEN` is still set).
6. **Deploy** (`wrangler deploy`) — watch it.

## Verify after deploy
- `GET /api/recent` → returns a growing list (no longer `lowKvMode:true`).
- Wait for a song change (or hit `/api/recent/poll`) → a new row appears.
- `GET /api/art/resolve?artist=Metallica&title=One` → first call `cache:"kv-write"`,
  second call `cache:"kv-hit"` (art persistence restored).
- `POST /api/art/override` with the `x-admin-token` header + `{artist,title,url}`
  → `{ok:true,stored:true}`; then `/api/art/resolve` for that track returns the
  override as `source:"manual"`.
- Watch KV write count for a day to confirm you're comfortably under 1,000.

## Rollback
- Set `LOW_KV_MODE = true` and redeploy (instant mitigation), or
- Redeploy the previous Worker version from the CF dashboard's version history.
- The D1 DB and override endpoint are additive; leaving them bound is harmless.
