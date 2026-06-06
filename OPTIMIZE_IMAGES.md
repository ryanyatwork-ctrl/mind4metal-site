# Image weight — findings & how to fix (page-load optimization)

_Audited 2026-06-06. I couldn't re-encode here (no ImageMagick/sharp on this
machine — the `convert` in PATH is the Windows disk utility, not ImageMagick),
and I won't swap image references blind/unattended since I can't eyeball the
results. So this is a ready-to-run plan._

## The problem
Several images are far bigger than the size they're displayed at:

| File | Size | Used as | Displayed at | Issue |
|------|------|---------|--------------|-------|
| `Mind4Metal_Background.png` | **1.8 MB** | CSS page background | full, ~6–8% opacity | Huge for a faint background; loads every visit |
| `Mind4Metal_Dragon.png` | **1.4 MB** | nav / footer / admin logo | 28–44 px | ~1.4 MB to draw a 28px mark |
| `Mind4Metal_Banner.png` | **2.1 MB** | Open Graph / social preview | social card | Too big for OG (target < 1 MB, 1200×630) |
| `Chrome_Viper_cover.png` | **1.7 MB** | album art (manifest) | 220 px | 1.7 MB for a 220px cover |

### Dead weight (not referenced anywhere — safe to delete from the repo)
- `fallback-dragon-1.png` — **5.5 MB**
- `fallback-dragon-2.png` — **5.4 MB**
- `mind4metal-logo.png` — **2.6 MB**

These are not loaded by any page (grep finds no references). Deleting them
removes **~13.5 MB** from the repo/clone. (I left them in place rather than
delete unattended — your call. `git rm` them when you're ready.)

## The fix (run when you have a few minutes to eyeball results)
A non-destructive optimizer is included — it writes optimized copies to
`./optimized/` and never touches originals or references:

```
cd D:\Projects\mind4metal-site
npm init -y
npm i sharp
node scripts/optimize-images.mjs
```

Then review `./optimized/` and swap references:

1. **Background** (biggest win — loads on every page):
   `index.html` / `blog.html` CSS `url('Mind4Metal_Background.png')`
   → `url('optimized/Mind4Metal_Background.webp')`  (~1.8 MB → ~150–250 KB)
2. **Dragon** (nav/footer/admin):
   `src="Mind4Metal_Dragon.png"` → `src="optimized/Mind4Metal_Dragon-256.webp"`
   in index.html, community.html, blog.html, studio-console-436.html
   (~1.4 MB → ~15–30 KB). Keep width/height attributes.
3. **OG image**: in the `og:image` meta, point to
   `optimized/Mind4Metal_Banner-og.jpg` (~2.1 MB → ~120–200 KB). Better social
   previews + faster scrape.
4. **Chrome Viper cover**: in `art-manifest.json`, set the `art` to
   `optimized/Chrome_Viper_cover-600.webp` (~1.7 MB → ~40–80 KB).

Estimated total transfer saved on a first visit: **~2–3 MB** (background +
dragon dominate), plus a much lighter social card.

## Notes
- WebP is supported by all current browsers; for the OG image use JPEG (some
  social scrapers still prefer it) — the script emits both where relevant.
- After swapping, bump the service-worker cache (`sw.js` CACHE_NAME) so returning
  visitors pick up the new assets.
- If you'd rather I do the swaps, run the script and tell me — I'll wire the
  references and bump the SW in one commit (you just review the visuals).
