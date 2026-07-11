// mind4metal-art-resolver — READY TO DEPLOY (2026-07-10)
// Based on the LIVE Worker source (pulled 2026-07-10), integrating:
//   1. POST/DELETE /api/art/override — instant manual art publish from /admin
//      (requires ADMIN_API_TOKEN secret; writes KV source:'manual', no TTL)
//   2. Recently-played moved from KV to D1 (binding RECENT_DB ->
//      mind4metal-recent-tracks) so KV writes stay far under the free tier
//   3. LOW_KV_MODE=false — resolved art now persists in KV for every listener
//   4. '?' before a digit repaired as apostrophe (Back To ?85 -> '85), matching
//      the site's client-side repair
//   5. iTunes scoring now penalizes compilation albums (Greatest Hits / Very
//      Best Of / etc.) and prefers the earliest release, so songs resolve to
//      their original album cover instead of a hits collection
//   6. /api/guestbook — public guestbook backed by the same D1 database
//      (GET list, POST sign with honeypot + rate limit, DELETE moderate)
//
// DEPLOY (Cloudflare dashboard):
//   Workers & Pages -> mind4metal-art-resolver -> Edit code ->
//   replace everything with this file -> Deploy.
//   Settings -> Variables and Secrets: add secret ADMIN_API_TOKEN
//   Settings -> Bindings: add D1 database binding, name RECENT_DB,
//     database mind4metal-recent-tracks
//   Settings -> Trigger Events: add Cron trigger: */1 * * * *
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === '/api/art/resolve') {
      return handleResolve(request, env, url);
    }

    if (url.pathname === '/api/art/override') {
      return handleOverride(request, env);
    }

    if (url.pathname === '/api/guestbook') {
      return handleGuestbook(request, env);
    }

    if (url.pathname === '/api/recent') {
      return handleRecent(env);
    }

    if (url.pathname === '/api/recent/poll') {
      return handleRecentPoll(env);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404, headers: corsHeaders() });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(updateRecentTracks(env));
  },
};

const POSITIVE_TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days
const MISS_TTL_SECONDS     = 60 * 60 * 24 * 3;   // 3 days
const STATUS_URL           = 'https://radio.mind4metal.com/status-json.xsl';
const RECENT_MAX           = 15;
const DISCOGS_API_BASE     = 'https://api.discogs.com';
const DISCOGS_USER_AGENT   = 'Mind4MetalRadio/1.0 +https://mind4metal.com';
const LOW_KV_MODE          = false;

// Use stable public image URLs here. These beat all API lookups and KV misses.
// Key format is `${normalize(artist)}|||${normalize(title)}`.
const ART_OVERRIDES = {
  'glory|||like an eagle': {
    url: 'https://lastfm.freetls.fastly.net/i/u/300x300/e74c7701331564d8da84d30f12ea4447.png',
    artist: 'Glory',
    title: 'Like an Eagle',
    album: 'Danger in this Game',
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control':                'no-store',
    'Content-Type':                 'application/json; charset=utf-8',
  };
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...corsHeaders(), ...(init.headers || {}) },
  });
}

const ARTIST_DISPLAY_ALIASES = new Map([
  ['motleycrue', 'Mötley Crüe'],
]);

const MOJIBAKE_FIXES = [
  ['MÃ¶tley CrÃ¼e', 'Mötley Crüe'],
  ['Motley Crue', 'Mötley Crüe'],
  ['MotÃ¶rhead', 'Motörhead'],
  ['QueensrÃ¿che', 'Queensrÿche'],
  ['Blue Ã–yster Cult', 'Blue Öyster Cult'],
  ['â€”', '—'],
  ['â€“', '–'],
  ['â€™', '’'],
  ['â€œ', '“'],
  ['â€', '”'],
  ['Â ', ' '],
];

