const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DocketState } = require("../server/state");
const { FileStore } = require("../server/storage");

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

function setup() {
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
  state.bootstrap();
  return { state, tempRoot };
}

test("storage initializes missing files", () => {
  const { tempRoot } = setup();
  const files = fs.readdirSync(tempRoot);
  assert(files.includes("games.json"));
  assert(files.includes("wheel-config.json"));
  assert(files.includes("queue.json"));
  assert(files.includes("events.jsonl"));
});

test("queue insertion and cancel behavior works", () => {
  const { state } = setup();
  const item = state.addQueueItem({ viewerName: "Alice", actionType: "restore" });
  assert.equal(item.status, "queued");
  const canceled = state.cancelQueueItem(item.id);
  assert.equal(canceled.id, item.id);
  assert.equal(state.getQueue().find((entry) => entry.id === item.id), undefined);
});

test("restore spins from out entries only", () => {
  const { state } = setup();
  const item = state.addQueueItem({ viewerName: "Alice", actionType: "restore" });
  const spin = state.startQueueSpin(item.id);
  assert.equal(spin.type, "restore");
  assert(spin.entries.every((entry) => entry.entryId === "out-1" || entry.entryKind === "special"));
});

test("lock it in can win on the in wheel", async () => {
  const { state } = setup();
  const item = state.addQueueItem({ viewerName: "Bob", actionType: "eliminate" });
  const spin = state.startQueueSpin(item.id);
  spin.winner = spin.entries.find((entry) => entry.entryId === "special-lock-it-in");
  spin.status = "reveal";
  state.upsertSpin(spin);
  state.completeSpin(spin.id);
  const lockedGame = state.getGames().find((entry) => entry.locked);
  assert(lockedGame);
});

test("completed queue items are removed after spin resolution", () => {
  const { state } = setup();
  const item = state.addQueueItem({ viewerName: "Alice", actionType: "restore" });
  const spin = state.startQueueSpin(item.id);
  spin.status = "reveal";
  state.upsertSpin(spin);
  state.completeSpin(spin.id);
  assert.equal(state.getQueue().find((entry) => entry.id === item.id), undefined);
});

test("countdown spin accepts weight before cutoff and resolves after cutoff", async () => {
  const { state } = setup();
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

test("active session survives restart and resolves overdue countdowns", () => {
  const { state, tempRoot } = setup();
  const spin = state.startNextGameSpin();
  spin.countdownEndsAt = new Date(Date.now() - 100).toISOString();
  state.upsertSpin(spin);

  const config = createConfig();
  const store = new FileStore(config);
  store.dataDir = tempRoot;
  store.readSeedGames = () => [];
  const recovered = new DocketState(store, config, { random: () => 0 });
  recovered.bootstrap();
  assert.equal(recovered.getActiveSpin().status, "spinning");
});

test("overdue spinning session is completed during recovery", () => {
  const { state, tempRoot } = setup();
  const item = state.addQueueItem({ viewerName: "Alice", actionType: "restore" });
  const spin = state.startQueueSpin(item.id);
  spin.startedAt = new Date(Date.now() - 20_000).toISOString();
  state.upsertSpin(spin);

  const config = createConfig();
  const store = new FileStore(config);
  store.dataDir = tempRoot;
  store.readSeedGames = () => [];
  const recovered = new DocketState(store, config, { random: () => 0 });
  recovered.bootstrap();

  assert.equal(recovered.getActiveSpin(), null);
  assert.equal(recovered.findSpin(spin.id).status, "complete");
  assert.equal(recovered.getQueue().find((entry) => entry.id === item.id), undefined);
});

test("bootstrap prunes completed and canceled queue items from persisted data", () => {
  const { state, tempRoot } = setup();
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
  recovered.bootstrap();

  assert.deepEqual(
    recovered.getQueue().map((entry) => entry.id),
    ["queued-1", "processing-1"],
  );
});

test("wheel config updates persist physics sliders and recompute derived timings", () => {
  const { state } = setup();
  const updated = state.updateWheelConfig({
    physics: {
      wheelMass: 1.6,
      launchForce: 1.8,
      drag: 0.15,
      brakeStrength: 1.25,
      minCruiseMs: 5000,
      revealDelayMs: 1400,
    },
  });

  assert.equal(updated.physics.wheelMass, 1.6);
  assert.equal(updated.physics.launchForce, 1.8);
  assert.equal(updated.timings.cruiseMs, 5000);
  assert.equal(updated.timings.revealDelayMs, 1400);
  assert(updated.spinDurationMs > 5000);
  assert.equal(state.getWheelConfig().physics.drag, 0.15);
});
