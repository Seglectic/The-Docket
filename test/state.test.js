const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DocketState } = require("../server/state");
const { EVENT_RETENTION_MS, FileStore } = require("../server/storage");

function createConfig(overrides = {}) {
  return {
    server: { host: "127.0.0.1", port: 3030 },
    auth: { sharedSecret: "test" },
    wheel: { countdownSeconds: 1, spinDurationMs: 10, revealDurationMs: 10, overlayTitle: "Test" },
    features: { manualMode: true, twitchEnabled: false },
    specialEntries: {
      viewersChoice: { enabled: true, label: "Viewers Choice", baseWeight: 2, wheelScope: "out" },
      lockItIn: { enabled: true, label: "Lock It In", baseWeight: 2, wheelScope: "in" },
    },
    ...overrides,
  };
}

async function setup() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docket-test-"));
  const config = createConfig();
  const store = new FileStore(config);
  store.dataDir = tempRoot;
  store.readSeedGames = () => [
    { id: "in-1", title: "In 1", cover: "", status: "in", baseWeight: 1, sortOrder: 1, locked: false },
    { id: "in-2", title: "In 2", cover: "", status: "in", baseWeight: 1, sortOrder: 2, locked: false },
    { id: "out-1", title: "Out 1", cover: "", status: "out", baseWeight: 1, sortOrder: 3, locked: false },
  ];
  const state = new DocketState(store, config, { random: () => 0 });
  await state.bootstrap();
  return { state, tempRoot };
}

test("storage initializes missing files", async () => {
  const { tempRoot } = await setup();
  const files = fs.readdirSync(tempRoot);
  assert(files.includes("games.json"));
  assert(files.includes("wheel-config.json"));
  assert(files.includes("game-db-cache.json"));
  assert(files.includes("game-db-settings.json"));
  assert(files.includes("twitch-auth.json"));
  assert(files.includes("queue.json"));
  assert(files.includes("events.jsonl"));
});

test("queue insertion and cancel behavior works", async () => {
  const { state } = await setup();
  const item = state.addQueueItem({ viewerName: "Alice", actionType: "restore" });
  assert.equal(item.status, "queued");
  const canceled = state.cancelQueueItem(item.id);
  assert.equal(canceled.id, item.id);
  assert.equal(state.getQueue().find((entry) => entry.id === item.id), undefined);
});

test("restore spins from out entries only", async () => {
  const { state } = await setup();
  const item = state.addQueueItem({ viewerName: "Alice", actionType: "restore" });
  const spin = state.startQueueSpin(item.id);
  assert.equal(spin.type, "restore");
  assert(spin.entries.every((entry) => entry.entryId === "out-1" || entry.entryKind === "special"));
});

test("lock it in sets pendingLockItIn and resolveLockItIn locks the game", async () => {
  const { state } = await setup();
  const item = state.addQueueItem({ viewerName: "Bob", actionType: "eliminate" });
  const spin = state.startQueueSpin(item.id);
  spin.winner = spin.entries.find((entry) => entry.entryId === "special-lock-it-in");
  spin.status = "reveal";
  state.upsertSpin(spin);
  state.completeSpin(spin.id);
  assert.equal(state.getSession().pendingLockItIn?.spinId, spin.id);
  // Resolve — clears timers to avoid async side-effects in test
  state.resolveLockItIn("in-1");
  state.timers.forEach((t) => clearTimeout(t));
  state.timers.clear();
  const lockedGame = state.getGames().find((entry) => entry.id === "in-1");
  assert(lockedGame?.locked);
});

test("viewers choice can be resolved to a chosen game after the spin completes", async () => {
  const { state } = await setup();
  const item = state.addQueueItem({ viewerName: "Mina", actionType: "restore" });
  const spin = state.startQueueSpin(item.id);
  spin.winner = spin.entries.find((entry) => entry.entryId === "special-viewers-choice");
  spin.status = "reveal";
  state.upsertSpin(spin);
  state.completeSpin(spin.id);

  assert.equal(state.getSession().pendingChoice?.spinId, spin.id);

  const resolved = state.resolveViewersChoice("out-1");
  assert.equal(resolved.winner.entryId, "out-1");
  assert.equal(state.getSession().pendingChoice, null);
});

