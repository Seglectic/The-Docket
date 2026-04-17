const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { createRouter } = require("../server/router");
const { AuthManager } = require("../server/auth");
const { DocketState } = require("../server/state");
const { FileStore } = require("../server/storage");

function createConfig() {
  return {
    auth: { sharedSecret: "test-secret" },
    twitch: {
      enabled: true,
      scopes: "channel:read:redemptions",
      app: {
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUri: "http://localhost:3030/auth/twitch/callback",
      },
    },
    wheel: { countdownSeconds: 1, spinDurationMs: 10, revealDurationMs: 10, overlayTitle: "Test" },
    features: { manualMode: true, twitchEnabled: false },
    specialEntries: {
      viewersChoice: { enabled: true, label: "Viewers Choice", baseWeight: 2, wheelScope: "out" },
      lockItIn: { enabled: true, label: "Lock It In", baseWeight: 2, wheelScope: "in" },
    },
    rewards: {},
    assets: {},
  };
}

async function createState() {
  const config = createConfig();
  const store = new FileStore(config);
  store.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docket-router-"));
  store.readSeedGames = () => [];
  const state = new DocketState(store, config, { random: () => 0.1 });
  await state.bootstrap();
  return { state, config };
}

function createGameDatabaseStub(overrides = {}) {
  return {
    searchGames: async (query) => ({
      enabled: true,
      configured: true,
      provider: "igdb",
      suggestions: [
        {
          id: "123",
          title: `Matched ${query}`,
          cover: "https://images.example/test.jpg",
          coverThumb: "https://images.example/test-thumb.jpg",
          releaseYear: 2024,
          source: "igdb",
        },
      ],
      ...overrides,
    }),
  };
}

function createTwitchAuthStub(overrides = {}) {
  return {
    getPublicState: () => ({
      configured: true,
      connected: false,
      scopes: ["channel:read:redemptions"],
      redirectUri: "http://localhost:3030/auth/twitch/callback",
    }),
    startAuthorization: () => "https://id.twitch.tv/oauth2/authorize?client_id=client-id",
    completeAuthorization: async () => ({
      connected: true,
    }),
    disconnect: () => ({
      connected: false,
    }),
    ...overrides,
  };
}

function createMockResponse() {
  let resolveResponse;
  const done = new Promise((resolve) => {
    resolveResponse = resolve;
  });

  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(headers)) {
        this.headers[name] = value;
      }
    },
    end(body = "") {
      this.body = body;
      resolveResponse({
        statusCode: this.statusCode,
        headers: this.headers,
        body: this.body,
      });
    },
  };

  return { response, done };
}

async function runRoute(route, { method, url, headers = {}, body }) {
  const payload = body ? JSON.stringify(body) : null;
  const req = Readable.from(payload ? [payload] : []);
  req.method = method;
  req.url = url;
  req.headers = {
    host: "localhost:3030",
    ...headers,
  };

  const { response, done } = createMockResponse();
  await route(req, response);
  return done;
}

test("POST /api/queue/test requires auth", async () => {
  const { state, config } = await createState();
  const route = createRouter({
    rootDir: process.cwd(),
    auth: new AuthManager(config),
    state,
    gameDatabase: createGameDatabaseStub(),
    twitchAuth: createTwitchAuthStub(),
    buildAdminState: () => ({ ...state.controllerSnapshot(), twitch: createTwitchAuthStub().getPublicState() }),
    broadcaster: () => {},
  });

  const response = await runRoute(route, {
    method: "POST",
    url: "/api/queue/test",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).error, "Unauthorized");
});

