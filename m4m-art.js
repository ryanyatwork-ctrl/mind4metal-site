(function () {
  const VERSION = '1.1.0';
  const MANIFEST_CACHE_KEY = 'm4m_art_manifest_cache_v1';
  const RESOLVE_CACHE_KEY  = 'm4m_art_resolve_cache_v1';
  const MANIFEST_TTL_MS    = 6 * 60 * 60 * 1000; // 6 hours
  const RESOLVE_CACHE_LIMIT = 500;

  const state = {
    config: {
      manifestUrl:   'art-manifest.json',
      fallbackImage: null,
      cacheManifest: true,
    },
    manifest:        null,
    manifestLoadedAt: 0,
    initPromise:     null,
    memoryResolveCache: new Map(),
  };

  // Normalize artist/title for fuzzy matching.
  // - Strips diacritics (Mötley → Motley) via NFKD decomposition
  // - Normalizes curly/smart quotes to straight (Stompin' → Stompin')
  // - Strips all remaining punctuation so only alphanumeric tokens remain
  function normalize(input) {
    return String(input || '')
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // curly single quotes → '
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')   // curly double quotes → "
      .replace(/[\u2010-\u2015\u2212]/g, '-')        // various dashes → hyphen
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')               // strip combining diacritics
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function keyFor(artist, title) {
    return `${normalize(artist)}|||${normalize(title)}`;
  }

  function readJsonStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  function writeJsonStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function trimResolveCache(cacheObj) {
    const entries = Object.entries(cacheObj || {});
    if (entries.length <= RESOLVE_CACHE_LIMIT) return cacheObj;
    entries.sort((a, b) => (a[1]?.ts || 0) - (b[1]?.ts || 0));
    const trimmed = {};
    entries.slice(entries.length - RESOLVE_CACHE_LIMIT).forEach(([k, v]) => { trimmed[k] = v; });
    return trimmed;
  }

  function preloadImage(url) {
    if (!url) return;
    const img = new Image();
    img.decoding = 'async';
    img.loading  = 'eager';
    img.src      = url;
  }

  function buildManifestIndex(manifest) {
    const tracks  = new Map();
    const artists = new Map();
    const albums  = new Map();
    const trackEntries  = Array.isArray(manifest?.tracks)  ? manifest.tracks  : [];
    const artistEntries = Array.isArray(manifest?.artists) ? manifest.artists : [];
    const albumEntries  = Array.isArray(manifest?.albums)  ? manifest.albums  : [];

    trackEntries.forEach(entry => {
      const artistNames = [entry.artist, ...(entry.artistAliases || [])];
      const titleNames  = [entry.title,  ...(entry.titleAliases  || [])];
      artistNames.forEach(artist => {
        titleNames.forEach(title => {
          const k = keyFor(artist, title);
          if (artist && title && !tracks.has(k)) tracks.set(k, entry);
        });
      });
    });

    artistEntries.forEach(entry => {
      [entry.artist, ...(entry.artistAliases || [])].forEach(artist => {
        const k = normalize(artist);
        if (k && !artists.has(k)) artists.set(k, entry);
      });
    });

    albumEntries.forEach(entry => {
      [entry.album, ...(entry.albumAliases || [])].forEach(album => {
        const k = normalize(album);
        if (k && !albums.has(k)) albums.set(k, entry);
      });
    });

    return {
      generatedAt:   manifest?.generatedAt || null,
      imageBasePath: manifest?.imageBasePath || '',
      tracks,
      artists,
      albums,
    };
  }

  function absolutizeAssetPath(path) {
    if (!path) return null;
    if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;
    try { return new URL(path, window.location.href).href; } catch { return path; }
  }

  async function loadManifest() {
    const now    = Date.now();
    const cached = readJsonStorage(MANIFEST_CACHE_KEY, null);
    const canUseCached = state.config.cacheManifest
      && cached?.savedAt
      && (now - cached.savedAt) < MANIFEST_TTL_MS
      && cached.data;

    if (canUseCached) {
      state.manifest         = buildManifestIndex(cached.data);
      state.manifestLoadedAt = cached.savedAt;
      fetchManifest(true).catch(() => {}); // refresh in background
      return state.manifest;
    }
    return fetchManifest(false);
  }

  async function fetchManifest(background) {
    const response = await fetch(`${state.config.manifestUrl}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Manifest load failed: ${response.status}`);
    const json = await response.json();
    state.manifest         = buildManifestIndex(json);
    state.manifestLoadedAt = Date.now();
    if (state.config.cacheManifest) {
      writeJsonStorage(MANIFEST_CACHE_KEY, { savedAt: state.manifestLoadedAt, data: json });
    }
    return state.manifest;
  }

  async function init(config) {
    if (config && typeof config === 'object') {
      state.config = { ...state.config, ...config };
    }
    if (!state.initPromise) {
      state.initPromise = loadManifest().catch(err => {
        console.warn('[M4MArt] Manifest load failed:', err);
        state.initPromise = null;
        throw err;
      });
    }
    return state.initPromise;
  }

  function getResolveCache() {
    return readJsonStorage(RESOLVE_CACHE_KEY, {});
  }

  function setResolveCacheEntry(artist, title, payload) {
    const k        = keyFor(artist, title);
    const cacheObj = getResolveCache();
    cacheObj[k]    = { ...payload, ts: Date.now() };
    writeJsonStorage(RESOLVE_CACHE_KEY, trimResolveCache(cacheObj));
    state.memoryResolveCache.set(k, cacheObj[k]);
  }

  function getResolveCacheEntry(artist, title) {
    const k = keyFor(artist, title);
    if (state.memoryResolveCache.has(k)) return state.memoryResolveCache.get(k);
    const cacheObj = getResolveCache();
    const value    = cacheObj[k] || null;
    if (value) state.memoryResolveCache.set(k, value);
    return value;
  }

  function resolveFromManifest(artist, title, album) {
    const manifest = state.manifest;
    if (!manifest) return null;

    const directTrack = manifest.tracks.get(keyFor(artist, title));
    if (directTrack?.art) {
      return { url: absolutizeAssetPath(directTrack.art), source: 'manifest-track', entry: directTrack };
    }

    if (album) {
      const albumEntry = manifest.albums.get(normalize(album));
      if (albumEntry?.art) {
        return { url: absolutizeAssetPath(albumEntry.art), source: 'manifest-album', entry: albumEntry };
      }
    }

    const artistEntry = manifest.artists.get(normalize(artist));
    if (artistEntry?.art) {
      return { url: absolutizeAssetPath(artistEntry.art), source: 'manifest-artist', entry: artistEntry };
    }

    if (state.config.fallbackImage) {
      return { url: absolutizeAssetPath(state.config.fallbackImage), source: 'fallback-image', entry: null };
    }

    return null;
  }

  async function resolveArt(input) {
    const artist = input?.artist || '';
    const title  = input?.title  || '';
    const album  = input?.album  || '';

    // Always try init; it's a no-op if already loaded
    try { await init(); } catch {}

    const cached = getResolveCacheEntry(artist, title);
    if (cached) {
      if (cached.url) preloadImage(cached.url);
      return cached;
    }

    const resolved = resolveFromManifest(artist, title, album)
      || { url: null, source: 'miss', entry: null };

    setResolveCacheEntry(artist, title, resolved);
    if (resolved.url) preloadImage(resolved.url);
    return resolved;
  }

  function parseTrack(raw) {
    if (!raw) return { artist: '', title: '', raw: '' };
    const pieces = String(raw).split(' - ');
    if (pieces.length >= 2) {
      return { artist: pieces[0].trim(), title: pieces.slice(1).join(' - ').trim(), raw: String(raw) };
    }
    return { artist: '', title: String(raw).trim(), raw: String(raw) };
  }

  async function primeCache(entries) {
    try { await init(); } catch {}
    if (!Array.isArray(entries)) return [];
    const results = [];
    for (const entry of entries) {
      results.push(await resolveArt(entry || {}));
    }
    return results;
  }

  window.M4MArt = {
    version: VERSION,
    init,
    resolveArt,
    parseTrack,
    primeCache,
    normalize,
    keyFor,
  };
})();
