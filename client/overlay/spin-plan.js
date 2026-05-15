(function attachSpinPlan(globalScope) {
  const TWO_PI = Math.PI * 2;

  const DEFAULT_PHYSICS = {
    launchEnergy: 0.55,
    friction: 0.5,
    suspense: 0.55,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
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
      launchEnergy: clamp(Number(inputPhysics.launchEnergy ?? DEFAULT_PHYSICS.launchEnergy), 0, 1),
      friction: clamp(Number(inputPhysics.friction ?? DEFAULT_PHYSICS.friction), 0, 1),
      suspense: clamp(Number(inputPhysics.suspense ?? DEFAULT_PHYSICS.suspense), 0, 1),
    };

    const windupMs = 900;
    const snapMs = 440;
    const glideMs = clamp(
      5800 + physics.suspense * 3600 + physics.launchEnergy * 2200 - physics.friction * 2400,
      4000,
      12000,
    );
    const revealDelayMs = Math.round(1100 + physics.suspense * 600);

    const timings = {
      windupMs,
      snapMs,
      glideMs,
      revealDelayMs,
    };

    const derived = {
      windupTurns: 0.85,
      snapTurns: 1.1,
      minGlideTurns: 6 + Math.round(physics.launchEnergy * 7),
      decayExponent: lerp(1.5, 2.8, physics.suspense),
    };

    const spinDurationMs = windupMs + snapMs + glideMs;
    const revealDurationMs = Math.max(3000, revealDelayMs + 1400);

    return {
      physics,
      timings,
      derived,
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
    const { timings, derived } = profile;

    const windupDistance = -derived.windupTurns * TWO_PI;
    const snapDistance = derived.snapTurns * TWO_PI;

    const windupEnd = currentAngle + windupDistance;
    const snapEnd = windupEnd + snapDistance;

    const landingAngle = landingAngleForWinner({
      winnerIndex,
      entryCount,
      seedKey,
    });
    const targetAtPointer = normalizeAngle(-Math.PI / 2 - landingAngle);

    let landingOffset = targetAtPointer - normalizeAngle(snapEnd);
    landingOffset = ((landingOffset % TWO_PI) + TWO_PI) % TWO_PI;
    const minGlideRadians = derived.minGlideTurns * TWO_PI;
    const glideDistance = minGlideRadians + landingOffset;
    const finalAngle = snapEnd + glideDistance;

    const decayExponent = derived.decayExponent;
    const glideSeconds = timings.glideMs / 1000;
    const peakVelocity = (glideDistance * (decayExponent + 1)) / glideSeconds;

    const windupExitVelocity = (windupDistance / (timings.windupMs / 1000)) * 1.1;

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
        startVelocity: windupExitVelocity,
        endVelocity: peakVelocity,
        interpolation: "hermite",
      },
      {
        name: "glide",
        startMs: timings.windupMs + timings.snapMs,
        endMs: profile.spinDurationMs,
        durationMs: timings.glideMs,
        startAngle: snapEnd,
        endAngle: finalAngle,
        startVelocity: peakVelocity,
        endVelocity: 0,
        interpolation: "frictionDecay",
        decayExponent,
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

    if (phase.interpolation === "frictionDecay") {
      const distanceFraction = 1 - Math.pow(1 - progress, phase.decayExponent + 1);
      return phase.startAngle + (phase.endAngle - phase.startAngle) * distanceFraction;
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
