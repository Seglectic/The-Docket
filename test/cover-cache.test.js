const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FileStore } = require("../server/storage");
const { CoverCacheService } = require("../server/cover-cache");

function createConfig() {
  return {
    auth: { sharedSecret: "test" },
    wheel: { overlayTitle: "Test" },
    specialEntries: {},
    features: { manualMode: true, twitchEnabled: false },
  };
}

function setupStore() {
  const store = new FileStore(createConfig());
  store.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docket-cover-cache-"));
  store.readSeedGames = () => [];
  store.ensure();
  return store;
}

test("cacheCover downloads and serves a local media URL", async () => {
  const store = setupStore();
  const service = new CoverCacheService(store, {
    fetch: async () => ({
      ok: true,
      headers: new Headers({ "content-type": "image/jpeg" }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    }),
  });

  const result = await service.cacheCover("https://images.example/cover.jpg", "halo");

  assert.equal(result.remoteUrl, "https://images.example/cover.jpg");
  assert.match(result.localUrl, /^\/media\/covers\/halo-/);
  const filePath = path.join(store.dataDir, result.localUrl.replace(/^\//, ""));
  assert.equal(fs.existsSync(filePath), true);
});
