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

function createState() {
  const config = createConfig();
  const store = new FileStore(config);
  store.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docket-router-"));
  store.readSeedGames = () => [];
  const state = new DocketState(store, config, { random: () => 0.1 });
  state.bootstrap();
  return { state, config };
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
  const { state, config } = createState();
  const route = createRouter({
    rootDir: process.cwd(),
    auth: new AuthManager(config),
    state,
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
  const { state, config } = createState();
  const auth = new AuthManager(config);
  const route = createRouter({
    rootDir: process.cwd(),
    auth,
    state,
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