test("debug viewers choice spin always lands on the viewers choice special entry", async () => {
  const { state } = await setup();
  const spin = state.startDebugViewersChoiceSpin();

  assert.equal(spin.status, "spinning");
  assert.equal(spin.winner.entryId, "special-viewers-choice");
  assert.equal(spin.triggerSource, "debug");
  assert.equal(state.getSession().activeSpinId, spin.id);
});

test("completed queue items are removed after spin resolution", async () => {
  const { state } = await setup();
  const item = state.addQueueItem({ viewerName: "Alice", actionType: "restore" });
  const spin = state.startQueueSpin(item.id);
  spin.status = "reveal";
  state.upsertSpin(spin);
  state.completeSpin(spin.id);
  assert.equal(state.getQueue().find((entry) => entry.id === item.id), undefined);
});

test("countdown spin accepts weight before cutoff and resolves after cutoff", async () => {
  const { state } = await setup();
  const spin = state.startNextGameSpin();
  const targetId = spin.entries[0].entryId;
  state.addWeightToActiveSpin({ viewerName: "Cara", targetEntryId: targetId, weightDelta: 2 });
  const active = state.getActiveSpin();
  const target = active.entries.find((entry) => entry.entryId === targetId);
  assert.equal(target.finalWeight, target.baseWeight + 2);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const resolved = state.findSpin(spin.id);
  assert.notEqual(resolved.status, "countdown");
  assert(resolved.winner);
});

test("active session survives restart and resolves overdue countdowns", async () => {
  const { state, tempRoot } = await setup();
  const spin = state.startNextGameSpin();
  spin.countdownEndsAt = new Date(Date.now() - 100).toISOString();
  state.upsertSpin(spin);

  const config = createConfig();
  const store = new FileStore(config);
  store.dataDir = tempRoot;
  store.readSeedGames = () => [];
  const recovered = new DocketState(store, config, { random: () => 0 });
  await recovered.bootstrap();
  assert.equal(recovered.getActiveSpin().status, "spinning");
});

test("overdue spinning session is completed during recovery", async () => {
  const { state, tempRoot } = await setup();
  const item = state.addQueueItem({ viewerName: "Alice", actionType: "restore" });
  const spin = state.startQueueSpin(item.id);
  spin.startedAt = new Date(Date.now() - 20_000).toISOString();
  state.upsertSpin(spin);

  const config = createConfig();
  const store = new FileStore(config);
  store.dataDir = tempRoot;
  store.readSeedGames = () => [];
  const recovered = new DocketState(store, config, { random: () => 0 });
  await recovered.bootstrap();

  assert.equal(recovered.getActiveSpin(), null);
  assert.equal(recovered.findSpin(spin.id).status, "complete");
  assert.equal(recovered.getQueue().find((entry) => entry.id === item.id), undefined);
});

test("bootstrap prunes completed and canceled queue items from persisted data", async () => {
  const { state, tempRoot } = await setup();
  state.setQueue([
    { id: "queued-1", status: "queued" },
    { id: "done-1", status: "completed" },
    { id: "canceled-1", status: "canceled" },
    { id: "processing-1", status: "processing" },
  ]);

  const config = createConfig();
  const store = new FileStore(config);
  store.dataDir = tempRoot;
  store.readSeedGames = () => [];
  const recovered = new DocketState(store, config, { random: () => 0 });
  await recovered.bootstrap();

  assert.deepEqual(
    recovered.getQueue().map((entry) => entry.id),
    ["queued-1", "processing-1"],
  );
});

test("bootstrap prunes event logs older than six months", async () => {
  const { tempRoot } = await setup();
  const oldAt = new Date(Date.now() - EVENT_RETENTION_MS - 1000).toISOString();
  const freshAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(tempRoot, "events.jsonl"),
    `${JSON.stringify({ type: "old", at: oldAt })}\n${JSON.stringify({ type: "fresh", at: freshAt })}\n`,
    "utf8",
  );

  const config = createConfig();
  const store = new FileStore(config);
  store.dataDir = tempRoot;
  store.readSeedGames = () => [];
  const recovered = new DocketState(store, config, { random: () => 0 });
  await recovered.bootstrap();

  const lines = fs
    .readFileSync(path.join(tempRoot, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].type, "fresh");
});

