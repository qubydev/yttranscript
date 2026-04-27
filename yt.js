const RE_YOUTUBE = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)';
const RE_XML_TRANSCRIPT = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;

const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const INNERTUBE_CLIENT_VERSION = '20.10.38';
const INNERTUBE_CONTEXT = {
  client: {
    clientName: 'ANDROID',
    clientVersion: INNERTUBE_CLIENT_VERSION,
  },
};
const INNERTUBE_USER_AGENT = `com.google.android.youtube/${INNERTUBE_CLIENT_VERSION} (Linux; U; Android 14)`;

export class YoutubeTranscriptError extends Error {
  constructor(message) {
    super(`[YoutubeTranscript] 🚨 ${message}`);
  }
}

export class YoutubeTranscriptTooManyRequestError extends YoutubeTranscriptError {
  constructor() {
    super('YouTube is receiving too many requests from this IP and now requires solving a captcha to continue');
  }
}

export class YoutubeTranscriptVideoUnavailableError extends YoutubeTranscriptError {
  constructor(videoId) {
    super(`The video is no longer available (${videoId})`);
  }
}

export class YoutubeTranscriptDisabledError extends YoutubeTranscriptError {
  constructor(videoId) {
    super(`Transcript is disabled on this video (${videoId})`);
  }
}

export class YoutubeTranscriptNotAvailableError extends YoutubeTranscriptError {
  constructor(videoId) {
    super(`No transcripts are available for this video (${videoId})`);
  }
}

export class YoutubeTranscriptNotAvailableLanguageError extends YoutubeTranscriptError {
  constructor(lang, availableLangs, videoId) {
    super(`No transcripts are available in ${lang} this video (${videoId}). Available languages: ${availableLangs.join(', ')}`);
  }
}

export class YoutubeTranscript {
  static async fetchCaptionTracks(identifier, config) {
    try {
      const fetchFn = config?.fetch ?? fetch;
      const resp = await fetchFn(INNERTUBE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': INNERTUBE_USER_AGENT,
        },
        body: JSON.stringify({
          context: INNERTUBE_CONTEXT,
          videoId: identifier,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(captionTracks) && captionTracks.length > 0) {
          return captionTracks;
        }
      }
    } catch {
    }

    const fetchFn = config?.fetch ?? fetch;
    const videoPageResponse = await fetchFn(
      `https://www.youtube.com/watch?v=${identifier}`,
      {
        headers: {
          ...(config?.lang && { 'Accept-Language': config.lang }),
          'User-Agent': USER_AGENT,
        },
      },
    );
    const videoPageBody = await videoPageResponse.text();

    if (videoPageBody.includes('class="g-recaptcha"')) {
      throw new YoutubeTranscriptTooManyRequestError();
    }
    if (!videoPageBody.includes('"playabilityStatus":')) {
      throw new YoutubeTranscriptVideoUnavailableError(identifier);
    }

    const playerResponse = this.parseInlineJson(videoPageBody, 'ytInitialPlayerResponse');
    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
      throw new YoutubeTranscriptDisabledError(identifier);
    }

