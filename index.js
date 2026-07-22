const MODULE_NAME = 'AnimeUnity_ITA';
const BASE_URL = 'https://www.animeunity.so';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function log(message) {
  try {
    console.log('[' + MODULE_NAME + '] ' + String(message || ''));
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

      return {
        ok: !!(res && res.ok === true) || status === 200,
        status,
        body: textBody,
        headers: (res && res.headers) || {}
      };
    }

    if (typeof fetch === 'function') {
      const res = await fetch(url, { method, headers, body });
      const textBody = await res.text();
      return {
        ok: !!res.ok,
        status: Number(res.status || 0),
        body: textBody,
        headers: Object.fromEntries(res.headers.entries())
      };
    }

    return { ok: false, status: 0, body: '' };
  } catch (error) {
    log('request error: ' + (error && error.message ? error.message : String(error)));
    return { ok: false, status: 0, body: '' };
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
    const res = await request(embedUrl, {
      headers: {
        'Referer': BASE_URL + '/',
      }
    });

    if (!res.ok || !res.body) {
      log('VixcloudExtractor failed to load embedUrl: ' + embedUrl);
      return { streams: [] };
    }

    // Cerchiamo window.masterPlaylist.url oppure window.streams
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

  decodeHtml(text) {
    return String(text || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
  }

  extractVueData(html, attributeName) {
    const regex = new RegExp(`${attributeName}="([^"]+)"`, 'i');
    const match = html.match(regex);
    if (match && match[1]) {
      const decoded = this.decodeHtml(match[1]);
      return safeJsonParse(decoded);
    }
    return null;
  }

  async search(query, page = 1) {
    const term = String(query || '').trim();
    if (!term) {
      const res = await request(BASE_URL + '/');
      if (!res.ok) return [];
      
      const out = [];
      const pattern = /<a[^>]*href=['"]([^'"]+)['"][^>]*class="cover"[^>]*>[\s\S]*?<div[^>]*class="image"[^>]*style="background-image:\s*url\([^'"]*['"]([^'"]+)['"][^>]*\)[\s\S]*?<a[^>]*class="title"[^>]*>([^<]+)<\/a>/gi;
      let match;
      const seen = new Set();
      
      while ((match = pattern.exec(res.body)) !== null) {
        const url = match[1];
        if (seen.has(url)) continue;
        seen.add(url);
        
        out.push({
          url: url.startsWith('http') ? url : BASE_URL + url,
          image: match[2],
          title: match[3].trim()
        });
      }
      return out;
    }

    const res = await request(BASE_URL + '/ricerca?q=' + encodeURIComponent(term));
    if (!res.ok) return [];
    
    const records = this.extractVueData(res.body, 'records') || this.extractVueData(res.body, 'anime');
    
    if (records && Array.isArray(records.data)) {
        return records.data.map(item => ({
            url: BASE_URL + '/anime/' + item.id + '-' + item.slug,
            image: item.imageurl,
            title: item.title
        }));
    } else if (Array.isArray(records)) {
        return records.map(item => ({
            url: BASE_URL + '/anime/' + item.id + '-' + item.slug,
            image: item.imageurl,
            title: item.title
        }));
    }

    const out = [];
    const pattern = /<a[^>]*href=['"]([^'"]+)['"][^>]*class="cover"[^>]*>[\s\S]*?<div[^>]*class="image"[^>]*style="background-image:\s*url\([^'"]*['"]([^'"]+)['"][^>]*\)[\s\S]*?<a[^>]*class="title"[^>]*>([^<]+)<\/a>/gi;
    let match;
    const seen = new Set();
    while ((match = pattern.exec(res.body)) !== null) {
      const url = match[1];
      if (seen.has(url)) continue;
      seen.add(url);
      
      out.push({
        url: url.startsWith('http') ? url : BASE_URL + url,
        image: match[2],
        title: match[3].trim()
      });
    }
    return out;
  }

  async getDetails(idOrUrl) {
    const url = idOrUrl.startsWith('http') ? idOrUrl : BASE_URL + '/anime/' + idOrUrl;
    const res = await request(url);
    if (!res.ok || !res.body) return { title: 'Unknown' };

    const animeData = this.extractVueData(res.body, 'anime');
    if (animeData) {
      return {
        title: animeData.title_eng || animeData.title || animeData.title_it,
        description: animeData.plot || 'No description available.',
        image: animeData.imageurl_cover || animeData.imageurl || animeData.cover,
        airdate: animeData.date || 'Unknown'
      };
    }

    return { title: 'Unknown' };
  }

  async getEpisodes(idOrUrl) {
    const url = idOrUrl.startsWith('http') ? idOrUrl : BASE_URL + '/anime/' + idOrUrl;
    const res = await request(url);
    if (!res.ok || !res.body) return [];

    const episodesData = this.extractVueData(res.body, 'episodes');
    if (episodesData && Array.isArray(episodesData)) {
      return episodesData.map(ep => ({
        href: url + '/' + ep.id,
        number: Number(ep.number),
        title: `Episode ${ep.number}`,
        subAvailable: true,
        dubAvailable: false
      }));
    }

    return [];
  }

  async getStreamUrl(episodeUrl) {
    const url = episodeUrl.startsWith('http') ? episodeUrl : BASE_URL + episodeUrl;
    const res = await request(url);
    if (!res.ok || !res.body) return { streams: [] };

    const regex = /embed_url="([^"]+)"/i;
    const match = res.body.match(regex);
    
    if (match && match[1]) {
      let embedUrl = this.decodeHtml(match[1]);
      if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;
      return await this.extractor.extract(embedUrl);
    }
    
    return { streams: [] };
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