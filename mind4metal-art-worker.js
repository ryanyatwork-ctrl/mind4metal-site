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

const POSITIVE_TTL_SECONDS = 60 * 60 * 24 * 180;
const MISS_TTL_SECONDS = 60 * 60 * 24 * 3;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...corsHeaders(),
      ...(init.headers || {}),
    },
  });
}

function normalize(input) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bfeat\.?\b/g, ' featuring ')
    .replace(/\bft\.?\b/g, ' featuring ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function trackKey(artist, title) {
  return `track:${normalize(artist)}|||${normalize(title)}`;
}

function scoreCandidate(result, artist, title) {
  const a = normalize(artist);
  const t = normalize(title);
  const ra = normalize(result.artistName || '');
  const rt = normalize(result.trackName || result.collectionName || '');
  const rc = normalize(result.collectionName || '');

  let score = 0;
  if (ra === a) score += 60;
  if (rt === t) score += 100;
  if (rc === t) score += 20;
  if (ra.includes(a) || a.includes(ra)) score += 15;
  if (rt.includes(t) || t.includes(rt)) score += 15;
  return score;
}

function hiResArtwork(url) {
  if (!url) return null;
  return url
    .replace(/\/[0-9]+x[0-9]+bb(?=[.-])/i, '/1200x1200bb')
    .replace(/\/[0-9]+x[0-9]+(?=[.-])/i, '/1200x1200');
}

async function searchITunes(artist, title) {
  const term = `${artist} ${title}`.trim();
  const qs = new URLSearchParams({
    term,
    media: 'music',
    entity: 'song',
    limit: '10',
  });

  const response = await fetch(`https://itunes.apple.com/search?${qs.toString()}`, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) return null;
  const payload = await response.json();
  const results = Array.isArray(payload?.results) ? payload.results : [];
  if (!results.length) return null;

  const ranked = results
    .map((result) => ({ result, score: scoreCandidate(result, artist, title) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 110) return null;

  const artUrl = hiResArtwork(best.result.artworkUrl100 || best.result.artworkUrl60 || best.result.artworkUrl30);
  if (!artUrl) return null;

  return {
    url: artUrl,
    source: 'itunes-search',
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
  const artist = url.searchParams.get('artist') || '';
  const title = url.searchParams.get('title') || '';
  if (!artist || !title) {
    return json({ ok: false, error: 'artist and title are required' }, { status: 400 });
  }

  const key = trackKey(artist, title);
  const cached = await env.ART_CACHE.get(key, { type: 'json' });
  if (cached) {
    return json({ ok: !!cached.url, ...cached, cache: 'kv-hit' });
  }

  let resolved = null;

  try {
    resolved = await searchITunes(artist, title);
  } catch (error) {
    return json({ ok: false, error: 'lookup_failed', detail: String(error?.message || error) }, { status: 502 });
  }

  if (!resolved) {
    const missPayload = {
      url: null,
      source: 'miss',
      artist,
      title,
      checkedAt: new Date().toISOString(),
    };
    await env.ART_CACHE.put(key, JSON.stringify(missPayload), {
      expirationTtl: MISS_TTL_SECONDS,
    });
    return json({ ok: false, ...missPayload, cache: 'kv-miss-stored' });
  }

  const stored = {
    ...resolved,
    artist,
    title,
    checkedAt: new Date().toISOString(),
  };

  await env.ART_CACHE.put(key, JSON.stringify(stored), {
    expirationTtl: POSITIVE_TTL_SECONDS,
  });

  return json({ ok: true, ...stored, cache: 'kv-write' });
}
