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
      const fetchHeaders = { ...headers };
      delete fetchHeaders['User-Agent'];
      const res = await fetchv2(url, fetchHeaders, method, body);
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

      const html = res.body;
      const masterMatch = html.match(/window\.masterPlaylist\s*=\s*({[\s\S]*?});/i);
      let masterUrl = '';

      if (masterMatch) {
        const raw = masterMatch[1];
        const tokenMatch = raw.match(/'token':\s*'([^']+)'/);
        const expiresMatch = raw.match(/'expires':\s*'([^']+)'/);
        const urlMatch = raw.match(/url:\s*'([^']+)'/);
        const asnMatch = raw.match(/'asn':\s*'([^']*)'/);

        if (urlMatch && tokenMatch && expiresMatch) {
          const baseUrl = urlMatch[1];
          const token = tokenMatch[1];
          const expires = expiresMatch[1];
          const asn = asnMatch ? asnMatch[1] : '';
          masterUrl = `${baseUrl}?token=${token}&expires=${expires}&asn=${asn}&h=1`;
        }
      }

      if (!masterUrl) {
        log('VixcloudExtractor could not parse masterPlaylist from embed page');
        return { streams: [] };
      }

      const masterRes = await request(masterUrl, {
        headers: {
          'Referer': embedUrl,
          'User-Agent': USER_AGENT
        }
      });

      const streams = [];
      if (masterRes.ok && masterRes.body && masterRes.body.includes('#EXTM3U')) {
        const lines = masterRes.body.split('\n');
        let currentLabel = 'Auto';
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('#EXT-X-STREAM-INF:')) {
            const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
            if (resMatch) {
              currentLabel = `${resMatch[1]}p`;
            }
          } else if (line.startsWith('http')) {
            streams.push(currentLabel, line);
            currentLabel = 'Auto';
          }
        }
      }

      if (streams.length === 0) {
        streams.push('Auto', masterUrl);
      }

      return {
        streams: streams,
        headers: {
          'Referer': embedUrl,
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
      id: String(id),
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
      const searchUrl = isSearch ? `${BASE_URL}/archivio?title=${encodeURIComponent(q)}` : `${BASE_URL}/archivio`;
      const archRes = await request(searchUrl);
      if (archRes.ok && archRes.body) {
        const recordsData = this.extractVueData(archRes.body, 'records');
        if (Array.isArray(recordsData)) {
          return recordsData.map(item => this.mapAnimeItem(item)).filter(Boolean);
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
      const isDubbedAnime = url.toLowerCase().includes('-ita');
      if (episodesData && Array.isArray(episodesData)) {
        return episodesData.map(ep => {
          const fName = String(ep.file_name || ep.link || '').toLowerCase();
          const isDub = isDubbedAnime || fName.includes('ita');
          const isSub = !isDub || fName.includes('jpn') || fName.includes('jap') || fName.includes('sub');
          return {
            href: `${url}/${ep.id}`,
            number: Number(ep.number),
            title: `Episode ${ep.number}`,
            subAvailable: isSub,
            dubAvailable: isDub
          };
        });
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
