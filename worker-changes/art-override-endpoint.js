// ===========================================================================
// POST /api/art/override  — admin "save correct cover" -> live for everyone
// ---------------------------------------------------------------------------
// Writes a manual entry into the ART_CACHE KV under the SAME track key the
// resolver reads. Because handleResolve() already returns ART_CACHE hits and
// always trusts `source: 'manual'` (see cachedArtMatches), a saved override is
// served to every listener instantly — no client change, no manifest commit.
//
// Manual override writes are rare (admin-triggered), so they bypass LOW_KV_MODE
// without any quota concern.
//
// HOW TO APPLY (against the LIVE worker source; see INTEGRATION.md):
//   1. In fetch(), add a route (place with the other /api routes):
//        if (url.pathname === '/api/art/override') return handleArtOverride(request, env);
//   2. Paste handleArtOverride() below into the worker.
//   3. Set the shared secret:  wrangler secret put ADMIN_API_TOKEN
//   4. The admin page (studio-console-436.html) posts to it with the
//      `x-admin-token` header — see admin-1click-snippet.js.
//
// Reuses existing helpers: trackKey(), json().
// Note: the admin page is same-origin (mind4metal.com), so no CORS preflight.
// ===========================================================================

async function handleArtOverride(request, env) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
  }

  const token = request.headers.get('x-admin-token') || '';
  if (!env.ADMIN_API_TOKEN || token !== env.ADMIN_API_TOKEN) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'bad_json' }, { status: 400 }); }

  const artist = (body.artist || '').trim();
  const title  = (body.title  || '').trim();
  const url    = (body.url    || '').trim();
  if (!artist || !title) {
    return json({ ok: false, error: 'artist and title required' }, { status: 400 });
  }

  const tKey = trackKey(artist, title);

  // Empty url => clear the override (revert to normal resolution).
  if (!url) {
    await env.ART_CACHE.delete(tKey);
    return json({ ok: true, cleared: true, key: tKey });
  }

  const stored = {
    url,
    source: 'manual',
    artist,
    title,
    entry: { artist, title, album: body.album || '', art: url },
    checkedAt: new Date().toISOString(),
  };
  // Always persist manual overrides (bypass LOW_KV_MODE), 1-year TTL.
  await env.ART_CACHE.put(tKey, JSON.stringify(stored), { expirationTtl: 60 * 60 * 24 * 365 });

  return json({ ok: true, stored: true, key: tKey, url });
}