test("spin history is capped to recent entries", async () => {
  const { state } = await setup();
  const recentStart = new Date().toISOString();
  const oldStart = new Date(Date.now() - EVENT_RETENTION_MS - 1000).toISOString();

  state.setSpins([
    { id: "spin-old", startedAt: oldStart, status: "complete" },
    { id: "spin-new", startedAt: recentStart, status: "complete" },
  ]);

  assert.deepEqual(
    state.getSpins().map((spin) => spin.id),
    ["spin-new"],
  );
});

test("wheel config updates persist physics sliders and recompute derived timings", async () => {
  const { state } = await setup();
  const updated = state.updateWheelConfig({
    physics: {
      launchEnergy: 0.75,
      friction: 0.35,
      suspense: 0.8,
    },
  });

  assert.equal(updated.physics.launchEnergy, 0.75);
  assert.equal(updated.physics.friction, 0.35);
  assert.equal(updated.physics.suspense, 0.8);
  assert(updated.timings.glideMs > 0);
  assert(updated.spinDurationMs > updated.timings.glideMs);
  assert.equal(state.getWheelConfig().physics.suspense, 0.8);
});

test("upsertGame persists metadata fields for auto-matched titles", async () => {
  const { state } = await setup();
  const game = state.upsertGame({
    title: "Halo Infinite",
    cover: "https://images.example/halo.jpg",
    status: "in",
    baseWeight: 1,
    metadataSource: "igdb",
    metadataId: "119171",
    metadataSlug: "halo-infinite",
    releaseYear: 2021,
  });

  assert.equal(game.metadataSource, "igdb");
  assert.equal(game.metadataId, "119171");
  assert.equal(game.releaseYear, 2021);
});

test("seasonal, new release, and queue games stay off the wheels", async () => {
  const { state } = await setup();
  state.upsertGame({ title: "Seasonal Pick", status: "seasonal", baseWeight: 1 });
  state.upsertGame({ title: "Fresh Drop", status: "new_release", baseWeight: 1 });
  state.upsertGame({ title: "Queue Slot", status: "queue", baseWeight: 1 });

  const inEntries = state.buildEligibleEntries("in");
  const outEntries = state.buildEligibleEntries("out");

  assert(inEntries.every((entry) => entry.entryId !== "Seasonal Pick"));
  assert(outEntries.every((entry) => entry.entryId !== "Fresh Drop"));
  assert.equal(inEntries.some((entry) => entry.label === "Seasonal Pick"), false);
  assert.equal(inEntries.some((entry) => entry.label === "Fresh Drop"), false);
  assert.equal(inEntries.some((entry) => entry.label === "Queue Slot"), false);
  assert.equal(outEntries.some((entry) => entry.label === "Seasonal Pick"), false);
  assert.equal(outEntries.some((entry) => entry.label === "Fresh Drop"), false);
  assert.equal(outEntries.some((entry) => entry.label === "Queue Slot"), false);
});

test("only one override game can be active at a time", async () => {
  const { state } = await setup();
  const seasonal = state.upsertGame({ title: "Seasonal Pick", status: "seasonal", baseWeight: 1 });
  const queued = state.upsertGame({ title: "Queue Pick", status: "queue", baseWeight: 1 });

  const first = state.setOverrideGame(seasonal.id);
  assert.equal(first.id, seasonal.id);
  assert.equal(state.getSession().overrideGameId, seasonal.id);

  const second = state.setOverrideGame(queued.id);
  assert.equal(second.id, queued.id);
  assert.equal(state.getSession().overrideGameId, queued.id);

  const cleared = state.setOverrideGame(null);
  assert.equal(cleared, null);
  assert.equal(state.getSession().overrideGameId, null);
});
