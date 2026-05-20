import { createOverlayAudioController } from "./audio.js?v=0.7.6";
import { lingerDurationForSpin, POINTER_TUNING, WINNER_REVEAL_HOLD_MS } from "./config.js?v=0.7.6";
import { createPointerController } from "./pointer.js?v=0.7.6";

const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");
const viewerLine = document.getElementById("viewer-line");
const streamTitle = document.getElementById("stream-title");
const resultCard = document.getElementById("result-card");
const winnerStage = document.getElementById("winner-stage");
const winnerCoverShell = document.getElementById("winner-cover-shell");
const winnerCoverArt = document.getElementById("winner-cover-art");
const stage = document.querySelector(".stage");

const state = {
  data: null,
  socket: null,
  angle: 0,
  previousAngle: 0,
  wheelOpacity: 1,
  animatingSpinId: null,
  animationVersion: 0,
  readyRevealSpinId: null,
  lastWinnerSpin: null,
  winnerVisibleUntil: 0,
  lastShownWinnerId: null,
};
const imageCache = new Map();
const audio = createOverlayAudioController();
const pointer = createPointerController();

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/ws?client=overlay`);
  state.socket = socket;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      state.data = message.payload.public;
      render();
      syncAnimation();
    }
  });
  socket.addEventListener("close", () => {
    window.setTimeout(connect, 1500);
  });
}

async function bootstrap() {
  const res = await fetch("/api/public-state");
  state.data = await res.json();
  render();
  connect();
}

function syncAnimation() {
  const spin = state.data.activeSpin;
  if (!spin) {
    resetWheelEffects();
    if (Date.now() >= state.winnerVisibleUntil) {
      state.readyRevealSpinId = null;
    }
    return;
  }
  if (state.animatingSpinId && state.animatingSpinId !== spin.id) {
    state.animationVersion += 1;
    state.animatingSpinId = null;
    state.wheelOpacity = 1;
    resetWheelEffects();
  }
  if (spin.status === "spinning" && spin.winner && state.animatingSpinId !== spin.id) {
    state.animatingSpinId = spin.id;
    state.readyRevealSpinId = null;
    animateToWinner(spin);
    return;
  }
  if ((spin.status === "reveal" || spin.status === "complete") && spin.winner) {
    state.wheelOpacity = 1;
    drawWheel(spin.entries);
    if (state.readyRevealSpinId === spin.id) {
      showWinner(spin);
    } else if ((spin.revealStyle === "lock_it_in" || !(spin.entries || []).length) && state.animatingSpinId !== spin.id) {
      // Reveal-only spins skip the wheel animation and show the winner directly.
      state.readyRevealSpinId = spin.id;
      showWinner(spin);
    }
  }
}

function showWinner(spin) {
  if (!spin.winner) {
    return;
  }
  const winningEntry = findWinningEntry(spin) || spin.winner;
  const coverUrl = winningEntry ? resolveCoverUrl(winningEntry) : "";

  winnerStage.className = `winner-stage visible ${spin.revealStyle}${coverUrl ? "" : " no-cover"}`;
  winnerStage.classList.remove("hidden");
  winnerCoverArt.style.backgroundImage = coverUrl
    ? `linear-gradient(180deg, rgba(255,255,255,0.04), rgba(0,0,0,0.22)), url("${coverUrl.replaceAll('"', '\\"')}")`
    : "";
  winnerCoverShell.setAttribute("aria-label", spin.winner.label || "Winner");

  resultCard.className = `result-card ${spin.revealStyle}`;
  resultCard.classList.remove("hidden");
  resultCard.innerHTML = `
    <div>${escapeHtml(spin.viewerName || "Streamer")}</div>
    <strong>${escapeHtml(spin.winner.label)}</strong>
  `;
  if (state.lastShownWinnerId !== spin.id) {
    const assets = state.data?.assets || {};
    const soundKey = spin.revealStyle === "restore"
      ? "restoreSound"
      : spin.revealStyle === "eliminate"
        ? "eliminateSound"
        : spin.revealStyle === "lock_it_in"
          ? "lockItInSound"
          : "nextGameSound";
    audio.playResultSound(assets[soundKey]);
    state.lastWinnerSpin = structuredClone({
      ...spin,
      entries: (spin.entries || []).map((entry) => ({ ...entry })),
      winner: spin.winner ? { ...spin.winner } : null,
    });
    state.winnerVisibleUntil = Date.now() + lingerDurationForSpin(spin);
    state.lastShownWinnerId = spin.id;
    window.setTimeout(() => {
      if (!state.data?.activeSpin && Date.now() >= state.winnerVisibleUntil) {
        render();
      }
    }, lingerDurationForSpin(spin) + 50);
  }
}

function hideWinner() {
  resultCard.className = "result-card hidden";
  winnerStage.className = "winner-stage hidden";
  winnerCoverArt.style.backgroundImage = "";
  state.lastShownWinnerId = null;
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function animate(duration, onFrame) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let lastTimestamp = startedAt;

    function frame(timestamp) {
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const elapsedMs = Math.min(duration, timestamp - startedAt);
      const deltaMs = Math.max(0, timestamp - lastTimestamp);
      lastTimestamp = timestamp;
      onFrame(progress, elapsedMs, deltaMs);
      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });
}

function wait(duration) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, duration);
  });
}

async function animateToWinner(spin) {
  const animationVersion = ++state.animationVersion;
  const entries = spin.entries || [];
  const winnerIndex = entries.findIndex((entry) => entry.entryId === spin.winner.entryId);
  if (winnerIndex === -1 || !entries.length) {
    return;
  }

  hideWinner();
  state.wheelOpacity = 0;
  state.previousAngle = state.angle;
  settlePointer();
  drawWheel(entries);

  const wheelConfig = state.data?.wheelConfig || {};
  const plan = window.DocketSpinPlan.computeSpinPlan({
    currentAngle: state.angle,
    winnerIndex,
    entryCount: entries.length,
    seedKey: spin.id,
    wheelConfig,
  });

  await animate(450, (progress) => {
    if (animationVersion !== state.animationVersion) {
      return;
    }
    state.wheelOpacity = easeOutCubic(progress);
    drawWheel(entries);
  });

  await animate(plan.profile.spinDurationMs, (progress, _elapsedMs, deltaMs) => {
    if (animationVersion !== state.animationVersion) {
      return;
    }
    const nextAngle = window.DocketSpinPlan.sampleSpinPlan(plan, progress * plan.profile.spinDurationMs);
    updateWheelEffects({
      previousAngle: state.previousAngle,
      nextAngle,
      entryCount: entries.length,
      deltaMs,
    });
    state.angle = nextAngle;
    state.previousAngle = nextAngle;
    drawWheel(entries);
  });

  if (animationVersion !== state.animationVersion) {
    return;
  }

  state.angle = plan.angles.final;
  state.previousAngle = plan.angles.final;
  state.wheelOpacity = 1;
  drawWheel(entries);
  await animate(plan.durations.revealDelay, (_progress, _elapsedMs, deltaMs) => {
    if (animationVersion !== state.animationVersion) {
      return;
    }
    pointer.markIdle();
    updatePointerPhysics(deltaMs);
    drawWheel(entries);
  });
  await wait(WINNER_REVEAL_HOLD_MS);
  if (animationVersion !== state.animationVersion) {
    return;
  }
  settlePointer();
  state.readyRevealSpinId = spin.id;
  showWinner(spin);
}

function render() {
  const active = state.data?.activeSpin;
  streamTitle.textContent = state.data?.overlayTitle || "The Docket";
  stage.classList.toggle("overlay-hidden", state.data?.overlayHidden === true);
  const lingeringWinner = !active && state.lastWinnerSpin && Date.now() < state.winnerVisibleUntil
    ? state.lastWinnerSpin
    : null;

  if (lingeringWinner) {
    viewerLine.textContent = `${lingeringWinner.viewerName || "Streamer"} • ${lingeringWinner.type}`;
    drawWheel(lingeringWinner.entries);
    showWinner(lingeringWinner);
    return;
  }

  if (!active) {
    viewerLine.textContent = "Waiting for the next spin";
    hideWinner();
    state.lastWinnerSpin = null;
    state.wheelOpacity = 1;
    state.readyRevealSpinId = null;
    resetWheelEffects();
    drawWheel([]);
    return;
  }
  viewerLine.textContent = `${active.viewerName || "Streamer"} • ${active.type}`;
  drawWheel(active.entries);
}

function findWinningEntry(spin) {
  return (spin.entries || []).find((entry) =>
    entry.entryId === spin.winner?.entryId && entry.entryKind === spin.winner?.entryKind,
  ) || (spin.entries || []).find((entry) => entry.entryId === spin.winner?.entryId) || null;
}

function drawWheel(entries = state.data?.activeSpin?.entries || []) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = 450;

  ctx.save();
  ctx.globalAlpha = state.wheelOpacity;
  ctx.translate(centerX, centerY);
  ctx.rotate(state.angle);

  if (!entries.length) {
    ctx.fillStyle = "rgba(12, 20, 24, 0.9)";
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f6f4ea";
    ctx.font = 'bold 52px "Space Grotesk", "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("The Docket", 0, 12);
    ctx.restore();
    drawPointer(centerX);
    return;
  }

  const sliceAngle = (Math.PI * 2) / entries.length;
  entries.forEach((entry, index) => {
    const start = index * sliceAngle;
    const end = start + sliceAngle;
    drawSliceFill(start, end, radius, colorForEntry(index, entry));
    drawSliceCover(entry, start, end, radius, index);
    drawSliceTint(start, end, radius, entry, index);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.stroke();

    ctx.save();
    ctx.rotate(start + sliceAngle / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#fff8e8";
    ctx.font = 'bold 28px "Space Grotesk", "Segoe UI", sans-serif';
    ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 2;
    wrapText(ctx, entry.label, radius - 48, 0, 180, 30);
    ctx.restore();
  });

  ctx.restore();
  drawPointer(centerX);
}

function drawPointer(centerX) {
  const theme = getPointerTheme();
  const pointerDraw = POINTER_TUNING.draw;

  ctx.save();
  ctx.translate(centerX, pointerDraw.anchorY);
  ctx.rotate(pointer.getDeflection());
  ctx.translate(-centerX, -pointerDraw.anchorY);
  ctx.fillStyle = theme.fill;
  ctx.strokeStyle = theme.stroke;
  ctx.lineWidth = pointerDraw.strokeWidth;
  ctx.shadowColor = theme.glow;
  ctx.shadowBlur = pointerDraw.shadowBlur;
  ctx.shadowOffsetY = pointerDraw.shadowOffsetY;
  ctx.beginPath();
  ctx.moveTo(centerX, pointerDraw.topY);
  ctx.bezierCurveTo(
    centerX + pointerDraw.halfWidth,
    pointerDraw.topY + 2,
    centerX + pointerDraw.halfWidth + 4,
    pointerDraw.widestY,
    centerX + pointerDraw.tipRadius,
    pointerDraw.tipY,
  );
  ctx.quadraticCurveTo(centerX, pointerDraw.tipY + 3, centerX - pointerDraw.tipRadius, pointerDraw.tipY);
  ctx.bezierCurveTo(
    centerX - pointerDraw.halfWidth - 4,
    pointerDraw.widestY,
    centerX - pointerDraw.halfWidth,
    pointerDraw.topY + 2,
    centerX,
    pointerDraw.topY,
  );
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = theme.highlight;
  ctx.globalAlpha = pointerDraw.glossAlpha;
  ctx.beginPath();
  ctx.moveTo(centerX - 14, 40);
  ctx.quadraticCurveTo(centerX, 30, centerX + 14, 40);
  ctx.quadraticCurveTo(centerX + 9, pointerDraw.controlY - 30, centerX, pointerDraw.controlY - 20);
  ctx.quadraticCurveTo(centerX - 9, pointerDraw.controlY - 30, centerX - 14, 40);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSliceFill(start, end, radius, color) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius, start, end);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawSliceCover(entry, start, end, radius, index) {
  const image = getCoverImage(entry);
  if (!image) {
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius, start, end);
  ctx.closePath();
  ctx.clip();

  const mid = start + (end - start) / 2;
  const drawWidth = radius * 0.94;
  const drawHeight = radius * 1.18;
  const orbit = radius * 0.36;

  ctx.rotate(mid);
  ctx.translate(orbit, 0);
  ctx.rotate(Math.PI / 2);
  ctx.filter = entry.entryKind === "game" && entry.wheelScope === "out"
    ? "grayscale(1) contrast(0.92) brightness(0.88)"
    : "none";
  ctx.globalAlpha = entry.entryKind === "special" ? 0.16 : 0.9;
  ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ctx.restore();
}

function drawSliceTint(start, end, radius, entry, index) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius, start, end);
  ctx.closePath();
  const gradient = ctx.createRadialGradient(0, 0, radius * 0.12, 0, 0, radius);
  gradient.addColorStop(0, "rgba(8, 10, 14, 0.18)");
  gradient.addColorStop(0.5, entry.entryKind === "special" ? "rgba(28, 10, 42, 0.34)" : "rgba(8, 10, 14, 0.28)");
  gradient.addColorStop(1, shade(colorForEntry(index, entry), entry.entryKind === "special" ? 0.62 : 0.48));
  ctx.fillStyle = gradient;
  ctx.fill();
}

function colorForEntry(index, entry) {
  if (entry.entryKind === "special") {
    return index % 2 === 0 ? "#ab47bc" : "#ff9f1c";
  }
  return index % 2 === 0 ? "#1f6f8b" : "#2a9d8f";
}

function getCoverImage(entry) {
  const primary = entry.cover || "";
  const fallback = entry.coverFallback || "";
  if (primary) {
    const cached = loadImage(primary, fallback);
    if (cached) {
      return cached;
    }
  }
  if (fallback) {
    return loadImage(fallback);
  }
  return null;
}

function resolveCoverUrl(entry) {
  return entry?.cover || entry?.coverFallback || "";
}

function loadImage(url, fallback = "") {
  if (!url) {
    return null;
  }
  const cached = imageCache.get(url);
  if (cached) {
    if (cached.status === "loaded") {
      return cached.image;
    }
    if (cached.status === "error" && fallback) {
      return loadImage(fallback);
    }
    return null;
  }

  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    const current = imageCache.get(url);
    if (current) {
      current.status = "loaded";
    }
    render();
  };
  image.onerror = () => {
    const current = imageCache.get(url);
    if (current) {
      current.status = "error";
    }
    render();
  };
  image.src = url;
  imageCache.set(url, {
    status: "loading",
    image,
  });
  return null;
}

function resetWheelEffects() {
  state.previousAngle = state.angle;
  pointer.reset();
  audio.reset();
}

function settlePointer() {
  pointer.settle();
}

function updateWheelEffects({ previousAngle, nextAngle, entryCount, deltaMs }) {
  pointer.updateForWheelMotion({
    previousAngle,
    nextAngle,
    entryCount,
    deltaMs,
    onCrossing: ({ progress, deltaMs: crossingDeltaMs, angularVelocity, crossingsThisFrame }) => {
      audio.playSpinTick({
        progress,
        deltaMs: crossingDeltaMs,
        angularVelocity,
        crossingsThisFrame,
      });
    },
  });
}

function updatePointerPhysics(deltaMs) {
  pointer.updatePhysics(deltaMs);
}

function getPointerTheme() {
  return pointer.getTheme(state.data?.activeSpin || state.lastWinnerSpin || null);
}

function shade(color, alpha) {
  const rgb = hexToRgb(color);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function hexToRgb(value) {
  const normalized = value.replace("#", "");
  const hex = normalized.length === 3
    ? normalized.split("").map((part) => `${part}${part}`).join("")
    : normalized;
  const int = Number.parseInt(hex, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function wrapText(context, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let cursorY = y;
  for (const word of words) {
    const test = `${line}${word} `;
    if (context.measureText(test).width > maxWidth && line) {
      context.fillText(line.trim(), x, cursorY);
      line = `${word} `;
      cursorY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) {
    context.fillText(line.trim(), x, cursorY);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

bootstrap();
