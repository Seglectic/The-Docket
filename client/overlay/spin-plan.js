(function attachSpinPlan(globalScope) {
  const TWO_PI = Math.PI * 2;

  const DEFAULT_PHYSICS = {
    wheelMass: 1.2,
    launchForce: 1.45,
    drag: 0.12,
    brakeStrength: 1.1,
    minCruiseMs: 3800,
    revealDelayMs: 1200,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeAngle(angle) {
    return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  }

  function hashStringToUnit(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967296;
  }

  function edgeBiasedOffset(sliceAngle, seedUnit) {
    const margin = Math.min(sliceAngle * 0.14, 0.12);
    const usableHalf = Math.max((sliceAngle - margin * 2) / 2, sliceAngle * 0.12);
    const edgePull = Math.pow(seedUnit, 2.2);
    return margin + edgePull * usableHalf;
  }

  function landingAngleForWinner({ winnerIndex, entryCount, seedKey }) {
    const sliceAngle = TWO_PI / entryCount;
    const sliceStart = winnerIndex * sliceAngle;
    const edgeSelector = hashStringToUnit(`${seedKey}:edge`);
    const distanceUnit = hashStringToUnit(`${seedKey}:distance`);
    const distanceFromEdge = edgeBiasedOffset(sliceAngle, distanceUnit);
    const offset = edgeSelector < 0.5
      ? distanceFromEdge
      : sliceAngle - distanceFromEdge;
    return sliceStart + offset;
  }

  function deriveWheelProfile(wheelConfig = {}) {
    const inputPhysics = wheelConfig.physics || {};
    const physics = {
      wheelMass: clamp(Number(inputPhysics.wheelMass ?? DEFAULT_PHYSICS.wheelMass), 0.7, 2.5),
      launchForce: clamp(Number(inputPhysics.launchForce ?? DEFAULT_PHYSICS.launchForce), 0.8, 2.5),
      drag: clamp(Number(inputPhysics.drag ?? DEFAULT_PHYSICS.drag), 0.02, 0.25),
      brakeStrength: clamp(Number(inputPhysics.brakeStrength ?? DEFAULT_PHYSICS.brakeStrength), 0.8, 2.0),
      minCruiseMs: clamp(Number(inputPhysics.minCruiseMs ?? DEFAULT_PHYSICS.minCruiseMs), 2500, 9000),
      revealDelayMs: clamp(Number(inputPhysics.revealDelayMs ?? DEFAULT_PHYSICS.revealDelayMs), 900, 2500),
    };

    const timings = {
      windupMs: clamp(820 + physics.wheelMass * 170, 700, 1450),
      snapMs: clamp(290 - physics.launchForce * 55 + physics.wheelMass * 45, 140, 360),
      cruiseMs: physics.minCruiseMs,
      decelerateMs: clamp(
        2200 + physics.wheelMass * 850 + physics.drag * 4200 - physics.brakeStrength * 900,
        1800,
        5000,
      ),
      revealDelayMs: physics.revealDelayMs,
    };

    const spinDurationMs = timings.windupMs + timings.snapMs + timings.cruiseMs + timings.decelerateMs;
    const revealDurationMs = Math.max(3000, timings.revealDelayMs + 1400);

    return {
      physics,
      timings,
      spinDurationMs,
      revealDurationMs,
    };
  }

  function hermiteAngle(startAngle, endAngle, startVelocity, endVelocity, progress, durationMs) {
    const t = progress;
    const durationSeconds = durationMs / 1000;
    const m0 = startVelocity * durationSeconds;
    const m1 = endVelocity * durationSeconds;
    const h00 = 2 * t * t * t - 3 * t * t + 1;
    const h10 = t * t * t - 2 * t * t + t;
    const h01 = -2 * t * t * t + 3 * t * t;
    const h11 = t * t * t - t * t;
    return h00 * startAngle + h10 * m0 + h01 * endAngle + h11 * m1;
  }

  function computeSpinPlan({
    currentAngle,
    winnerIndex,
    entryCount,
    seedKey,
    wheelConfig,
  }) {
    const profile = deriveWheelProfile(wheelConfig);
    const { physics, timings } = profile;

    const windupTurns = 0.72 + physics.wheelMass * 0.18;
    const snapTurns = 0.95 + physics.launchForce * 0.38;
    const cruiseTurns = 7.4 + physics.minCruiseMs / 820;
    const decelerateBaseTurns = 2.35 + physics.wheelMass * 0.42 + physics.drag * 1.5 - physics.brakeStrength * 0.18;

    const windupDistance = -windupTurns * TWO_PI;
    const snapDistance = snapTurns * TWO_PI;
    const cruiseDistance = cruiseTurns * TWO_PI;
    const decelerationBaseDistance = decelerateBaseTurns * TWO_PI;

    const windupEnd = currentAngle + windupDistance;
    const snapEnd = windupEnd + snapDistance;
    const cruiseEnd = snapEnd + cruiseDistance;
    const decelerationBaseEnd = cruiseEnd + decelerationBaseDistance;

    const landingAngle = landingAngleForWinner({
      winnerIndex,
      entryCount,
      seedKey,
    });
    const targetAtPointer = normalizeAngle(-Math.PI / 2 - landingAngle);
    let delta = targetAtPointer - normalizeAngle(decelerationBaseEnd);
    if (delta < 0) {
      delta += TWO_PI;
    }
    const finalAngle = decelerationBaseEnd + delta;

    const windupExitVelocity = (windupDistance / (timings.windupMs / 1000)) * 1.45;
    const cruiseVelocity = cruiseDistance / (timings.cruiseMs / 1000);
    const snapEntryVelocity = windupExitVelocity;
    const snapExitVelocity = cruiseVelocity;
    const decelerationEntryVelocity = cruiseVelocity;
    const decelerationExitVelocity = 0;

    const phases = [
      {
        name: "windup",
        startMs: 0,
        endMs: timings.windupMs,
        durationMs: timings.windupMs,
        startAngle: currentAngle,
        endAngle: windupEnd,
        startVelocity: 0,
        endVelocity: windupExitVelocity,
        interpolation: "hermite",
      },
      {
        name: "snap",
        startMs: timings.windupMs,
        endMs: timings.windupMs + timings.snapMs,
        durationMs: timings.snapMs,
        startAngle: windupEnd,
        endAngle: snapEnd,
        startVelocity: snapEntryVelocity,
        endVelocity: snapExitVelocity,
        interpolation: "hermite",
      },
      {
        name: "cruise",
        startMs: timings.windupMs + timings.snapMs,
        endMs: timings.windupMs + timings.snapMs + timings.cruiseMs,
        durationMs: timings.cruiseMs,
        startAngle: snapEnd,
        endAngle: cruiseEnd,
        startVelocity: cruiseVelocity,
        endVelocity: cruiseVelocity,
        interpolation: "linear",
      },
      {
        name: "decelerate",
        startMs: timings.windupMs + timings.snapMs + timings.cruiseMs,
        endMs: profile.spinDurationMs,
        durationMs: timings.decelerateMs,
        startAngle: cruiseEnd,
        endAngle: finalAngle,
        startVelocity: decelerationEntryVelocity,
        endVelocity: decelerationExitVelocity,
        interpolation: "hermite",
      },
    ];

    return {
      profile,
      phases,
      durations: {
        ...timings,
        revealDelay: timings.revealDelayMs,
      },
      angles: {
        start: currentAngle,
        windupEnd,
        snapEnd,
        cruiseEnd,
        final: finalAngle,
      },
    };
  }

  function sampleSpinPlan(plan, elapsedMs) {
    if (elapsedMs <= 0) {
      return plan.angles.start;
    }

    const totalMotionMs = plan.profile.spinDurationMs;
    if (elapsedMs >= totalMotionMs) {
      return plan.angles.final;
    }

    const phase = plan.phases.find((entry) => elapsedMs <= entry.endMs) || plan.phases.at(-1);
    const localElapsed = elapsedMs - phase.startMs;
    const progress = clamp(localElapsed / phase.durationMs, 0, 1);

    if (phase.interpolation === "linear") {
      return phase.startAngle + (phase.endAngle - phase.startAngle) * progress;
    }

    return hermiteAngle(
      phase.startAngle,
      phase.endAngle,
      phase.startVelocity,
      phase.endVelocity,
      progress,
      phase.durationMs,
    );
  }

  const api = {
    DEFAULT_PHYSICS,
    computeSpinPlan,
    deriveWheelProfile,
    landingAngleForWinner,
    normalizeAngle,
    sampleSpinPlan,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.DocketSpinPlan = api;
})(typeof window !== "undefined" ? window : globalThis);
