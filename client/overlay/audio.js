import { AUDIO_TUNING } from "./config.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pickInRange([min, max]) {
  return min + Math.random() * (max - min);
}

function pickFrom(values) {
  return values[Math.floor(Math.random() * values.length)];
}

export function createOverlayAudioController({ tuning = AUDIO_TUNING } = {}) {
  let audioContext = null;
  let tickCooldownUntil = 0;

  function playResultSound(url) {
    if (!url) {
      return;
    }
    try {
      const audio = new Audio(url);
      audio.volume = tuning.resultVolume;
      audio.play().catch(() => {});
    } catch (_) {}
  }

  function playSpinTick({
    progress,
    deltaMs,
    angularVelocity,
    crossingsThisFrame,
  }) {
    const tickTuning = tuning.tick;
    const scheduledMs = performance.now() - deltaMs + progress * deltaMs;
    if (scheduledMs < tickCooldownUntil) {
      return;
    }
    tickCooldownUntil = scheduledMs + tickTuning.minIntervalMs;

    if (tickTuning.mode === "sample" && tickTuning.sampleUrl) {
      playTickSample(tickTuning);
      return;
    }

    const context = ensureAudioContext();
    if (!context) {
      return;
    }
    if (context.state === "suspended") {
      context.resume().catch(() => {});
    }
    if (context.state !== "running") {
      return;
    }

    const frameSliceMs = deltaMs / Math.max(crossingsThisFrame, 1);
    const withinFrameLeadMs = Math.max(1, Math.min(deltaMs, progress * deltaMs + tickTuning.leadMs));
    const when = context.currentTime + withinFrameLeadMs / 1000;
    const intensity = clamp(
      tickTuning.intensityBase
        + Math.abs(angularVelocity) * tickTuning.intensityVelocityScale
        + Math.min(tickTuning.intensityFrameCap, frameSliceMs * tickTuning.intensityFrameScale),
      tickTuning.intensityMin,
      tickTuning.intensityMax,
    );
    synthesizeTick(context, when, intensity, tickTuning.synth);
  }

  function playTickSample(tickTuning) {
    try {
      const audio = new Audio(tickTuning.sampleUrl);
      audio.volume = tickTuning.sampleVolume;
      audio.playbackRate = tickTuning.samplePlaybackRate;
      audio.play().catch(() => {});
    } catch (_) {}
  }

  function ensureAudioContext() {
    if (audioContext) {
      return audioContext;
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }
    try {
      audioContext = new AudioContextCtor();
    } catch (_) {
      audioContext = null;
    }
    return audioContext;
  }

  function synthesizeTick(context, when, intensity, synthTuning) {
    const envelope = context.createGain();
    const filter = context.createBiquadFilter();
    const oscillator = context.createOscillator();
    const overtone = context.createOscillator();
    const overtoneGain = context.createGain();

    const duration = pickInRange(synthTuning.durationMs) / 1000;
    const attack = synthTuning.attackMs / 1000;
    const peak = synthTuning.peakGain * intensity;
    const baseFrequency = pickInRange(synthTuning.baseFrequency);

    oscillator.type = pickFrom(synthTuning.oscillatorTypes);
    oscillator.frequency.setValueAtTime(baseFrequency, when);
    oscillator.frequency.exponentialRampToValueAtTime(
      baseFrequency * pickInRange(synthTuning.glideMultiplier),
      when + duration,
    );

    overtone.type = "triangle";
    overtone.frequency.setValueAtTime(baseFrequency * pickInRange(synthTuning.overtoneMultiplier), when);
    overtone.frequency.exponentialRampToValueAtTime(
      baseFrequency * pickInRange(synthTuning.overtoneGlideMultiplier),
      when + duration * 0.9,
    );

    filter.type = "highpass";
    filter.frequency.setValueAtTime(pickInRange(synthTuning.highpassFrequency), when);
    filter.Q.setValueAtTime(pickInRange(synthTuning.filterQ), when);

    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(peak, when + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    overtoneGain.gain.setValueAtTime(0.0001, when);
    overtoneGain.gain.exponentialRampToValueAtTime(peak * synthTuning.overtoneGainRatio, when + attack);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, when + duration * 0.8);

    oscillator.connect(filter);
    overtone.connect(overtoneGain);
    overtoneGain.connect(filter);
    filter.connect(envelope);
    envelope.connect(context.destination);

    oscillator.start(when);
    overtone.start(when);
    oscillator.stop(when + duration + 0.01);
    overtone.stop(when + duration + 0.01);
  }

  function reset() {
    tickCooldownUntil = 0;
  }

  return {
    playResultSound,
    playSpinTick,
    reset,
  };
}
