const test = require("node:test");
const assert = require("node:assert/strict");
const { computeSpinPlan, deriveWheelProfile, normalizeAngle } = require("../client/overlay/spin-plan");

test("computeSpinPlan ends on the requested winner slice", () => {
  const entryCount = 6;
  const winnerIndex = 2;
  const plan = computeSpinPlan({
    currentAngle: 1.25,
    winnerIndex,
    entryCount,
    seedKey: "spin-abc",
    wheelConfig: {
      physics: {
        wheelMass: 1.2,
        launchForce: 1.45,
        drag: 0.12,
        brakeStrength: 1.1,
        minCruiseMs: 3800,
        revealDelayMs: 1200,
      },
    },
  });

  const sliceAngle = (Math.PI * 2) / entryCount;
  const pointerAngle = -Math.PI / 2;
  const landedAngle = normalizeAngle(pointerAngle - normalizeAngle(plan.angles.final));
  const landedIndex = Math.floor(landedAngle / sliceAngle);

  assert.equal(landedIndex, winnerIndex);
});

test("computeSpinPlan uses deterministic timing and angles for a spin id", () => {
  const first = computeSpinPlan({
    currentAngle: 0.5,
    winnerIndex: 1,
    entryCount: 5,
    seedKey: "spin-123",
    wheelConfig: {
      physics: {
        wheelMass: 1.2,
        launchForce: 1.45,
        drag: 0.12,
        brakeStrength: 1.1,
        minCruiseMs: 3800,
        revealDelayMs: 1200,
      },
    },
  });
  const second = computeSpinPlan({
    currentAngle: 0.5,
    winnerIndex: 1,
    entryCount: 5,
    seedKey: "spin-123",
    wheelConfig: {
      physics: {
        wheelMass: 1.2,
        launchForce: 1.45,
        drag: 0.12,
        brakeStrength: 1.1,
        minCruiseMs: 3800,
        revealDelayMs: 1200,
      },
    },
  });

  assert.deepEqual(first, second);
});

test("deriveWheelProfile computes authoritative durations from physics sliders", () => {
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

  assert.equal(profile.physics.wheelMass, 1.5);
  assert.equal(profile.physics.minCruiseMs, 4200);
  assert.equal(profile.timings.cruiseMs, 4200);
  assert(profile.spinDurationMs > 4200);
  assert(profile.revealDurationMs >= 3000);
});
