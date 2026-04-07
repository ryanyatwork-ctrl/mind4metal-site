export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === '/api/art/resolve') {
      return handleResolve(request, env, url);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404, headers: corsHeaders() });
  },
};

const POSITIVE_TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days
const MISS_TTL_SECONDS     = 60 * 60 * 24 * 3;   // 3 days

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

// Normalize for fuzzy matching — strips diacritics, punctuation, feat. variants
function normalize(input) {
  return String(input || '')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // curly single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // curly double quotes
    .replace(/[\u2010-\u2015\u2212]/g, '-')       // dashes → hyphen
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')              // strip diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bfeat\.?\b/gi, ' featuring ')
    .replace(/\bft\.?\b/gi,   ' featuring ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function trackKey(artist, title) {
  return `track:${normalize(artist)}|||${normalize(title)}`;
}

function artistKey(artist) {
  return `artist:${normalize(artist)}`;
}

function scoreCandidate(result, artist, title) {
  const a  = normalize(artist);
  const t  = normalize(title);
  const ra = normalize(result.artistName || '');
  const rt = normalize(result.trackName  || result.collectionName || '');
  const rc = normalize(result.collectionName || '');

  let score = 0;
  if (ra === a)  score += 60;
  if (rt === t)  score += 100;
  if (rc === t)  score += 20;
  if (ra.includes(a) || a.includes(ra)) score += 15;
  if (rt.includes(t) || t.includes(rt)) score += 15;
  return score;
}

function hiResArtwork(url) {
  if (!url) return null;
  return url
    .replace(/\/[0-9]+x[0-9]+bb(?=[.-])/i, '/1200x1200bb')
    .replace(/\/[0-9]+x[0-9]+(?=[.-])/i,   '/1200x1200');
}

// Search iTunes for a specific track
async function searchITunesTrack(artist, title) {
  const term = `${artist} ${title}`.trim();
  const qs   = new URLSearchParams({ term, media: 'music', entity: 'song', limit: '10' });

  const response = await fetch(`https://itunes.apple.com/search?${qs}`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!response.ok) return null;

  const payload = await response.json();
  const results = Array.isArray(payload?.results) ? payload.results : [];
  if (!results.length) return null;

  const ranked = results
    .map(r => ({ result: r, score: scoreCandidate(r, artist, title) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  // Require at minimum a strong title match + some artist signal
  if (!best || best.score < 110) return null;

  const artUrl = hiResArtwork(
    best.result.artworkUrl100 || best.result.artworkUrl60 || best.result.artworkUrl30
  );
  if (!artUrl) return null;

  return {
    url:    artUrl,
    source: 'itunes-track',
    entry:  {
      artist:          best.result.artistName    || artist,
      title:           best.result.trackName     || title,
      album:           best.result.collectionName || '',
      art:             artUrl,
      trackViewUrl:    best.result.trackViewUrl      || null,
      collectionViewUrl: best.result.collectionViewUrl || null,
    },
  };
}

// Fallback: search iTunes for artist image when track search misses
async function searchITunesArtist(artist) {
  const qs = new URLSearchParams({ term: artist, media: 'music', entity: 'musicArtist', limit: '5' });

  const response = await fetch(`https://itunes.apple.com/search?${qs}`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!response.ok) return null;

  const payload = await response.json();
  const results = Array.isArray(payload?.results) ? payload.results : [];
  if (!results.length) return null;

  const na    = normalize(artist);
  const match = results.find(r => normalize(r.artistName || '') === na) || results[0];
  if (!match) return null;

  // For artist search, artworkUrl100 comes from a representative album, not the artist directly.
  // We do a song search for this artist to grab artwork.
  const songQs = new URLSearchParams({ term: artist, media: 'music', entity: 'song', limit: '5' });
  const songRes = await fetch(`https://itunes.apple.com/search?${songQs}`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!songRes.ok) return null;

  const songPayload = await songRes.json();
  const songs = Array.isArray(songPayload?.results) ? songPayload.results : [];
  const bestSong = songs.find(s => normalize(s.artistName || '') === na) || songs[0];
  if (!bestSong) return null;

  const artUrl = hiResArtwork(bestSong.artworkUrl100 || bestSong.artworkUrl60);
  if (!artUrl) return null;

  return {
    url:    artUrl,
    source: 'itunes-artist',
    entry:  {
      artist: match.artistName || artist,
      title:  '',
      album:  '',
      art:    artUrl,
    },
  };
}

async function handleResolve(_request, env, url) {
  const artist = (url.searchParams.get('artist') || '').trim();
  const title  = (url.searchParams.get('title')  || '').trim();

  if (!artist || !title) {
    return json({ ok: false, error: 'artist and title are required' }, { status: 400 });
  }

  const tKey  = trackKey(artist, title);
  const aKey  = artistKey(artist);

  // Check KV for track-level cache hit
  const cached = await env.ART_CACHE.get(tKey, { type: 'json' });
  if (cached) {
    return json({ ok: !!cached.url, ...cached, cache: 'kv-hit' });
  }

  let resolved = null;

  try {
    // 1. Try exact track match via iTunes
    resolved = await searchITunesTrack(artist, title);

    // 2. Fall back to artist-level image if track miss
    if (!resolved) {
      // Check KV for a previously cached artist result
      const artistCached = await env.ART_CACHE.get(aKey, { type: 'json' });
      if (artistCached?.url) {
        resolved = { ...artistCached, source: 'itunes-artist-kv' };
      } else {
        resolved = await searchITunesArtist(artist);
        if (resolved) {
          // Cache artist result separately (shorter TTL since track art is preferred)
          const artistStored = { ...resolved, artist, checkedAt: new Date().toISOString() };
          await env.ART_CACHE.put(aKey, JSON.stringify(artistStored), {
            expirationTtl: 60 * 60 * 24 * 30, // 30 days for artist fallback
          });
        }
      }
    }
  } catch (error) {
    return json(
      { ok: false, error: 'lookup_failed', detail: String(error?.message || error) },
      { status: 502 }
    );
  }

  if (!resolved) {
    const missPayload = {
      url:        null,
      source:     'miss',
      artist,
      title,
      checkedAt:  new Date().toISOString(),
    };
    await env.ART_CACHE.put(tKey, JSON.stringify(missPayload), { expirationTtl: MISS_TTL_SECONDS });
    return json({ ok: false, ...missPayload, cache: 'kv-miss-stored' });
  }

  const stored = { ...resolved, artist, title, checkedAt: new Date().toISOString() };
  await env.ART_CACHE.put(tKey, JSON.stringify(stored), { expirationTtl: POSITIVE_TTL_SECONDS });
  return json({ ok: true, ...stored, cache: 'kv-write' });
}