function stripDiacritics(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function compactArtistKey(str) {
  return stripDiacritics(str).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function repairQuestionMarkApostrophes(str) {
  return String(str || '')
    // ? immediately before a digit is a mangled decade apostrophe: Back To ?85 -> '85
    .replace(/\?(?=\d)/g, "'")
    .replace(/(^|[\s([{])\?([A-Za-z])(?=\s|$)/g, "$1'$2")
    .replace(/\b([A-Za-z])\?(?=\s+[A-Z])/g, "$1'")
    .replace(/([A-Za-z])\?([A-Za-z])/g, "$1'$2")
    .replace(/\b([A-Za-z]+in)\?(?=\s|$)/g, "$1'");
}

function repairMetadataText(str) {
  let out = String(str || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  for (const [bad, good] of MOJIBAKE_FIXES) out = out.split(bad).join(good);
  out = repairQuestionMarkApostrophes(out);
  return out.replace(/\s+/g, ' ');
}

function normalizeArtistDisplay(artist) {
  const repaired = repairMetadataText(artist);
  return ARTIST_DISPLAY_ALIASES.get(compactArtistKey(repaired)) || repaired;
}

function parseTrack(raw) {
  if (!raw || typeof raw !== 'string') return { artist: '', title: '' };
  const str = repairMetadataText(raw);
  const seps = [' - ', ' — ', ' – ', ' ‒ '];
  for (const sep of seps) {
    const idx = str.indexOf(sep);
    if (idx > 0) {
      return {
        artist: normalizeArtistDisplay(str.substring(0, idx)),
        title:  repairMetadataText(str.substring(idx + sep.length)),
      };
    }
  }
  return { artist: '', title: repairMetadataText(str) };
}

async function parseIcecastResponse(response) {
  const buf = await response.arrayBuffer();
  const encodings = ['utf-8', 'windows-1252', 'iso-8859-1'];
  let lastError = null;
  for (const encoding of encodings) {
    try {
      const decoder = encoding === 'utf-8'
        ? new TextDecoder(encoding, { fatal: true })
        : new TextDecoder(encoding);
      const text = decoder.decode(buf)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
      return JSON.parse(text);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('Unable to decode Icecast status');
}

async function readCurrentTrack() {
  const response = await fetch(`${STATUS_URL}?_=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'Accept': 'application/json' },
  });
  if (!response.ok) throw new Error(`Icecast status ${response.status}`);

  const payload = await parseIcecastResponse(response);
  const src = Array.isArray(payload?.icestats?.source)
    ? payload.icestats.source[0]
    : payload?.icestats?.source;
  if (!src) throw new Error('No stream source in status payload');

  const parsed = parseTrack(src.title || src.yp_currently_playing || '');
  const title = parsed.title || '';
  const artist = parsed.artist || '';
  if (!title && !artist) throw new Error('No track metadata in status payload');

  return {
    artist,
    title: title || 'Unknown',
    listeners: src.listeners ?? null,
    raw: src.title || src.yp_currently_playing || '',
    at: new Date().toISOString(),
  };
}

function recentCombo(track) {
  return `${track.artist || ''}|||${track.title || ''}`.toLowerCase();
}

// ── Recently played — D1-backed (table: recent_tracks) ───────────────────────
async function updateRecentTracks(env) {
  if (!env.RECENT_DB) return { ok: false, error: 'recent_db_not_bound' };

  const track = await readCurrentTrack();
  const combo = recentCombo(track);

  const last = await env.RECENT_DB
    .prepare('SELECT combo FROM recent_tracks ORDER BY played_at DESC LIMIT 1')
    .first();
  if (last?.combo === combo) {
    return { ok: true, changed: false, current: track };
  }

  await env.RECENT_DB
    .prepare(`INSERT INTO recent_tracks (combo, artist, title, listeners, raw, played_at)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6)
              ON CONFLICT(combo) DO UPDATE SET
                played_at = ?6, listeners = ?4, raw = ?5`)
    .bind(combo, track.artist, track.title, track.listeners, track.raw, track.at)
    .run();

  return { ok: true, changed: true, current: track };
}

async function handleRecent(env) {
  if (!env.RECENT_DB) {
    return json({ ok: false, error: 'recent_db_not_bound', recent: [] }, { status: 503 });
  }
  const rows = await env.RECENT_DB
    .prepare('SELECT artist, title, played_at FROM recent_tracks ORDER BY played_at DESC LIMIT ?1')
    .bind(RECENT_MAX)
    .all();
  const recent = (rows?.results || []).map(r => ({
    artist: r.artist,
    title:  r.title,
    at:     r.played_at,
  }));
  return json({ ok: true, recent });
}

async function handleRecentPoll(env) {
  try {
    const result = await updateRecentTracks(env);
    return json(result);
  } catch (error) {
    return json(
      { ok: false, error: 'recent_poll_failed', detail: String(error?.message || error) },
      { status: 502 }
    );
  }
}

// ── Instant manual art publish from /admin ───────────────────────────────────
// POST   {artist, title, url, album?, displayArtist?, displayTitle?} -> write
// POST   {artist, title, clear:true} or DELETE -> remove the manual override
// Auth: Authorization: Bearer <ADMIN_API_TOKEN>  (Worker secret)
async function handleOverride(request, env) {
  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
  }
  if (!env.ADMIN_API_TOKEN) {
    return json({ ok: false, error: 'override_not_configured' }, { status: 503 });
  }
  const auth = request.headers.get('Authorization') || '';
  if (auth !== `Bearer ${env.ADMIN_API_TOKEN}`) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'invalid_json' }, { status: 400 }); }

  const artist = String(body.artist || '').trim();
  const title  = String(body.title  || '').trim();
  if (!artist || !title) {
    return json({ ok: false, error: 'artist and title are required' }, { status: 400 });
  }
  const tKey = trackKey(artist, title);

  if (request.method === 'DELETE' || body.clear) {
    await env.ART_CACHE.delete(tKey);
    return json({ ok: true, cleared: true });
  }

  const artUrl = String(body.url || '').trim();
  if (!/^https:\/\//i.test(artUrl)) {
    return json(
      { ok: false, error: 'url must be a public https image URL (for uploaded files use Export manifest instead)' },
      { status: 400 }
    );
  }

  const stored = {
    url: artUrl,
    source: 'manual',
    artist,
    title,
    entry: {
      artist: String(body.displayArtist || '').trim() || artist,
      title:  String(body.displayTitle  || '').trim() || title,
      album:  String(body.album || '').trim(),
      art: artUrl,
    },
    checkedAt: new Date().toISOString(),
  };
  await env.ART_CACHE.put(tKey, JSON.stringify(stored)); // no TTL — permanent until cleared
  return json({ ok: true, ...stored, cache: 'kv-manual-write' });
}

// ── Guestbook — public, D1-backed (table: guestbook) ─────────────────────────
// GET    -> latest 50 entries
// POST   {name, location?, message, rating?, website(honeypot)} -> sign
// DELETE {id} + Bearer ADMIN_API_TOKEN -> remove an entry (moderation)
const GB_LIMIT = 50;
const GB_RATE_PER_HOUR = 3;

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleGuestbook(request, env) {
  if (!env.RECENT_DB) {
    return json({ ok: false, error: 'guestbook_db_not_bound' }, { status: 503 });
  }

  if (request.method === 'GET') {
    const rows = await env.RECENT_DB
      .prepare('SELECT id, name, location, message, rating, created_at FROM guestbook ORDER BY created_at DESC, id DESC LIMIT ?1')
      .bind(GB_LIMIT)
      .all();
    return json({ ok: true, entries: rows?.results || [] });
  }

  if (request.method === 'DELETE') {
    if (!env.ADMIN_API_TOKEN) return json({ ok: false, error: 'not_configured' }, { status: 503 });
    const auth = request.headers.get('Authorization') || '';
    if (auth !== `Bearer ${env.ADMIN_API_TOKEN}`) return json({ ok: false, error: 'unauthorized' }, { status: 401 });
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
    const id = Number(body.id);
    if (!Number.isInteger(id)) return json({ ok: false, error: 'id required' }, { status: 400 });
    await env.RECENT_DB.prepare('DELETE FROM guestbook WHERE id = ?1').bind(id).run();
    return json({ ok: true, deleted: id });
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'invalid_json' }, { status: 400 }); }

  // Honeypot filled -> pretend success, store nothing.
  if (String(body.website || '').trim()) return json({ ok: true });

  const name     = String(body.name     || '').trim().slice(0, 60);
  const location = String(body.location || '').trim().slice(0, 80);
  const message  = String(body.message  || '').trim().slice(0, 500);
  const rating   = String(body.rating   || '').trim().slice(0, 12);
  if (!name || !message) {
    return json({ ok: false, error: 'name and message are required' }, { status: 400 });
  }

  // Per-IP rate limit: max GB_RATE_PER_HOUR entries per rolling hour.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = (await sha256Hex(`m4m-gb|${ip}`)).slice(0, 32);
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentCount = await env.RECENT_DB
    .prepare('SELECT COUNT(*) AS n FROM guestbook WHERE ip_hash = ?1 AND created_at > ?2')
    .bind(ipHash, cutoff)
    .first();
  if ((recentCount?.n || 0) >= GB_RATE_PER_HOUR) {
    return json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const createdAt = new Date().toISOString();
  await env.RECENT_DB
    .prepare('INSERT INTO guestbook (name, location, message, rating, created_at, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(name, location, message, rating, createdAt, ipHash)
    .run();

  return json({ ok: true, entry: { name, location, message, rating, created_at: createdAt } });
}

function normalize(input) {
  return String(input || '')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bfeat\.?\b/gi, ' featuring ')
    .replace(/\bft\.?\b/gi, ' featuring ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function stripLiveInfo(input) {
  return normalize(input)
    .replace(/\s*\blive\b.*$/i, '')
    .replace(/\s*\bremaster(?:ed)?\b.*$/i, '')
    .replace(/\s*\b\d{4}\b.*$/i, '')
    .trim();
}

function stripDiscogsDisambiguation(input) {
  return String(input || '').replace(/\s+\(\d+\)$/g, '');
}

function trackKey(artist, title) {
  return `track:${normalize(artist)}|||${normalize(title)}`;
}

function overrideKey(artist, title) {
  return `${normalize(artist)}|||${normalize(title)}`;
}

// Compilations that hijack covers from the original album. Penalized in
// RANKING only (not the accept threshold), so a compilation still wins when
// it's genuinely the only source for a song.
const COMPILATION_RE = /\b(greatest hits|very best|best of|anthology|essential|the collection|collection|gold|the hits|hits|singles|ultimate|definitive|20th century masters|platinum|millennium collection|super hits|playlist)\b/i;

function isCompilation(result) {
  return COMPILATION_RE.test(result.collectionName || '')
    || normalize(result.collectionArtistName || '') === 'various artists';
}

function scoreCandidate(result, artist, title) {
  const a  = normalize(artist);
  const t  = normalize(title);
  const ts = stripLiveInfo(title);
  const ra = normalize(result.artistName || '');
  const rca = normalize(result.collectionArtistName || '');
  const rt = normalize(result.trackName || '');
  const rc = normalize(result.collectionName || '');

  let score = 0;
  if (ra === a || rca === a) score += 100;
  if (rt === t) score += 100;
  if (rc === t) score += 35;
  if (ts && rt === ts) score += 80;
  if (ts && rc === ts) score += 25;
  return score;
}

function resultArtistMatches(result, artist) {
  const expected = normalize(artist);
  return [
    result.artistName,
    result.collectionArtistName,
  ].map(normalize).filter(Boolean).some(candidate => candidate === expected);
}

function resultTitleMatches(result, title) {
  const expected = normalize(title);
  const simpleExpected = stripLiveInfo(title);
  return [
    result.trackName,
    result.collectionName,
  ].map(normalize).filter(Boolean).some(candidate =>
    candidate === expected || (simpleExpected && candidate === simpleExpected)
  );
}

function discogsArtistMatches(master, artist) {
  const expected = normalize(artist);
  const artists = Array.isArray(master?.artists) ? master.artists : [];
  return artists.some(item => normalize(stripDiscogsDisambiguation(item?.name)) === expected);
}

function discogsTrackMatches(master, title) {
  const expected = normalize(title);
  const simpleExpected = stripLiveInfo(title);
  const tracks = Array.isArray(master?.tracklist) ? master.tracklist : [];
  return tracks.some(item => {
    const candidate = normalize(item?.title || '');
    return candidate === expected || (simpleExpected && candidate === simpleExpected);
  });
}

function discogsMasterTitle(master) {
  return repairMetadataText(master?.title || '');
}

function pickDiscogsImage(master) {
  const images = Array.isArray(master?.images) ? master.images : [];
  const primary = images.find(img => img?.type === 'primary') || images[0];
  return primary?.uri || primary?.resource_url || primary?.uri150 || null;
}

function discogsHeaders(env) {
  const headers = {
    'Accept': 'application/json',
    'User-Agent': DISCOGS_USER_AGENT,
  };
  if (env.DISCOGS_TOKEN) {
    headers.Authorization = `Discogs token=${env.DISCOGS_TOKEN}`;
  }
  return headers;
}

async function fetchDiscogsJson(env, pathOrUrl) {
  const endpoint = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${DISCOGS_API_BASE}${pathOrUrl}`;
  const response = await fetch(endpoint, { headers: discogsHeaders(env) });
  if (!response.ok) return null;
  return response.json();
}

async function fetchDiscogsMaster(env, resourceUrl) {
  const master = await fetchDiscogsJson(env, resourceUrl);
  if (!master?.id) return null;
  return master;
}

async function searchDiscogsMaster(env, artist, title) {
  const searches = [
    new URLSearchParams({ artist, track: title, type: 'master', per_page: '5' }),
    new URLSearchParams({ q: `${artist} ${title}`, type: 'master', per_page: '5' }),
  ];

  for (const qs of searches) {
    const payload = await fetchDiscogsJson(env, `/database/search?${qs}`);
    const results = Array.isArray(payload?.results) ? payload.results : [];
    for (const result of results) {
      const resourceUrl = result.master_url || result.resource_url;
      if (!resourceUrl) continue;

      const master = await fetchDiscogsMaster(env, resourceUrl);
      if (!discogsArtistMatches(master, artist) || !discogsTrackMatches(master, title)) continue;

      const artUrl = pickDiscogsImage(master);
      if (!artUrl) continue;

      return {
        url: artUrl,
        source: 'discogs-master',
        entry: {
          artist: stripDiscogsDisambiguation(master.artists?.[0]?.name) || artist,
          title,
          album: discogsMasterTitle(master),
          art: artUrl,
          discogsUrl: master.uri || null,
          masterId: master.id,
        },
      };
    }
  }

  return null;
}

function cachedArtMatches(cached, artist, title) {
  if (!cached?.url) return false;
  if (cached.source === 'itunes-artist' || cached.source === 'itunes-artist-kv') return false;
  if (cached.source === 'manual') return true;

  const expectedArtist = normalize(artist);
  const expectedTitle = normalize(title);
  const expectedSimpleTitle = stripLiveInfo(title);
  const cachedArtist = normalize(cached.entry?.artist || cached.artist || '');
  const cachedTitle = normalize(cached.entry?.title || cached.title || '');
  const cachedAlbum = normalize(cached.entry?.album || '');

  const artistOk = cachedArtist === expectedArtist;
  const titleOk =
    cachedTitle === expectedTitle ||
    cachedAlbum === expectedTitle ||
    (expectedSimpleTitle && cachedTitle === expectedSimpleTitle) ||
    (expectedSimpleTitle && cachedAlbum === expectedSimpleTitle);

  return artistOk && titleOk;
}

function hiResArtwork(url) {
  if (!url) return null;
  return url
    .replace(/\/[0-9]+x[0-9]+bb(?=[.-])/i, '/1200x1200bb')
    .replace(/\/[0-9]+x[0-9]+(?=[.-])/i,   '/1200x1200');
}

function manualOverride(artist, title) {
  const override = ART_OVERRIDES[overrideKey(artist, title)];
  if (!override?.url) return null;
  return {
    url: override.url,
    source: 'manual',
    entry: {
      artist: override.artist || artist,
      title: override.title || title,
      album: override.album || '',
      art: override.url,
    },
  };
}

async function searchITunesTrack(artist, title) {
  const terms = [
    `${artist} ${title}`.trim(),
    `${artist} ${stripLiveInfo(title)}`.trim(),
  ].filter((term, index, arr) => term && arr.indexOf(term) === index);

  let best = null;

  for (const term of terms) {
    const qs = new URLSearchParams({ term, media: 'music', entity: 'song', limit: '10' });
    const response = await fetch(`https://itunes.apple.com/search?${qs}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) continue;

    const payload = await response.json();
    const results = Array.isArray(payload?.results) ? payload.results : [];
    for (const result of results) {
      const score = scoreCandidate(result, artist, title);
      // Ranking prefers original albums: compilations lose 60 rank points and
      // ties go to the earliest release (originals predate hits collections).
      const rank  = score - (isCompilation(result) ? 60 : 0);
      const released = Date.parse(result.releaseDate || '') || Infinity;
      const candidate = { result, score, rank, released };
      if (!best
        || candidate.rank > best.rank
        || (candidate.rank === best.rank && candidate.released < best.released)) {
        best = candidate;
      }
    }
  }

  if (
    !best ||
    best.score < 180 ||
    !resultArtistMatches(best.result, artist) ||
    !resultTitleMatches(best.result, title)
  ) {
    return null;
  }

  const artUrl = hiResArtwork(
    best.result.artworkUrl100 || best.result.artworkUrl60 || best.result.artworkUrl30
  );
  if (!artUrl) return null;

  return {
    url: artUrl,
    source: 'itunes-track',
    entry: {
      artist: best.result.artistName || artist,
      title: best.result.trackName || title,
      album: best.result.collectionName || '',
      art: artUrl,
      trackViewUrl: best.result.trackViewUrl || null,
      collectionViewUrl: best.result.collectionViewUrl || null,
    },
  };
}

async function handleResolve(_request, env, url) {
  const artist = (url.searchParams.get('artist') || '').trim();
  const title  = (url.searchParams.get('title')  || '').trim();

  if (!artist || !title) {
    return json({ ok: false, error: 'artist and title are required' }, { status: 400 });
  }

  const tKey = trackKey(artist, title);
  const override = manualOverride(artist, title);
  if (override) {
    const stored = { ...override, artist, title, checkedAt: new Date().toISOString() };
    return json({ ok: true, ...stored, cache: 'manual-override' });
  }

  const cached = await env.ART_CACHE.get(tKey, { type: 'json' });
  if (cached?.source === 'miss') {
    return json({ ok: false, ...cached, cache: 'kv-miss-hit' });
  }
  if (cached && cachedArtMatches(cached, artist, title)) {
    return json({ ok: !!cached.url, ...cached, cache: 'kv-hit' });
  }

  let resolved = null;

  try {
    resolved = await searchDiscogsMaster(env, artist, title);
    if (!resolved) resolved = await searchITunesTrack(artist, title);
  } catch (error) {
    return json(
      { ok: false, error: 'lookup_failed', detail: String(error?.message || error) },
      { status: 502 }
    );
  }

  if (!resolved) {
    const missPayload = {
      url: null,
      source: 'miss',
      artist,
      title,
      checkedAt: new Date().toISOString(),
    };
    if (LOW_KV_MODE) {
      return json({ ok: false, ...missPayload, cache: 'miss-no-kv-write' });
    }
    await env.ART_CACHE.put(tKey, JSON.stringify(missPayload), { expirationTtl: MISS_TTL_SECONDS });
    return json({ ok: false, ...missPayload, cache: cached ? 'kv-rejected-stored-miss' : 'kv-miss-stored' });
  }

  const stored = { ...resolved, artist, title, checkedAt: new Date().toISOString() };
  if (LOW_KV_MODE) {
    return json({ ok: true, ...stored, cache: 'resolved-no-kv-write' });
  }
  await env.ART_CACHE.put(tKey, JSON.stringify(stored), { expirationTtl: POSITIVE_TTL_SECONDS });
  return json({ ok: true, ...stored, cache: 'kv-write' });
}
