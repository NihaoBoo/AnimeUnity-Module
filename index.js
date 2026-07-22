const MODULE_NAME = 'AnimeUnity_ITA';
const BASE_URL = 'https://www.animeunity.so';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function log(message) {
  try {
    console.log('[' + MODULE_NAME + '] ' + String(message || ''));
  } catch (_) {}
}

function logError(message, error) {
  try {
    const errStr = error && error.message ? error.message : String(error || '');
    console.error('[' + MODULE_NAME + ' ERROR] ' + String(message || '') + ': ' + errStr);
  } catch (_) {}
}

function safeJsonParse(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

async function request(url, options) {
  const cfg = options || {};
  const method = cfg.method || 'GET';
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': '*/*',
    'Referer': BASE_URL + '/',
    ...(cfg.headers || {}),
  };
  const body = cfg.body == null ? null : cfg.body;

  try {
    if (typeof fetchv2 === 'function') {
      const res = await fetchv2(url, headers, method, body);
      const status = Number((res && res.status) || 0);

      let textBody = '';
      if (res && typeof res.text === 'function') {
        try {
          textBody = await res.text();
        } catch (_) {
          textBody = '';
        }
      } else if (res && typeof res.body === 'string') {
        textBody = res.body;
      }

      const getHeader = (name) => {
        if (!res || !res.headers) return '';
        const keys = Object.keys(res.headers);
        const matchKey = keys.find(k => k.toLowerCase() === name.toLowerCase());
        return matchKey ? res.headers[matchKey] : '';
      };

      return {
        ok: !!(res && res.ok === true) || status === 200,
        status,
        body: textBody,
        headers: (res && res.headers) || {},
        getHeader
      };
    }

    if (typeof fetch === 'function') {
      const res = await fetch(url, { method, headers, body });
      const textBody = await res.text();
      return {
        ok: !!res.ok,
        status: Number(res.status || 0),
        body: textBody,
        headers: Object.fromEntries(res.headers.entries()),
        getHeader: (name) => res.headers.get(name) || ''
      };
    }

    return { ok: false, status: 0, body: '', headers: {}, getHeader: () => '' };
  } catch (error) {
    logError('Request failed for ' + url, error);
    return { ok: false, status: 0, body: '', headers: {}, getHeader: () => '' };
  }
}

// ==========================================
// SESSION & CSRF MANAGEMENT
// ==========================================
let cachedSession = null;

async function getSession() {
  if (cachedSession && (Date.now() - cachedSession.time < 300000)) {
    return cachedSession;
  }

  try {
    const res = await request(BASE_URL + '/archivio');
    if (!res.ok || !res.body) {
      log('Failed to fetch session from /archivio, using empty fallback');
      return { csrfToken: '', cookieHeader: '', time: 0 };
    }

    const csrfMatch = res.body.match(/name="csrf-token"\s+content="([^"]+)"/i);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    let cookieHeader = '';
    if (res.headers) {
      if (typeof res.headers.getSetCookie === 'function') {
        cookieHeader = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
      } else {
        const rawCookie = res.getHeader('set-cookie') || res.headers['set-cookie'] || '';
        if (Array.isArray(rawCookie)) {
          cookieHeader = rawCookie.map(c => c.split(';')[0]).join('; ');
        } else if (typeof rawCookie === 'string' && rawCookie) {
          cookieHeader = rawCookie.split(',').map(c => c.split(';')[0]).join('; ');
        }
      }
    }

    cachedSession = { csrfToken, cookieHeader, time: Date.now() };
    return cachedSession;
  } catch (e) {
    logError('getSession failed', e);
    return { csrfToken: '', cookieHeader: '', time: 0 };
  }
}

// ==========================================
// ARCHITECTURE: BASE PROVIDER
// ==========================================
class BaseProvider {
  async search(query, page) { throw new Error('Not implemented'); }
  async getDetails(id) { throw new Error('Not implemented'); }
  async getEpisodes(id) { throw new Error('Not implemented'); }
  async getStreamUrl(episodeId) { throw new Error('Not implemented'); }
}

// ==========================================
// ARCHITECTURE: EXTRACTOR
// ==========================================
class VixcloudExtractor {
  async extract(embedUrl) {
    try {
      const res = await request(embedUrl, {
        headers: {
          'Referer': BASE_URL + '/',
        }
      });

      if (!res.ok || !res.body) {
        log('VixcloudExtractor failed to load embedUrl: ' + embedUrl);
        return { streams: [] };
      }

      let streamUrl = '';
      const masterPlaylistMatch = res.body.match(/window\.masterPlaylist\s*=\s*{[^}]*url:\s*['"]([^'"]+)['"]/i);
      if (masterPlaylistMatch && masterPlaylistMatch[1]) {
        streamUrl = masterPlaylistMatch[1];
      } else {
        const streamsMatch = res.body.match(/window\.streams\s*=\s*(\[[^\]]+\])/i);
        if (streamsMatch && streamsMatch[1]) {
          const streams = safeJsonParse(streamsMatch[1]);
          if (Array.isArray(streams) && streams.length > 0) {
            const activeStream = streams.find(s => s.active) || streams[0];
            streamUrl = activeStream.url;
          }
        }
      }

      if (!streamUrl) {
        log('VixcloudExtractor could not find masterPlaylist or streams in HTML');
        return { streams: [] };
      }

      return {
        streams: ['Auto', streamUrl],
        headers: {
          'Referer': 'https://vixcloud.co/',
          'Origin': 'https://vixcloud.co',
          'User-Agent': USER_AGENT
        }
      };
    } catch (e) {
      logError('VixcloudExtractor failed', e);
      return { streams: [] };
    }
  }
}

// ==========================================
// ARCHITECTURE: TARGET SITE PROVIDER
// ==========================================
class AnimeUnityProvider extends BaseProvider {
  constructor() {
    super();
    this.extractor = new VixcloudExtractor();
  }

  extractVueData(html, attributeName) {
    try {
      const regex = new RegExp(`${attributeName}="([^"]+)"`, 'i');
      const match = html.match(regex);
      if (match && match[1]) {
        const decoded = decodeHtml(match[1]);
        return safeJsonParse(decoded);
      }
      return null;
    } catch (e) {
      logError('extractVueData failed for attribute: ' + attributeName, e);
      return null;
    }
  }

  mapAnimeItem(item) {
    if (!item || !item.id) return null;
    const id = item.id;
    const slug = item.slug || 'anime';
    const title = item.title_eng || item.title || item.title_it || (`Anime ${id}`);
    const image = item.imageurl || item.cover || item.imageurl_cover || '';
    const href = `${BASE_URL}/anime/${id}-${slug}`;

    return {
      href: href,
      id: href,
      title: title,
      image: image,
      poster: image,
      backdrop: image,
      backdropUrl: image
    };
  }

  async search(query, page = 1) {
    try {
      const q = String(query || '').trim();
      const isSearch = Boolean(q && q !== '<home>' && q !== '<browse-page>');
      const session = await getSession();

      const payload = JSON.stringify({
        title: isSearch ? q : false,
        type: false,
        year: false,
        order: 'popolarita',
        status: false,
        genres: [],
        offset: (Math.max(1, Number(page || 1)) - 1) * 30,
        dubbed: false,
        season: false
      });

      const res = await request(BASE_URL + '/archivio/get-animes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'X-CSRF-TOKEN': session.csrfToken,
          'X-Requested-With': 'XMLHttpRequest',
          'Cookie': session.cookieHeader,
          'Referer': BASE_URL + '/archivio'
        },
        body: payload
      });

      if (res.ok && res.body) {
        const json = safeJsonParse(res.body);
        const records = (json && Array.isArray(json.records)) ? json.records : [];
        const items = records.map(item => this.mapAnimeItem(item)).filter(Boolean);
        if (items.length > 0) return items;
      }

      // Fallback: Scrape HTML from /archivio if API call failed
      log('API call returned empty or failed, falling back to /archivio HTML parse');
      const archRes = await request(BASE_URL + '/archivio');
      if (archRes.ok && archRes.body) {
        const recordsData = this.extractVueData(archRes.body, 'records');
        if (Array.isArray(recordsData)) {
          let filtered = recordsData;
          if (isSearch) {
            const term = q.toLowerCase();
            filtered = recordsData.filter(item => {
              const name = (item.title || item.title_eng || item.title_it || '').toLowerCase();
              return name.includes(term);
            });
          }
          return filtered.map(item => this.mapAnimeItem(item)).filter(Boolean);
        }
      }

      return [];
    } catch (e) {
      logError('search failed', e);
      return [];
    }
  }

  async getDetails(idOrUrl) {
    try {
      const url = idOrUrl.startsWith('http') ? idOrUrl : `${BASE_URL}/anime/${idOrUrl}`;
      const res = await request(url);
      if (!res.ok || !res.body) return { title: 'Unknown', description: '' };

      const animeData = this.extractVueData(res.body, 'anime');
      if (animeData) {
        const title = animeData.title_eng || animeData.title || animeData.title_it || 'Unknown';
        const image = animeData.imageurl_cover || animeData.imageurl || animeData.cover || '';
        return {
          title: title,
          description: animeData.plot || 'No description available.',
          image: image,
          poster: image,
          backdrop: image,
          backdropUrl: image,
          airdate: animeData.date || 'Unknown'
        };
      }

      return { title: 'Unknown', description: '' };
    } catch (e) {
      logError('getDetails failed for ' + idOrUrl, e);
      return { title: 'Unknown', description: '' };
    }
  }

  async getEpisodes(idOrUrl) {
    try {
      const url = idOrUrl.startsWith('http') ? idOrUrl : `${BASE_URL}/anime/${idOrUrl}`;
      const res = await request(url);
      if (!res.ok || !res.body) return [];

      const episodesData = this.extractVueData(res.body, 'episodes');
      if (episodesData && Array.isArray(episodesData)) {
        return episodesData.map(ep => ({
          href: `${url}/${ep.id}`,
          number: Number(ep.number),
          title: `Episode ${ep.number}`,
          subAvailable: true,
          dubAvailable: false
        }));
      }

      return [];
    } catch (e) {
      logError('getEpisodes failed for ' + idOrUrl, e);
      return [];
    }
  }

  async getStreamUrl(episodeUrl) {
    try {
      const url = episodeUrl.startsWith('http') ? episodeUrl : `${BASE_URL}${episodeUrl}`;
      const res = await request(url);
      if (!res.ok || !res.body) return { streams: [] };

      const regex = /embed_url="([^"]+)"/i;
      const match = res.body.match(regex);

      if (match && match[1]) {
        let embedUrl = decodeHtml(match[1]);
        if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;
        return await this.extractor.extract(embedUrl);
      }

      return { streams: [] };
    } catch (e) {
      logError('getStreamUrl failed for ' + episodeUrl, e);
      return { streams: [] };
    }
  }
}

const provider = new AnimeUnityProvider();

async function searchResults(query, page) {
  return await provider.search(query, page);
}

async function extractDetails(id) {
  return await provider.getDetails(id);
}

async function extractEpisodes(id) {
  return await provider.getEpisodes(id);
}

async function extractChapters(id) {
  return await provider.getEpisodes(id);
}

async function extractStreamUrl(episodeId) {
  return await provider.getStreamUrl(episodeId);
}

async function extractResources(episodeId) {
  return await provider.getStreamUrl(episodeId);
}

globalThis.searchResults = searchResults;
globalThis.extractDetails = extractDetails;
globalThis.extractEpisodes = extractEpisodes;
globalThis.extractChapters = extractChapters;
globalThis.extractStreamUrl = extractStreamUrl;
globalThis.extractResources = extractResources;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    searchResults,
    extractDetails,
    extractEpisodes,
    extractChapters,
    extractStreamUrl,
    extractResources
  };
}