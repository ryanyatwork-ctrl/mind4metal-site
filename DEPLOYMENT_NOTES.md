# Mind4Metal album art drop-in

## What this bundle does
- Keeps your existing manifest-first logic.
- Adds live remote album-art lookup through `/api/art/resolve`.
- Stores successful lookups and misses in Cloudflare Workers KV.
- Falls back to rotating dragon images when nothing is found.

## Files to replace/add
- Replace `m4m-art.js` with the included file.
- Replace `art-manifest.json` with the included file.
- Add the `/art/` folder with the two fallback dragon images.
- Add `mind4metal-art-worker.js` and `wrangler.jsonc` for the Worker deployment.

## Deployment outline
1. Create a Workers KV namespace named something like `mind4metal-art-cache`.
2. Put the namespace IDs into `wrangler.jsonc`.
3. Deploy the Worker so it serves both your site assets and the `/api/art/resolve` route.
4. Keep your current `index.html` as-is. The new `m4m-art.js` defaults to `/api/art/resolve` automatically.

## Shared Recently Played
- The same Worker now serves `/api/recent` for the public recent-track list.
- It also serves `/api/recent/poll` to manually poll Icecast and seed/update the list.
- A scheduled trigger runs every minute and keeps the shared list current.
- Create a second KV namespace named something like `mind4metal-recent-tracks`, then put its IDs into the `RECENT_TRACKS` binding in `wrangler.jsonc`.
- The Worker can fall back to `ART_CACHE` if `RECENT_TRACKS` is not bound, but a dedicated namespace is cleaner.
- After deploying, visit `/api/recent/poll` once to seed the list immediately.

## Optional index.html hardening
If you want the config to be explicit, change the init block to:

```js
M4MArt.init({
  manifestUrl: 'art-manifest.json',
  resolverEndpoint: '/api/art/resolve',
  fallbackImages: [
    'art/fallback-dragon-1.png',
    'art/fallback-dragon-2.png'
  ]
})
```

This is optional because the supplied script already defaults to those values when present in the manifest.
