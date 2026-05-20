export const WINNER_REVEAL_HOLD_MS = 850;
export const WINNER_MIN_LINGER_MS = 2000;
export const WINNER_LINGER_BY_STYLE_MS = {
  restore: 3200,
  eliminate: 3600,
  next_game: 2600,
  lock_it_in: 4000,
};

export const POINTER_TUNING = {
  maxDeflection: 0.58,
  returnStiffness: 18,
  returnDamping: 5.8,
  speedStiffness: 8,
  speedDamping: 1.6,
  impulseBase: 0.22,
  impulseSpeedScale: 0.014,
  deflectionScale: 0.085,
  maxVelocity: 2.8,
  settleDeflectionThreshold: 0.0008,
  settleVelocityThreshold: 0.008,
  settleSpeedThreshold: 0.05,
  draw: {
    anchorY: 54,
    topY: 26,
    widestY: 56,
    tipY: 126,
    halfWidth: 36,
    tipRadius: 3,
    controlY: 96,
    strokeWidth: 5,
    shadowBlur: 26,
    shadowOffsetY: 5,
    glossAlpha: 0.42,
  },
  themes: {
    default: {
      fill: "#ef6842",
      stroke: "rgba(112, 31, 14, 0.92)",
      glow: "rgba(239, 104, 66, 0.52)",
      highlight: "rgba(255, 229, 216, 0.78)",
    },
    restore: {
      fill: "#38c5ab",
      stroke: "rgba(7, 80, 74, 0.92)",
      glow: "rgba(56, 197, 171, 0.48)",
      highlight: "rgba(220, 255, 248, 0.76)",
    },
  },
};

export const AUDIO_TUNING = {
  resultVolume: 1,
  tick: {
    mode: "generated",
    sampleUrl: "",
    sampleVolume: 0.45,
    samplePlaybackRate: 1,
    minIntervalMs: 14,
    leadMs: 4,
    intensityBase: 0.72,
    intensityVelocityScale: 0.08,
    intensityFrameScale: 0.0025,
    intensityFrameCap: 0.14,
    intensityMin: 0.72,
    intensityMax: 1.5,
    synth: {
      durationMs: [16, 28],
      attackMs: 1,
      peakGain: 0.07,
      baseFrequency: [1200, 1620],
      oscillatorTypes: ["triangle", "square"],
      glideMultiplier: [1.22, 1.38],
      overtoneMultiplier: [1.9, 2.08],
      overtoneGlideMultiplier: [2.3, 2.48],
      highpassFrequency: [900, 1260],
      filterQ: [1.1, 1.8],
      overtoneGainRatio: 0.32,
    },
  },
};

export function lingerDurationForSpin(spin) {
  return Math.max(
    WINNER_MIN_LINGER_MS,
    WINNER_LINGER_BY_STYLE_MS[spin?.revealStyle] || WINNER_MIN_LINGER_MS,
  );
}
