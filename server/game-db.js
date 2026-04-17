const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_GAMES_URL = "https://api.igdb.com/v4/games";
const IGDB_IMAGE_BASE = "https://images.igdb.com/igdb/image/upload";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;

class GameDatabaseService {
  constructor(config, store, options = {}) {
    this.config = config;
    this.store = store;
    this.fetchImpl = options.fetch || globalThis.fetch;
    this.now = options.now || (() => Date.now());
    this.token = null;
  }

  getSettings() {
    const configSettings = this.config.gameDatabase || {};
    const twitchApp = this.config.twitch?.app || {};
    const storedSettings = this.store.readJson("gameDbSettings");
    const settings = {
      ...configSettings,
      ...(storedSettings || {}),
      igdb: {
        ...(configSettings.igdb || {}),
        ...((storedSettings && storedSettings.igdb) || {}),
      },
    };
    return {
      enabled: settings.enabled !== false,
      provider: settings.provider || "igdb",
      maxResults: clampNumber(settings.maxResults, 8, 1, 20),
      igdb: {
        clientId: settings.igdb?.clientId || twitchApp.clientId || "",
        clientSecret: settings.igdb?.clientSecret || twitchApp.clientSecret || "",
        imageSize: settings.igdb?.imageSize || "cover_big_2x",
      },
      credentialSource:
        settings.igdb?.clientId || settings.igdb?.clientSecret ? "gameDatabase" : twitchApp.clientId && twitchApp.clientSecret ? "twitchApp" : "missing",
    };
  }

  status() {
    const settings = this.getSettings();
    return {
      enabled: settings.enabled,
      provider: settings.provider,
      configured: Boolean(settings.igdb.clientId && settings.igdb.clientSecret),
      credentialSource: settings.credentialSource,
    };
  }

  publicSettings() {
    const settings = this.getSettings();
    return {
      ...this.status(),
      maxResults: settings.maxResults,
      igdb: {
        clientId: settings.credentialSource === "gameDatabase" ? settings.igdb.clientId : "",
        clientSecret: settings.credentialSource === "gameDatabase" ? settings.igdb.clientSecret : "",
        imageSize: settings.igdb.imageSize,
      },
    };
  }

  updateSettings(input = {}) {
    const current = this.getSettings();
    const next = {
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : current.enabled,
      provider: input.provider || current.provider,
      maxResults: clampNumber(input.maxResults, current.maxResults, 1, 20),
      igdb: {
        clientId: input.igdb?.clientId !== undefined ? String(input.igdb.clientId || "").trim() : current.igdb.clientId,
        clientSecret:
          input.igdb?.clientSecret !== undefined ? String(input.igdb.clientSecret || "").trim() : current.igdb.clientSecret,
        imageSize: input.igdb?.imageSize || current.igdb.imageSize,
      },
    };
    this.store.writeJson("gameDbSettings", next);
    this.token = null;
    return this.publicSettings();
  }

  isConfigured() {
    const settings = this.getSettings();
    return Boolean(
      settings.enabled &&
      settings.provider === "igdb" &&
      settings.igdb.clientId &&
      settings.igdb.clientSecret &&
      this.fetchImpl,
    );
  }

  async searchGames(query) {
    const trimmed = String(query || "").trim();
    if (trimmed.length < 2) {
      return {
        ...this.status(),
        suggestions: [],
      };
    }

    if (!this.isConfigured()) {
      return {
        ...this.status(),
        suggestions: [],
        message: "Game lookup is disabled until IGDB credentials are configured.",
      };
    }

    const cache = this.readCache();
    const cacheKey = normalizeQuery(trimmed);
    const cached = cache.entries[cacheKey];
    if (cached && this.now() - cached.cachedAt < CACHE_TTL_MS) {
      return {
        ...this.status(),
        suggestions: cached.suggestions,
        cached: true,
      };
    }

    const token = await this.getAccessToken();
    const settings = this.getSettings();
    const body = [
      `search "${escapeApicalypse(trimmed)}";`,
      "fields name,slug,cover.image_id,first_release_date,category,version_parent;",
      "where version_parent = null;",
      `limit ${settings.maxResults};`,
    ].join(" ");

    let response = await this.fetchImpl(IGDB_GAMES_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Client-ID": settings.igdb.clientId,
        Authorization: `Bearer ${token}`,
      },
      body,
    });

    if (response.status === 401) {
      this.token = null;
      response = await this.fetchImpl(IGDB_GAMES_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Client-ID": settings.igdb.clientId,
          Authorization: `Bearer ${await this.getAccessToken()}`,
        },
        body,
      });
    }

    if (!response.ok) {
      const detail = await safeResponseText(response);
      throw new Error(`IGDB search failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }

    const payload = await response.json();
    const suggestions = payload.map((game) => this.formatGameSuggestion(game, settings.igdb.imageSize));
    cache.provider = settings.provider;
    cache.entries[cacheKey] = {
      cachedAt: this.now(),
      suggestions,
    };
    this.writeCache(cache);

    return {
      ...this.status(),
      suggestions,
      cached: false,
    };
  }

  formatGameSuggestion(game, imageSize) {
    return {
      id: String(game.id),
      title: game.name,
      slug: game.slug || "",
      cover: game.cover?.image_id ? buildIgdbImageUrl(game.cover.image_id, imageSize) : "",
      coverThumb: game.cover?.image_id ? buildIgdbImageUrl(game.cover.image_id, "cover_small_2x") : "",
      releaseYear: formatReleaseYear(game.first_release_date),
      source: "igdb",
    };
  }

  async getAccessToken() {
    if (this.token && this.token.expiresAt > this.now() + 30_000) {
      return this.token.accessToken;
    }

    const settings = this.getSettings();
    const body = new URLSearchParams({
      client_id: settings.igdb.clientId,
      client_secret: settings.igdb.clientSecret,
      grant_type: "client_credentials",
    });

    const response = await this.fetchImpl(TWITCH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!response.ok) {
      const detail = await safeResponseText(response);
      throw new Error(`Twitch token request failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }
    const payload = await response.json();
    this.token = {
      accessToken: payload.access_token,
      expiresAt: this.now() + (Number(payload.expires_in) * 1000 || 0),
    };
    return this.token.accessToken;
  }

  readCache() {
    const cache = this.store.readJson("gameDbCache");
    return {
      provider: cache.provider || null,
      entries: cache.entries || {},
    };
  }

  writeCache(cache) {
    const entries = Object.entries(cache.entries || {})
      .sort((a, b) => b[1].cachedAt - a[1].cachedAt)
      .slice(0, 150);
    this.store.writeJson("gameDbCache", {
      provider: cache.provider || null,
      entries: Object.fromEntries(entries),
    });
  }
}

function buildIgdbImageUrl(imageId, size) {
  return `${IGDB_IMAGE_BASE}/t_${size}/${imageId}.jpg`;
}

function escapeApicalypse(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function normalizeQuery(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function formatReleaseYear(timestamp) {
  if (!timestamp) {
    return null;
  }
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.getUTCFullYear();
}

async function safeResponseText(response) {
  try {
    return (await response.text()).trim().slice(0, 180);
  } catch (_) {
    return "";
  }
}

module.exports = {
  GameDatabaseService,
  buildIgdbImageUrl,
};
