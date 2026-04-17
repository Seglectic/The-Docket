const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");
const viewerLine = document.getElementById("viewer-line");
const streamTitle = document.getElementById("stream-title");
const resultCard = document.getElementById("result-card");

const state = {
  data: null,
  socket: null,
  angle: 0,
  animatingSpinId: null,
};

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/ws`);
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
  if (!spin || !spin.winner) {
    return;
  }
  if (spin.status === "spinning" && state.animatingSpinId !== spin.id) {
    state.animatingSpinId = spin.id;
    animateToWinner(spin);
  }
  if (spin.status === "reveal") {
    showWinner(spin);
  }
  if (spin.status === "complete") {
    showWinner(spin);
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

function animateToWinner(spin) {
  const entries = spin.entries;
  const winnerIndex = entries.findIndex((entry) => entry.entryId === spin.winner.entryId);
  const sliceAngle = (Math.PI * 2) / Math.max(1, entries.length);
  const target = Math.PI * 8 + (Math.PI * 1.5 - (winnerIndex + 0.5) * sliceAngle);
  const start = performance.now();
  const startAngle = state.angle;
  const duration = 6000;
  hideWinner();

  function frame(ts) {
    const progress = Math.min(1, (ts - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    state.angle = startAngle + (target - startAngle) * eased;
    drawWheel();
    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      showWinner(spin);
    }
  }

  requestAnimationFrame(frame);
}

function render() {
  const active = state.data?.activeSpin;
  streamTitle.textContent = state.data?.overlayTitle || "The Docket";
  if (!active) {
    viewerLine.textContent = "Waiting for the next spin";
    hideWinner();
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

  ctx.fillStyle = "#f7d774";
  ctx.beginPath();
  ctx.moveTo(centerX, 60);
  ctx.lineTo(centerX - 28, 120);
  ctx.lineTo(centerX + 28, 120);
  ctx.closePath();
  ctx.fill();
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
