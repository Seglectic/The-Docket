const crypto = require("node:crypto");

const TWITCH_AUTHORIZE_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const TWITCH_USERS_URL = "https://api.twitch.tv/helix/users";
const DEFAULT_SCOPE = "channel:read:redemptions";

class TwitchAuthService {
  constructor(config, store, options = {}) {
    this.config = config;
    this.store = store;
    this.fetchImpl = options.fetch || globalThis.fetch;
    this.now = options.now || (() => Date.now());
    this.pendingStates = new Map();
  }

  getSettings() {
    const twitch = this.config.twitch || {};
    const app = twitch.app || {};
    return {
      enabled: twitch.enabled !== false,
      broadcasterLogin: twitch.broadcasterLogin || "",
      clientId: app.clientId || "",
      clientSecret: app.clientSecret || "",
      redirectUri: app.redirectUri || "http://localhost:3030/auth/twitch/callback",
      scopes: parseScopes(twitch.scopes || DEFAULT_SCOPE),
    };
  }

  isConfigured() {
    const settings = this.getSettings();
    return Boolean(settings.clientId && settings.clientSecret && settings.redirectUri && this.fetchImpl);
  }

  getStoredAuth() {
    const stored = this.store.readJson("twitchAuth");
    return stored && typeof stored === "object" ? stored : { connected: false };
  }

  setStoredAuth(value) {
    this.store.writeJson("twitchAuth", value);
  }

  getStoredUserToken() {
    const stored = this.getStoredAuth();
    if (!stored.connected || !stored.token?.accessToken) {
      return null;
    }
    return stored;
  }

  getPublicState() {
    const settings = this.getSettings();
    const stored = this.getStoredAuth();
    return {
      enabled: settings.enabled,
      configured: this.isConfigured(),
      connected: Boolean(stored.connected && stored.user?.id),
      broadcasterLogin: stored.user?.login || settings.broadcasterLogin || "",
      displayName: stored.user?.displayName || "",
      userId: stored.user?.id || "",
      scopes: stored.scopes || settings.scopes,
      tokenExpiresAt: stored.token?.expiresAt || null,
      redirectUri: settings.redirectUri,
      lastConnectedAt: stored.connectedAt || null,
    };
  }

  startAuthorization(sessionToken) {
    if (!this.isConfigured()) {
      throw new Error("Twitch app credentials are not configured");
    }
    const settings = this.getSettings();
    const state = crypto.randomUUID();
    this.pendingStates.set(state, {
      sessionToken,
      createdAt: this.now(),
    });
    this.cleanupPendingStates();

    const params = new URLSearchParams({
      client_id: settings.clientId,
      redirect_uri: settings.redirectUri,
      response_type: "code",
      scope: settings.scopes.join(" "),
      force_verify: "false",
      state,
    });
    return `${TWITCH_AUTHORIZE_URL}?${params.toString()}`;
  }

  async completeAuthorization({ code, state }) {
    if (!code) {
      throw new Error("Missing OAuth code");
    }
    const pending = this.pendingStates.get(state);
    if (!pending) {
      throw new Error("Invalid or expired OAuth state");
    }
    this.pendingStates.delete(state);

    const settings = this.getSettings();
    const tokenPayload = await this.exchangeAuthorizationCode(code, settings);
    const validated = await this.validateAccessToken(tokenPayload.access_token);
    const user = await this.fetchUserProfile(tokenPayload.access_token, settings.clientId);

    const authRecord = {
      connected: true,
      connectedAt: new Date(this.now()).toISOString(),
      user: {
        id: user.id,
        login: user.login,
        displayName: user.display_name,
      },
      scopes: tokenPayload.scope || validated.scopes || settings.scopes,
      token: {
        accessToken: tokenPayload.access_token,
        refreshToken: tokenPayload.refresh_token || "",
        expiresAt: new Date(this.now() + Number(tokenPayload.expires_in || 0) * 1000).toISOString(),
        tokenType: tokenPayload.token_type || "bearer",
      },
    };
    this.setStoredAuth(authRecord);
    return authRecord;
  }

  async getValidUserAccessToken() {
    const stored = this.getStoredUserToken();
    if (!stored) {
      throw new Error("Twitch is not connected");
    }

    const expiresAt = Date.parse(stored.token.expiresAt || "");
    if (Number.isFinite(expiresAt) && expiresAt > this.now() + 60_000) {
      return stored.token.accessToken;
    }

    if (!stored.token.refreshToken) {
      return stored.token.accessToken;
    }

    const refreshed = await this.refreshUserToken(stored.token.refreshToken);
    const next = {
      ...stored,
      token: {
        ...stored.token,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token || stored.token.refreshToken,
        expiresAt: new Date(this.now() + Number(refreshed.expires_in || 0) * 1000).toISOString(),
        tokenType: refreshed.token_type || stored.token.tokenType || "bearer",
      },
      scopes: refreshed.scope || stored.scopes || this.getSettings().scopes,
    };
    this.setStoredAuth(next);
    return next.token.accessToken;
  }

  disconnect() {
    this.setStoredAuth({ connected: false });
    return this.getPublicState();
  }

  async exchangeAuthorizationCode(code, settings = this.getSettings()) {
    const body = new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: settings.redirectUri,
    });

    const response = await this.fetchImpl(TWITCH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Twitch token exchange failed (${response.status})`);
    }
    return response.json();
  }

  async refreshUserToken(refreshToken, settings = this.getSettings()) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
    });
    const response = await this.fetchImpl(TWITCH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Twitch token refresh failed (${response.status})`);
    }
    return response.json();
  }

  async validateAccessToken(accessToken) {
    const response = await this.fetchImpl(TWITCH_VALIDATE_URL, {
      method: "GET",
      headers: {
        Authorization: `OAuth ${accessToken}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Twitch token validation failed (${response.status})`);
    }
    return response.json();
  }

  async fetchUserProfile(accessToken, clientId) {
    const response = await this.fetchImpl(TWITCH_USERS_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": clientId,
      },
    });
    if (!response.ok) {
      throw new Error(`Unable to load Twitch user profile (${response.status})`);
    }
    const payload = await response.json();
    const user = payload.data?.[0];
    if (!user) {
      throw new Error("No Twitch user returned for authorized token");
    }
    return user;
  }

  cleanupPendingStates() {
    const cutoff = this.now() - 10 * 60 * 1000;
    for (const [key, value] of this.pendingStates.entries()) {
      if (value.createdAt < cutoff) {
        this.pendingStates.delete(key);
      }
    }
  }
}

function parseScopes(value) {
  return String(value || DEFAULT_SCOPE)
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

module.exports = {
  TwitchAuthService,
};
