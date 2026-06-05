# Album Art Pipeline — status & best-practice notes

_Last reviewed: 2026-06-05. Written after pulling the live Worker source and
testing the live endpoints._

## TL;DR

Yes — the "store album art in a database instead of calling Discogs every time"
idea is **already built and deployed**. It is a Cloudflare Worker backed by
Cloudflare KV. **But it is currently running in a degraded `LOW_KV_MODE` where it
does _not_ persist new art** (see below). Album art still *displays* for
listeners, because the Worker resolves it live on each request and an edge cache
holds the response for 5 minutes — it just isn't being saved to the database
long-term right now.

## What's actually deployed

- **Worker (live):** `mind4metal-art-resolver` (Cloudflare). Routes are attached
  to `mind4metal.com/api/*`. The static site itself is GitHub Pages behind
  Cloudflare; only `/api/*` hits the Worker.
- **KV namespaces (real IDs):**
  - `mind4metal-art-cache`     → `e1e40d75dfb7455ab1b325da21c73bbe`  (binding `ART_CACHE`)
  - `mind4metal-recent-tracks` → `3f4e7f31fbf543c9b9f9deb84c1ea94f`  (binding `RECENT_TRACKS`)
- **Secret:** `DISCOGS_TOKEN` (set via `wrangler secret put`, not in config).

### Resolution order (when a song changes)
Client `index.html` → `resolveArtUrl()`:
1. **Curated manifest** (`art-manifest.json`) — hand-picked overrides.
2. **Worker `/api/art/resolve`** → **Discogs master** (primary) → **iTunes** (fallback),
   upscaled to ~1200×1200. Server also has hard-coded `ART_OVERRIDES` that beat everything.
3. **Last.fm** — final client-side fallback.

### KV caching design (when NOT in low-KV mode)
- Track hit → cached **180 days**, key `track:<artist>|||<title>` (normalized).
- Miss      → cached **3 days** (negative cache, avoids re-hammering APIs).
- Each unique song is resolved against Discogs/iTunes **once**, then served from KV.

## ⚠️ The current problem: `LOW_KV_MODE = true`

The live Worker has `const LOW_KV_MODE = true`. While on:
- The cron (`scheduled`) is a **no-op**.
- `/api/recent` returns an **empty list** (`{"recent":[],"lowKvMode":true}`).
- `/api/art/resolve` still resolves art live and READS existing KV entries, but
  **writes nothing new** (`cache: "resolved-no-kv-write"`), and sets a 5-min edge cache.

This was almost certainly switched on to stop hitting Cloudflare's **free-tier KV
write limit (1,000 writes/day)**. The main write driver is the "recently played"
pipeline: the every-minute cron writes two keys (`recent:tracks` +
`recent:last-combo`) on each song change. Combined with per-track art writes,
that overruns 1,000/day.

So the database "isn't happening" in the persistent sense **only because of the
write quota**, not because the design is wrong.

## Recommended fix (best practice), in priority order

The art cache itself is a textbook good use of KV (write-once, read-many, with
TTLs). The fix is to stop the *write amplification* so `LOW_KV_MODE` can go back
to `false` and art persists again.

1. **Split the two workloads by their write profile.**
   - **Album art → keep in KV.** Writes plateau quickly: once the rotation's songs
     are each cached once, daily writes fall to ~the number of *new* songs/day.
   - **"Recently played" → move off KV.** It's high-churn, ordered, and rewrites a
     whole list on every song change. Better homes:
     - **Cloudflare D1** (SQLite) — free tier is **100,000 writes/day**, ~100× the
       headroom; ideal for an append-and-trim recent list. *(Recommended.)*
     - or a **Durable Object** (single-object counter/list, no KV quota), or
     - drop the server-side list entirely and build "recently played" **client-side**
       from what each browser observes (zero backend writes).

2. **Halve the remaining recent-list writes** (if staying on KV short-term):
   store the list and the last-combo guard in a **single KV key** (1 write per
   song change instead of 2).

3. **Turn `LOW_KV_MODE` back to `false`** once 1–2 are in place, so art writes
   resume. Verify with `?cache=` in the `/api/art/resolve` response
   (`kv-write` on first lookup, `kv-hit` thereafter).

4. **Pre-warm the cache (nice-to-have).** Have the cron (or `/api/recent/poll`)
   call the art resolver for the *current* track, so the cover lands in KV before
   any listener's browser asks — first listener never sees a placeholder.

5. **Alternative if you'd rather not add D1:** cache art responses in the
   **Workers Cache API** (`caches.default`) instead of KV. It has **no daily write
   quota** (only LRU eviction), so it sidesteps the limit entirely for art. KV is
   still nicer for guaranteed long-term persistence + the curated overrides.

### On storing the actual image *bytes* (R2) vs the URL
Current design caches the **resolved image URL** (art still loads from Apple/Discogs
CDNs). That is the right default — cheaper, simpler, and avoids the licensing gray
area of rehosting label artwork. Only move binaries into **R2** if you start seeing
dead CDN URLs or want full self-hosting. Not needed today.

## Repo vs live — important

- The committed `mind4metal-art-worker.js` is **older than the live Worker** (it
  lacks Discogs, `ART_OVERRIDES`, and `LOW_KV_MODE`). Before any Worker deploy,
  pull the live source first (`wrangler download` / dashboard) — do **not** deploy
  this repo copy as-is.
- `wrangler.jsonc` `name` is `mind4metal-art-worker`, which does **not** match the
  live `mind4metal-art-resolver`. That mismatch currently *protects* you: a stray
  `wrangler deploy` would make a separate, unused Worker rather than overwrite the
  live one. Don't "fix" the name until the repo source is reconciled with live.
