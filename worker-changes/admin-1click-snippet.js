// ===========================================================================
// Admin "1-click publish" — optional upgrade to the Album Art Manager
// ---------------------------------------------------------------------------
// Once /api/art/override is deployed (art-override-endpoint.js) and the
// ADMIN_API_TOKEN secret is set, wire the admin tool's Save to push the
// override straight to KV so it's live for everyone with no manifest commit.
//
// In studio-console-436.html:
//   1. Add a constant near ADMIN_PASSWORD (same client-side trust model — the
//      page is gated and on an obscure URL):
//        const ADMIN_API_TOKEN = "<same value you set via wrangler secret>";
//
//   2. In the ArtMgr `save()` function, after `persist();`, also push to KV:
//
//        publishOverride(editing.artist, editing.title, url).then(ok => {
//          el('amStatus').textContent = ok
//            ? 'Saved & published live to all listeners.'
//            : 'Saved locally. Publish failed — use Export manifest.';
//        });
//
//   3. In `clearOverride()`, after `persist();`, push an empty url to clear:
//        publishOverride(editing.artist, editing.title, '');
//
//   4. Add this helper inside the ArtMgr IIFE:

async function publishOverride(artist, title, url) {
  try {
    const r = await fetch('/api/art/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_API_TOKEN },
      body: JSON.stringify({ artist, title, url }),
    });
    const d = await r.json().catch(() => ({}));
    return r.ok && d.ok;
  } catch {
    return false;
  }
}

// Precedence reminder (so you know where a manual override lands):
//   client manifest (art-manifest.json)
//     -> worker hard-coded ART_OVERRIDES
//       -> worker KV ART_CACHE  <-- this endpoint writes here (source:'manual')
//         -> Discogs -> iTunes -> (client) Last.fm
// So a manifest entry still wins over a KV override for the same track. Prefer
// ONE mechanism per track to avoid confusion; KV override is the no-commit path.
