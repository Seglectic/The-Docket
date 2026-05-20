import { POINTER_TUNING } from "./config.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createPointerController({ tuning = POINTER_TUNING } = {}) {
  let deflection = 0;
  let velocity = 0;
  let spinAngularVelocity = 0;

  function reset() {
    deflection = 0;
    velocity = 0;
    spinAngularVelocity = 0;
  }

  function settle() {
    reset();
  }

  function updateForWheelMotion({
    previousAngle,
    nextAngle,
    entryCount,
    deltaMs,
    onCrossing,
  }) {
    const safeDeltaMs = Math.max(1, deltaMs || 16.67);
    const deltaAngle = nextAngle - previousAngle;
    spinAngularVelocity = deltaAngle / (safeDeltaMs / 1000);

    const crossings = window.DocketSpinPlan.getPointerCrossings({
      startAngle: previousAngle,
      endAngle: nextAngle,
      entryCount,
    });

    for (const crossing of crossings) {
      applyImpulse(crossing.direction);
      onCrossing?.({
        progress: crossing.progress,
        deltaMs: safeDeltaMs,
        angularVelocity: spinAngularVelocity,
        crossingsThisFrame: crossings.length,
      });
    }

    updatePhysics(safeDeltaMs);
  }

  function applyImpulse(direction) {
    const impulse = Math.min(
      0.28,
      tuning.impulseBase + Math.abs(spinAngularVelocity) * tuning.impulseSpeedScale,
    );
    velocity -= direction * impulse;
    deflection -= direction * impulse * tuning.deflectionScale;
    deflection = clamp(deflection, -tuning.maxDeflection, tuning.maxDeflection);
    velocity = clamp(velocity, -tuning.maxVelocity, tuning.maxVelocity);
  }

  function updatePhysics(deltaMs) {
    const dt = Math.min(0.05, Math.max(0.001, deltaMs / 1000));
    const speed = Math.abs(spinAngularVelocity);
    const stiffness = tuning.returnStiffness + Math.min(24, speed * tuning.speedStiffness);
    const damping = tuning.returnDamping + Math.min(9, speed * tuning.speedDamping);
    const accel = -deflection * stiffness - velocity * damping;

    velocity += accel * dt;
    deflection += velocity * dt * 2.8;
    deflection = clamp(deflection, -tuning.maxDeflection, tuning.maxDeflection);

    if (
      Math.abs(deflection) < tuning.settleDeflectionThreshold
      && Math.abs(velocity) < tuning.settleVelocityThreshold
      && speed < tuning.settleSpeedThreshold
    ) {
      deflection = 0;
      velocity = 0;
    }
  }

  function markIdle() {
    spinAngularVelocity = 0;
  }

  function getDeflection() {
    return deflection;
  }

  function getTheme(spin) {
    if (spin?.type === "restore" || spin?.revealStyle === "restore") {
      return tuning.themes.restore;
    }
    return tuning.themes.default;
  }

  return {
    getDeflection,
    getTheme,
    markIdle,
    reset,
    settle,
    updateForWheelMotion,
    updatePhysics,
  };
}