    return captionTracks;
  }

  static async listTranscripts(videoId, config) {
    const identifier = this.retrieveVideoId(videoId);
    const captionTracks = await this.fetchCaptionTracks(identifier, config);

    return captionTracks.map((track) => ({
      languageCode: track.languageCode,
      languageName: track.name?.simpleText || track.languageCode,
      kind: track.kind || 'standard',
      isTranslatable: track.isTranslatable,
    }));
  }

  static async fetchTranscript(videoId, config) {
    const identifier = this.retrieveVideoId(videoId);
    const captionTracks = await this.fetchCaptionTracks(identifier, config);
    return this.fetchTranscriptFromTracks(captionTracks, identifier, config);
  }

  static parseInlineJson(html, globalName) {
    const startToken = `var ${globalName} = `;
    const startIndex = html.indexOf(startToken);
    if (startIndex === -1) return null;

    const jsonStart = startIndex + startToken.length;
    let depth = 0;
    for (let i = jsonStart; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(jsonStart, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  static async fetchTranscriptFromTracks(captionTracks, videoId, config) {
    if (
      config?.lang &&
      !captionTracks.some((track) => track.languageCode === config?.lang)
    ) {
      throw new YoutubeTranscriptNotAvailableLanguageError(
        config?.lang,
        captionTracks.map((track) => track.languageCode),
        videoId,
      );
    }

    let track;
    if (config?.lang) {
      const targetKind = config?.kind || 'standard';
      track = captionTracks.find((t) => {
        const trackKind = t.kind || 'standard';
        return t.languageCode === config.lang && trackKind === targetKind;
      });

      if (!track && config?.kind) {
        throw new YoutubeTranscriptError(
          `No transcript found for language '${config.lang}' with kind '${config.kind}'`
        );
      } else if (!track) {
        track = captionTracks.find((t) => t.languageCode === config.lang);
      }
    } else {
      track = captionTracks[0];
    }

    const transcriptURL = track.baseUrl;

    try {
      const captionUrl = new URL(transcriptURL);
      if (!captionUrl.hostname.endsWith('.youtube.com')) {
        throw new YoutubeTranscriptNotAvailableError(videoId);
      }
    } catch (e) {
      if (e instanceof YoutubeTranscriptError) throw e;
      throw new YoutubeTranscriptNotAvailableError(videoId);
    }

    const fetchFn = config?.fetch ?? fetch;
    const transcriptResponse = await fetchFn(transcriptURL, {
      headers: {
        ...(config?.lang && { 'Accept-Language': config.lang }),
        'User-Agent': USER_AGENT,
      },
    });

    if (!transcriptResponse.ok) {
      throw new YoutubeTranscriptNotAvailableError(videoId);
    }
    const transcriptBody = await transcriptResponse.text();
    const lang = config?.lang ?? captionTracks[0].languageCode;

    return this.parseTranscriptXml(transcriptBody, lang);
  }

  static parseTranscriptXml(xml, lang) {
    const results = [];
    const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
    let match;

    while ((match = pRegex.exec(xml)) !== null) {
      const startMs = parseInt(match[1], 10);
      const durMs = parseInt(match[2], 10);
      const inner = match[3];

      let text = '';
      const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
      let sMatch;
      while ((sMatch = sRegex.exec(inner)) !== null) {
        text += sMatch[1];
      }
      if (!text) {
        text = inner.replace(/<[^>]+>/g, '');
      }
      text = this.decodeEntities(text).trim();

      if (text) {
        results.push({
          text,
          duration: durMs,
          offset: startMs,
          lang,
        });
      }
    }

    if (results.length > 0) return results;

    const classicResults = [...xml.matchAll(RE_XML_TRANSCRIPT)];
    return classicResults.map((result) => ({
      text: this.decodeEntities(result[3]),
      duration: parseFloat(result[2]),
      offset: parseFloat(result[1]),
      lang,
    }));
  }

  static decodeEntities(text) {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
        String.fromCodePoint(parseInt(hex, 16)),
      )
      .replace(/&#(\d+);/g, (_, dec) =>
        String.fromCodePoint(parseInt(dec, 10)),
      );
  }

  static retrieveVideoId(videoId) {
    if (videoId.length === 11) {
      return videoId;
    }
    const matchId = videoId.match(RE_YOUTUBE);
    if (matchId && matchId.length) {
      return matchId[1];
    }
    throw new YoutubeTranscriptError('Impossible to retrieve Youtube video ID.');
  }
}

export function fetchTranscript(videoId, config) {
  return YoutubeTranscript.fetchTranscript(videoId, config);
}

export function listTranscripts(videoId, config) {
  return YoutubeTranscript.listTranscripts(videoId, config);
}