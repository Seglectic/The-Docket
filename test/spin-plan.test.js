const test = require("node:test");
const assert = require("node:assert/strict");
const { computeSpinPlan, deriveWheelProfile, normalizeAngle, sampleSpinPlan } = require("../client/overlay/spin-plan");

const TWO_PI = Math.PI * 2;

const SAMPLE_PHYSICS = {
  launchEnergy: 0.55,
  friction: 0.5,
  suspense: 0.55,
};

test("computeSpinPlan ends on the requested winner slice", () => {
  const entryCount = 6;
  const winnerIndex = 2;
  const plan = computeSpinPlan({
    currentAngle: 1.25,
    winnerIndex,
    entryCount,
    seedKey: "spin-abc",
    wheelConfig: { physics: SAMPLE_PHYSICS },
  });

  const sliceAngle = TWO_PI / entryCount;
  const pointerAngle = -Math.PI / 2;
  const landedAngle = normalizeAngle(pointerAngle - normalizeAngle(plan.angles.final));
  const landedIndex = Math.floor(landedAngle / sliceAngle);

  assert.equal(landedIndex, winnerIndex);
});

test("computeSpinPlan is deterministic for the same seed", () => {
  const make = () => computeSpinPlan({
    currentAngle: 0.5,
    winnerIndex: 1,
    entryCount: 5,
    seedKey: "spin-123",
    wheelConfig: { physics: SAMPLE_PHYSICS },
  });

  assert.deepEqual(make(), make());
});

test("deriveWheelProfile exposes the simplified physics knobs", () => {
  const profile = deriveWheelProfile({
    physics: {
      launchEnergy: 0.8,
      friction: 0.3,
      suspense: 0.7,
    },
  });

  assert.equal(profile.physics.launchEnergy, 0.8);
  assert.equal(profile.physics.friction, 0.3);
  assert.equal(profile.physics.suspense, 0.7);
  assert(profile.timings.glideMs > profile.timings.snapMs);
  assert(profile.spinDurationMs > profile.timings.glideMs);
  assert(profile.revealDurationMs >= 3000);
});

test("deriveWheelProfile ignores legacy physics keys and falls back to defaults", () => {
  const profile = deriveWheelProfile({
    physics: {
      wheelMass: 1.5,
      launchForce: 1.8,
      drag: 0.15,
      brakeStrength: 1.2,
      minCruiseMs: 4200,
      revealDelayMs: 1400,
    },
  });

  assert.equal(profile.physics.launchEnergy, 0.55);
  assert.equal(profile.physics.friction, 0.5);
  assert.equal(profile.physics.suspense, 0.55);
});

test("glide phase samples are monotonic and land at the final angle", () => {
  const plan = computeSpinPlan({
    currentAngle: 0,
    winnerIndex: 3,
    entryCount: 8,
    seedKey: "monotonic",
    wheelConfig: { physics: SAMPLE_PHYSICS },
  });

  const glide = plan.phases.find((phase) => phase.name === "glide");
  assert.ok(glide);

  let prev = sampleSpinPlan(plan, glide.startMs);
  for (let t = 0.05; t <= 1; t += 0.05) {
    const sampleMs = glide.startMs + glide.durationMs * t;
    const value = sampleSpinPlan(plan, sampleMs);
    assert.ok(value >= prev - 1e-9, `glide should not regress at t=${t}`);
    prev = value;
  }

  const finalSample = sampleSpinPlan(plan, plan.profile.spinDurationMs);
  assert.ok(Math.abs(finalSample - plan.angles.final) < 1e-9);
});

test("velocity is continuous at the snap→glide boundary", () => {
  const plan = computeSpinPlan({
    currentAngle: 0,
    winnerIndex: 0,
    entryCount: 4,
    seedKey: "continuity",
    wheelConfig: { physics: SAMPLE_PHYSICS },
  });

  const snap = plan.phases.find((phase) => phase.name === "snap");
  const glide = plan.phases.find((phase) => phase.name === "glide");
  const dt = 2;
  const beforeBoundary = sampleSpinPlan(plan, snap.endMs - dt);
  const atBoundary = sampleSpinPlan(plan, snap.endMs);
  const afterBoundary = sampleSpinPlan(plan, glide.startMs + dt);

  const velBefore = (atBoundary - beforeBoundary) / (dt / 1000);
  const velAfter = (afterBoundary - atBoundary) / (dt / 1000);
  const relDiff = Math.abs(velBefore - velAfter) / Math.max(Math.abs(velBefore), 1);
  assert.ok(relDiff < 0.05, `velocity should match across boundary (before=${velBefore}, after=${velAfter})`);
});
