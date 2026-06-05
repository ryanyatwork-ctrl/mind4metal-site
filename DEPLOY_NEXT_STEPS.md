# What's done & what you do next (read first)

_Written 2026-06-05 while you were away._

## ✅ Already done and LIVE (nothing for you to do)
- **Service worker** is network-first for HTML (`mind4metal-v7`) — fixes now reach
  listeners on the next reload. _One reload sheds the old worker._
- **Mötley Crüe / umlaut freeze** was already fixed on the site; I also fixed the
  **same bug in the Admin console** (`studio-console-436.html`).
- **Admin "Album Art Manager"** is live in the Admin console (behind your
  Cloudflare Access login).
- Docs committed: `ART_PIPELINE_NOTES.md`, this file.

## ✅ Done but NOT deployed (safe; waiting on a Worker deploy you do when alert)
- **D1 database created + schema applied + tested**: `mind4metal-recent-tracks`
  (id `f648b4ae-bbff-4818-8955-28bdf4343b5a`).
- Ready-to-apply Worker changes on branch **`feat/d1-recent-and-art-override`**,
  folder **`worker-changes/`**.

I could NOT deploy the Worker myself: this machine has no `wrangler`/Cloudflare
login and the Cloudflare tools I have are read-only for Workers. That's fine —
**none of it is urgent** (album art already displays).

---

## PATH A — Fix mismatched album art (works NOW, no deploy) 🎯
This is the thing you asked for, and it's fully usable today.

1. Go to the Admin console (`/studio-console-436.html`), log in.
2. Scroll to **🖼️ Album Art Manager**. Tracks fill in as they play; covers show
   the exact image listeners get, with a source badge. Misses show **"No art"**.
3. On any wrong/missing cover click **Fix** → either:
   - type/paste a direct image URL (it previews), or
   - type the artist + album in the search box, **Search**, and click the right cover.
   Then **Save override** (it updates instantly in the Admin view).
4. Click **⬇ Export manifest** — it downloads an updated `art-manifest.json`.
5. **Publish it** one of two ways:
   - Drop the file in `D:\Projects\mind4metal-site\`, then tell me "commit the manifest"
     and I'll push it (goes live in ~1 min), **or**
   - Commit it yourself:
     ```
     cd "D:\Projects\mind4metal-site"
     git checkout main && git pull
     copy "%USERPROFILE%\Downloads\art-manifest.json" art-manifest.json
     git add art-manifest.json
     git commit -m "Update album art overrides"
     git push
     ```

That's the whole loop: **find → fix → publish**. No Worker deploy needed.

---

## PATH B — Optional upgrade (do this when you're awake & alert) ⚙️
Two improvements, both require deploying the live Worker `mind4metal-art-resolver`.
Benefit: (1) restores album-art **persistence** (it's currently off to dodge a KV
write limit), (2) makes the "recently played" list work again, (3) turns the
Admin "Save" into **1-click publish** (no manifest commit). **Not urgent.**

> ⚠️ This touches the live art API. Do it when you can watch it for 5 minutes.
> Rollback is easy (below).

### Easiest route — Cloudflare dashboard (no wrangler needed)
1. dash.cloudflare.com → **Workers & Pages** → **mind4metal-art-resolver**.
2. **Settings → Bindings**: add a **D1 database** binding
   - Variable name: `RECENT_DB`  →  database: `mind4metal-recent-tracks`.
3. **Settings → Variables and Secrets**: add a **Secret**
   - `ADMIN_API_TOKEN` = (make up a long random string; you'll paste the same one
     into the Admin page — see step 7).
4. Click **Edit code**. In the editor, make these 4 edits (full code is in
   `worker-changes/` on the branch):
   - **a.** Replace the bodies of `updateRecentTracks`, `handleRecent`,
     `handleRecentPoll` with the versions in `worker-changes/recent-tracks-d1.js`.
   - **b.** Add the route line inside `fetch()` with the other routes:
     `if (url.pathname === '/api/art/override') return handleArtOverride(request, env);`
     and paste `handleArtOverride` from `worker-changes/art-override-endpoint.js`.
   - **c.** In `scheduled()`, delete the line `if (LOW_KV_MODE) return;`.
   - **d.** Change `const LOW_KV_MODE = true;` → `const LOW_KV_MODE = false;`.
5. Click **Deploy**.
6. **Verify** (paste in a browser / terminal):
   - `https://mind4metal.com/api/recent` → should NOT say `lowKvMode`; after a song
     change it lists tracks.
   - `https://mind4metal.com/api/art/resolve?artist=Metallica&title=One` → run twice;
     first shows `"cache":"kv-write"`, second `"cache":"kv-hit"`.
7. **(For 1-click art publish)** Open `studio-console-436.html` and apply
   `worker-changes/admin-1click-snippet.js` (adds `ADMIN_API_TOKEN` + a
   `publishOverride()` call so Save pushes straight to KV). Then `git commit/push`.
   — Or just keep using Export manifest from Path A; both work.

### Rollback if anything looks wrong
- In the Worker, set `const LOW_KV_MODE = true;` and Deploy (instant safe mode), or
- Workers & Pages → mind4metal-art-resolver → **Deployments** → roll back to the
  previous version.
- The D1 DB and override route are additive — leaving them is harmless.

---

## Branches
- `main` — all the live/safe work (SW, admin tool, docs). Deployed.
- `feat/d1-recent-and-art-override` — the Path B Worker changes + `worker-changes/`.
  Merge to `main` whenever; it does not auto-deploy the Worker (that's the dashboard
  step above).

## TL;DR for half-asleep you
Nothing is broken; nothing is urgent. To fix album art **right now**: Admin →
Album Art Manager → Fix → Export → send me the file. The Worker upgrade (Path B)
can wait until you're awake.