test("POST /api/queue/test enqueues a generated redeem when authenticated", async () => {
  const { state, config } = await createState();
  const auth = new AuthManager(config);
  const route = createRouter({
    rootDir: process.cwd(),
    auth,
    state,
    gameDatabase: createGameDatabaseStub(),
    twitchAuth: createTwitchAuthStub(),
    buildAdminState: () => ({ ...state.controllerSnapshot(), twitch: createTwitchAuthStub().getPublicState() }),
    broadcaster: () => {},
  });

  const login = await runRoute(route, {
    method: "POST",
    url: "/api/login",
    headers: {
      "content-type": "application/json",
    },
    body: { secret: "test-secret" },
  });
  const cookie = login.headers["Set-Cookie"] || login.headers["set-cookie"];

  const response = await runRoute(route, {
    method: "POST",
    url: "/api/queue/test",
    headers: {
      cookie,
    },
  });

  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 201);
  assert.equal(body.source, "test");
  assert(["restore", "eliminate"].includes(body.actionType));
  assert.equal(state.getQueue().length, 1);
});

test("POST /api/wheel-config persists physics slider settings when authenticated", async () => {
  const { state, config } = await createState();
  const auth = new AuthManager(config);
  const route = createRouter({
    rootDir: process.cwd(),
    auth,
    state,
    gameDatabase: createGameDatabaseStub(),
    twitchAuth: createTwitchAuthStub(),
    buildAdminState: () => ({ ...state.controllerSnapshot(), twitch: createTwitchAuthStub().getPublicState() }),
    broadcaster: () => {},
  });

  const login = await runRoute(route, {
    method: "POST",
    url: "/api/login",
    headers: {
      "content-type": "application/json",
    },
    body: { secret: "test-secret" },
  });
  const cookie = login.headers["Set-Cookie"] || login.headers["set-cookie"];

  const response = await runRoute(route, {
    method: "POST",
    url: "/api/wheel-config",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: {
      physics: {
        wheelMass: 1.6,
        launchForce: 1.8,
        drag: 0.15,
        brakeStrength: 1.2,
        minCruiseMs: 4500,
        revealDelayMs: 1400,
      },
    },
  });

  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.physics.wheelMass, 1.6);
  assert.equal(body.timings.cruiseMs, 4500);
  assert(body.spinDurationMs > 4500);
});

test("GET /api/game-db/search requires auth", async () => {
  const { state, config } = await createState();
  const route = createRouter({
    rootDir: process.cwd(),
    auth: new AuthManager(config),
    state,
    gameDatabase: createGameDatabaseStub(),
    twitchAuth: createTwitchAuthStub(),
    buildAdminState: () => ({ ...state.controllerSnapshot(), twitch: createTwitchAuthStub().getPublicState() }),
    broadcaster: () => {},
  });

  const response = await runRoute(route, {
    method: "GET",
    url: "/api/game-db/search?q=halo",
  });

  assert.equal(response.statusCode, 401);
});

test("GET /api/game-db/search returns suggestions when authenticated", async () => {
  const { state, config } = await createState();
  const auth = new AuthManager(config);
  const route = createRouter({
    rootDir: process.cwd(),
    auth,
    state,
    gameDatabase: createGameDatabaseStub(),
    twitchAuth: createTwitchAuthStub(),
    buildAdminState: () => ({ ...state.controllerSnapshot(), twitch: createTwitchAuthStub().getPublicState() }),
    broadcaster: () => {},
  });

  const login = await runRoute(route, {
    method: "POST",
    url: "/api/login",
    headers: {
      "content-type": "application/json",
    },
    body: { secret: "test-secret" },
  });
  const cookie = login.headers["Set-Cookie"] || login.headers["set-cookie"];

  const response = await runRoute(route, {
    method: "GET",
    url: "/api/game-db/search?q=halo",
    headers: {
      cookie,
    },
  });

  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.provider, "igdb");
  assert.equal(body.suggestions[0].title, "Matched halo");
});

