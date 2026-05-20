const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FileStore } = require("../server/storage");
const { TwitchAuthService } = require("../server/twitch-auth");

function createConfig(overrides = {}) {
  return {
    auth: { sharedSecret: "test" },
    twitch: {
      enabled: true,
      scopes: "channel:read:redemptions",
      app: {
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUri: "http://localhost:3030/auth/twitch/callback",
      },
    },
    wheel: { overlayTitle: "Test" },
    specialEntries: {},
    features: { manualMode: true, twitchEnabled: false },
    ...overrides,
  };
}

function setupStore(config = createConfig()) {
  const store = new FileStore(config);
  store.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docket-twitch-auth-"));
  store.readSeedGames = () => [];
  store.ensure();
  return store;
}

test("startAuthorization builds Twitch authorize URL with configured redirect", () => {
  const config = createConfig();
  const store = setupStore(config);
  const service = new TwitchAuthService(config, store);

  const authorizeUrl = service.startAuthorization("session-token");
  const url = new URL(authorizeUrl);

  assert.equal(url.origin + url.pathname, "https://id.twitch.tv/oauth2/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3030/auth/twitch/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "channel:read:redemptions");
  assert.ok(url.searchParams.get("state"));
});

test("completeAuthorization stores streamer token and profile locally", async () => {
  const config = createConfig();
  const store = setupStore(config);
  const responses = new Map([
    ["https://id.twitch.tv/oauth2/token", { ok: true, json: async () => ({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      scope: ["channel:read:redemptions"],
      token_type: "bearer",
    }) }],
    ["https://id.twitch.tv/oauth2/validate", { ok: true, json: async () => ({
      client_id: "client-id",
      login: "seglectic",
      user_id: "1234",
      scopes: ["channel:read:redemptions"],
    }) }],
    ["https://api.twitch.tv/helix/users", { ok: true, json: async () => ({
      data: [{ id: "1234", login: "seglectic", display_name: "Seglectic" }],
    }) }],
  ]);

  const service = new TwitchAuthService(config, store, {
    now: () => 1_000_000,
    fetch: async (url) => {
      const response = responses.get(String(url));
      if (!response) {
        throw new Error(`Unexpected fetch: ${url}`);
      }
      return response;
    },
  });

  const authorizeUrl = service.startAuthorization("session-token");
  const state = new URL(authorizeUrl).searchParams.get("state");
  const stored = await service.completeAuthorization({
    code: "oauth-code",
    state,
  });

  assert.equal(stored.connected, true);
  assert.equal(stored.user.login, "seglectic");
  assert.equal(store.readJson("twitchAuth").token.refreshToken, "refresh-token");
});

test("disconnect clears stored Twitch authorization", () => {
  const config = createConfig();
  const store = setupStore(config);
  const service = new TwitchAuthService(config, store);
  store.writeJson("twitchAuth", {
    connected: true,
    user: { id: "1", login: "seglectic", displayName: "Seglectic" },
    token: { accessToken: "a" },
  });

  const result = service.disconnect();
  assert.equal(result.connected, false);
  assert.equal(store.readJson("twitchAuth").connected, false);
});
