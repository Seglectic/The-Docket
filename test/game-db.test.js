const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FileStore } = require("../server/storage");
const { GameDatabaseService, buildIgdbImageUrl } = require("../server/game-db");

function createConfig(overrides = {}) {
  return {
    auth: { sharedSecret: "test" },
    wheel: { overlayTitle: "Test" },
    specialEntries: {},
    features: { manualMode: true, twitchEnabled: false },
    gameDatabase: {
      enabled: true,
      provider: "igdb",
      maxResults: 6,
      igdb: {
        clientId: "client-id",
        clientSecret: "client-secret",
        imageSize: "cover_big_2x",
      },
    },
    ...overrides,
  };
}

function setupStore(config = createConfig()) {
  const store = new FileStore(config);
  store.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docket-game-db-"));
  store.readSeedGames = () => [];
  store.ensure();
  return store;
}

test("buildIgdbImageUrl uses the requested size", () => {
  assert.equal(
    buildIgdbImageUrl("abc123", "cover_big_2x"),
    "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/abc123.jpg",
  );
});

test("searchGames returns cached suggestions on repeat queries", async () => {
  const config = createConfig();
  const store = setupStore(config);
  let calls = 0;
  const service = new GameDatabaseService(config, store, {
    now: () => 10_000,
    fetch: async (url) => {
      calls += 1;
      if (String(url).includes("oauth2/token")) {
        return {
          ok: true,
          json: async () => ({
            access_token: "token-123",
            expires_in: 3600,
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            id: 42,
            name: "Halo Infinite",
            slug: "halo-infinite",
            first_release_date: 1634601600,
            cover: { image_id: "cover42" },
          },
        ]),
      };
    },
  });

  const first = await service.searchGames("halo");
  const second = await service.searchGames("halo");

  assert.equal(first.suggestions[0].title, "Halo Infinite");
  assert.equal(second.cached, true);
  assert.equal(calls, 4);
});

test("searchGames prioritizes exact title matches over noisy partials", async () => {
  const config = createConfig();
  const store = setupStore(config);
  let gameSearchCalls = 0;
  const service = new GameDatabaseService(config, store, {
    now: () => 10_000,
    fetch: async (url) => {
      if (String(url).includes("oauth2/token")) {
        return {
          ok: true,
          json: async () => ({
            access_token: "token-123",
            expires_in: 3600,
          }),
        };
      }
      gameSearchCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () =>
          gameSearchCalls === 1
            ? [
                { id: 2, name: "Control", slug: "control", first_release_date: 1568851200, rating_count: 200 },
              ]
            : gameSearchCalls === 2
            ? [
                { id: 1, name: "Star Control", first_release_date: 536457600, rating_count: 40 },
                { id: 2, name: "Control", first_release_date: 1568851200, rating_count: 200 },
                { id: 3, name: "Flight Control", first_release_date: 1245369600, rating_count: 10 },
              ]
            : [
                { id: 3, name: "Flight Control", first_release_date: 1245369600, rating_count: 10 },
                { id: 2, name: "Control", first_release_date: 1568851200, rating_count: 200 },
              ],
      };
    },
  });

  const result = await service.searchGames("control");

  assert.equal(result.suggestions[0].title, "Control");
  assert.ok(result.suggestions.length >= 2);
});

test("searchGames reports disabled when IGDB credentials are absent", async () => {
  const config = createConfig({
    gameDatabase: {
      enabled: false,
      provider: "igdb",
      igdb: {
        clientId: "",
        clientSecret: "",
      },
    },
  });
  const store = setupStore(config);
  const service = new GameDatabaseService(config, store);

  const result = await service.searchGames("mario");
  assert.equal(result.enabled, false);
  assert.equal(result.suggestions.length, 0);
});

test("updateSettings persists runtime IGDB credentials", () => {
  const config = createConfig({
    gameDatabase: {
      enabled: false,
      provider: "igdb",
      maxResults: 5,
      igdb: {
        clientId: "",
        clientSecret: "",
        imageSize: "cover_big_2x",
      },
    },
  });
  const store = setupStore(config);
  const service = new GameDatabaseService(config, store);

  const updated = service.updateSettings({
    enabled: true,
    maxResults: 9,
    igdb: {
      clientId: "new-client",
      clientSecret: "new-secret",
    },
  });

  assert.equal(updated.enabled, true);
  assert.equal(updated.configured, true);
  assert.equal(store.readJson("gameDbSettings").igdb.clientId, "new-client");
  assert.equal(store.readJson("gameDbSettings").maxResults, 9);
});

test("falls back to twitch app credentials when dedicated IGDB credentials are blank", async () => {
  const config = createConfig({
    twitch: {
      app: {
        clientId: "shared-client",
        clientSecret: "shared-secret",
      },
    },
    gameDatabase: {
      enabled: true,
      provider: "igdb",
      maxResults: 6,
      igdb: {
        clientId: "",
        clientSecret: "",
        imageSize: "cover_big_2x",
      },
    },
  });
  const store = setupStore(config);
  const service = new GameDatabaseService(config, store, {
    now: () => 10_000,
    fetch: async (url, options) => {
      if (String(url).includes("oauth2/token")) {
        const body = String(options.body);
        assert.match(body, /client_id=shared-client/);
        assert.match(body, /client_secret=shared-secret/);
        return {
          ok: true,
          json: async () => ({
            access_token: "token-123",
            expires_in: 3600,
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => [],
      };
    },
  });

  const settings = service.publicSettings();
  assert.equal(settings.credentialSource, "twitchApp");
  assert.equal(settings.configured, true);

  await service.searchGames("halo");
});