test("POST /api/game-db/settings persists IGDB credentials when authenticated", async () => {
  const { state, config } = await createState();
  const auth = new AuthManager(config);
  const gameDatabase = {
    publicSettings: () => ({
      enabled: true,
      configured: true,
      provider: "igdb",
      maxResults: 8,
      igdb: { clientId: "saved-client", clientSecret: "saved-secret", imageSize: "cover_big_2x" },
    }),
    updateSettings: (body) => ({
      enabled: body.enabled,
      configured: true,
      provider: "igdb",
      maxResults: body.maxResults,
      igdb: { clientId: body.igdb.clientId, clientSecret: body.igdb.clientSecret, imageSize: "cover_big_2x" },
    }),
    searchGames: createGameDatabaseStub().searchGames,
  };
  const route = createRouter({
    rootDir: process.cwd(),
    auth,
    state,
    gameDatabase,
    twitchAuth: createTwitchAuthStub(),
    buildAdminState: () => ({
      ...state.controllerSnapshot(),
      gameDatabase: gameDatabase.publicSettings(),
      twitch: createTwitchAuthStub().getPublicState(),
    }),
    broadcaster: () => {},
  });

  const login = await runRoute(route, {
    method: "POST",
    url: "/api/login",
    headers: {
      "content-type": "application/json",
    },
    body: { secret: "test-secret" },
  });
  const cookie = login.headers["Set-Cookie"] || login.headers["set-cookie"];

  const response = await runRoute(route, {
    method: "POST",
    url: "/api/game-db/settings",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: {
      enabled: true,
      maxResults: 10,
      igdb: {
        clientId: "saved-client",
        clientSecret: "saved-secret",
      },
    },
  });

  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.configured, true);
  assert.equal(body.igdb.clientId, "saved-client");
  assert.equal(body.maxResults, 10);
});

test("GET /auth/twitch/start redirects to Twitch authorize when authenticated", async () => {
  const { state, config } = await createState();
  const auth = new AuthManager(config);
  const route = createRouter({
    rootDir: process.cwd(),
    auth,
    state,
    gameDatabase: createGameDatabaseStub(),
    twitchAuth: createTwitchAuthStub(),
    buildAdminState: () => ({ ...state.controllerSnapshot(), twitch: createTwitchAuthStub().getPublicState() }),
    broadcaster: () => {},
  });

  const login = await runRoute(route, {
    method: "POST",
    url: "/api/login",
    headers: {
      "content-type": "application/json",
    },
    body: { secret: "test-secret" },
  });
  const cookie = login.headers["Set-Cookie"] || login.headers["set-cookie"];

  const response = await runRoute(route, {
    method: "GET",
    url: "/auth/twitch/start",
    headers: { cookie },
  });

  assert.equal(response.statusCode, 302);
  assert.match(response.headers.Location || response.headers.location, /^https:\/\/id\.twitch\.tv\/oauth2\/authorize/);
});

test("GET /auth/twitch/callback redirects back to controller on success", async () => {
  const { state, config } = await createState();
  const route = createRouter({
    rootDir: process.cwd(),
    auth: new AuthManager(config),
    state,
    gameDatabase: createGameDatabaseStub(),
    twitchAuth: createTwitchAuthStub(),
    buildAdminState: () => ({ ...state.controllerSnapshot(), twitch: createTwitchAuthStub().getPublicState() }),
    broadcaster: () => {},
  });

  const response = await runRoute(route, {
    method: "GET",
    url: "/auth/twitch/callback?code=test-code&state=test-state",
  });

  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.Location || response.headers.location, "/controller?twitch=connected");
});

test("POST /api/games stores remote cover URLs as-is when authenticated", async () => {
  const { state, config } = await createState();
  const auth = new AuthManager(config);
  const route = createRouter({
    rootDir: process.cwd(),
    auth,
    state,
    gameDatabase: createGameDatabaseStub(),
    twitchAuth: createTwitchAuthStub(),
    buildAdminState: () => ({ ...state.controllerSnapshot(), twitch: createTwitchAuthStub().getPublicState() }),
    broadcaster: () => {},
  });

  const login = await runRoute(route, {
    method: "POST",
    url: "/api/login",
    headers: {
      "content-type": "application/json",
    },
    body: { secret: "test-secret" },
  });
  const cookie = login.headers["Set-Cookie"] || login.headers["set-cookie"];

  const response = await runRoute(route, {
    method: "POST",
    url: "/api/games",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: {
      title: "Halo Infinite",
      cover: "https://images.example/halo.jpg",
      status: "in",
      baseWeight: 1,
    },
  });

  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 201);
  assert.equal(body.cover, "https://images.example/halo.jpg");
  assert.equal(body.coverFallback, "");
});
