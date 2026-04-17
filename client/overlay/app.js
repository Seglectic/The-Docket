const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");
const viewerLine = document.getElementById("viewer-line");
const streamTitle = document.getElementById("stream-title");
const resultCard = document.getElementById("result-card");

const state = {
  data: null,
  socket: null,
  angle: 0,
  wheelOpacity: 1,
  animatingSpinId: null,
  animationVersion: 0,
  readyRevealSpinId: null,
};

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
    state.animatingSpinId = null;
    state.readyRevealSpinId = null;
    return;
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
    }
  }
}

function showWinner(spin) {
  if (!spin.winner) {
    return;
  }
  resultCard.className = `result-card ${spin.revealStyle}`;
  resultCard.classList.remove("hidden");
  resultCard.innerHTML = `
    <div>${escapeHtml(spin.viewerName || "Streamer")}</div>
    <strong>${escapeHtml(spin.winner.label)}</strong>
  `;
}

function hideWinner() {
  resultCard.className = "result-card hidden";
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function easeInOutSine(value) {
  return -(Math.cos(Math.PI * value) - 1) / 2;
}

function easeOutPower(value, exponent) {
  return 1 - Math.pow(1 - value, exponent);
}

function animate(duration, onFrame) {
  return new Promise((resolve) => {
    const startedAt = performance.now();

    function frame(timestamp) {
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      onFrame(progress);
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

  await animate(plan.profile.spinDurationMs, (progress) => {
    if (animationVersion !== state.animationVersion) {
      return;
    }
    state.angle = window.DocketSpinPlan.sampleSpinPlan(plan, progress * plan.profile.spinDurationMs);
    drawWheel(entries);
  });

  if (animationVersion !== state.animationVersion) {
    return;
  }

  state.angle = plan.angles.final;
  state.wheelOpacity = 1;
  drawWheel(entries);
  await wait(plan.durations.revealDelay);
  if (animationVersion !== state.animationVersion) {
    return;
  }
  state.readyRevealSpinId = spin.id;
  showWinner(spin);
}

function render() {
  const active = state.data?.activeSpin;
  streamTitle.textContent = state.data?.overlayTitle || "The Docket";
  if (!active) {
    viewerLine.textContent = "Waiting for the next spin";
    hideWinner();
    state.wheelOpacity = 1;
    state.readyRevealSpinId = null;
    drawWheel([]);
    return;
  }
  const countdown = active.countdownEndsAt
    ? Math.max(0, Math.ceil((new Date(active.countdownEndsAt).getTime() - Date.now()) / 1000))
    : null;
  viewerLine.textContent = countdown !== null
    ? `${active.viewerName || "Streamer"} • ${active.type} • ${countdown}s`
    : `${active.viewerName || "Streamer"} • ${active.type}`;
  drawWheel(active.entries);
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
    ctx.font = "bold 52px Georgia";
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
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = colorForEntry(index, entry);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.save();
    ctx.rotate(start + sliceAngle / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#fff8e8";
    ctx.font = "bold 30px Georgia";
    wrapText(ctx, entry.label, radius - 48, 0, 180, 30);
    ctx.restore();
  });

  ctx.restore();
  drawPointer(centerX);
}

function drawPointer(centerX) {
  ctx.save();
  ctx.fillStyle = "#f7d774";
  ctx.strokeStyle = "rgba(54, 34, 7, 0.75)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(centerX - 34, 60);
  ctx.lineTo(centerX + 34, 60);
  ctx.lineTo(centerX, 126);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function colorForEntry(index, entry) {
  if (entry.entryKind === "special") {
    return index % 2 === 0 ? "#ab47bc" : "#ff9f1c";
  }
  return index % 2 === 0 ? "#1f6f8b" : "#2a9d8f";
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
