const state = {
  admin: null,
  socket: null,
};

const els = {
  loginPanel: document.getElementById("login-panel"),
  app: document.getElementById("app"),
  loginForm: document.getElementById("login-form"),
  loginError: document.getElementById("login-error"),
  statusLine: document.getElementById("status-line"),
  instanceLine: document.getElementById("instance-line"),
  queueForm: document.getElementById("queue-form"),
  queueList: document.getElementById("queue-list"),
  activeSpin: document.getElementById("active-spin"),
  nextGameButton: document.getElementById("next-game-button"),
  forceResolveButton: document.getElementById("force-resolve-button"),
  refreshButton: document.getElementById("refresh-button"),
  logoutButton: document.getElementById("logout-button"),
  gameForm: document.getElementById("game-form"),
  gamesList: document.getElementById("games-list"),
  weightForm: document.getElementById("weight-form"),
  weightTarget: document.getElementById("weight-target"),
  testRedeemButton: document.getElementById("test-redeem-button"),
  testRedeemStatus: document.getElementById("test-redeem-status"),
  wheelForm: document.getElementById("wheel-form"),
  wheelTotal: document.getElementById("wheel-total"),
  wheelMass: document.getElementById("wheel-mass"),
  launchForce: document.getElementById("launch-force"),
  drag: document.getElementById("drag"),
  brakeStrength: document.getElementById("brake-strength"),
  minCruiseMs: document.getElementById("min-cruise-ms"),
  revealDelayMs: document.getElementById("reveal-delay-ms"),
  massOutput: document.getElementById("mass-output"),
  launchOutput: document.getElementById("launch-output"),
  dragOutput: document.getElementById("drag-output"),
  brakeOutput: document.getElementById("brake-output"),
  cruiseMinOutput: document.getElementById("cruise-min-output"),
  revealOutput: document.getElementById("reveal-output"),
};

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

async function loadAdminState() {
  const data = await request("/api/admin/state", { method: "GET" });
  state.admin = data;
  render();
}

function connectSocket() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  state.socket = new WebSocket(`${protocol}://${location.host}/ws?client=controller`);
  state.socket.addEventListener("open", () => {
    els.statusLine.textContent = "Live connection ready";
  });
  state.socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state" && message.payload.admin) {
      state.admin = message.payload.admin;
      render();
    }
  });
  state.socket.addEventListener("close", () => {
    els.statusLine.textContent = "Disconnected. Retrying…";
    window.setTimeout(connectSocket, 1500);
  });
}

function renderQueue() {
  const queue = state.admin.queue
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  els.queueList.innerHTML = queue
    .map((item) => {
      const active = item.status === "queued";
      return `
        <div class="queue-item">
          <header>
            <strong>${escapeHtml(item.viewerName)}</strong>
            <span>${escapeHtml(item.actionType)}</span>
          </header>
          <div class="muted">${new Date(item.createdAt).toLocaleTimeString()}</div>
          <div class="muted">Status: ${escapeHtml(item.status)}</div>
          <div class="inline-actions">
            ${active ? `<button data-start="${item.id}">Start</button>` : ""}
            ${active ? `<button class="danger" data-cancel="${item.id}">Cancel</button>` : ""}
          </div>
        </div>
      `;
    })
    .join("");

  els.queueList.querySelectorAll("[data-start]").forEach((button) => {
    button.addEventListener("click", async () => {
      await request(`/api/queue/${button.dataset.start}/start`, { method: "POST" });
      loadAdminState();
    });
  });
  els.queueList.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", async () => {
      await request(`/api/queue/${button.dataset.cancel}/cancel`, { method: "POST" });
      loadAdminState();
    });
  });
}

function renderSpin() {
  const spin = state.admin.activeSpin;
  if (!spin) {
    els.activeSpin.innerHTML = "<p class='muted'>No active spin</p>";
    els.weightTarget.innerHTML = "";
    return;
  }

  const countdown = spin.countdownEndsAt
    ? Math.max(0, Math.ceil((new Date(spin.countdownEndsAt).getTime() - Date.now()) / 1000))
    : null;

  els.activeSpin.innerHTML = `
    <div class="spin-row">
      <strong>${escapeHtml(spin.type)}</strong>
      <div class="muted">Status: ${escapeHtml(spin.status)}</div>
      <div class="muted">Viewer: ${escapeHtml(spin.viewerName || "Streamer")}</div>
      ${countdown !== null ? `<div>Countdown: ${countdown}s</div>` : ""}
      ${spin.winner ? `<div>Winner locked: ${escapeHtml(spin.winner.label)}</div>` : ""}
    </div>
  `;

  els.weightTarget.innerHTML = spin.entries
    .map((entry) => `<option value="${entry.entryId}">${escapeHtml(entry.label)} (${entry.finalWeight})</option>`)
    .join("");
}

function renderGames() {
  const games = state.admin.games
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  els.gamesList.innerHTML = games
    .map(
      (game) => `
        <div class="game-row">
          <header>
            <strong>${escapeHtml(game.title)}</strong>
            <span>${escapeHtml(game.status)}</span>
          </header>
          <div class="muted">Weight: ${game.baseWeight} | Locked: ${game.locked ? "yes" : "no"}</div>
          <div class="inline-actions">
            <button class="secondary" data-edit="${game.id}">Edit</button>
            <button class="secondary" data-toggle="${game.id}">${game.status === "in" ? "Move Out" : "Move In"}</button>
            <button class="danger" data-delete="${game.id}">Delete</button>
          </div>
        </div>
      `,
    )
    .join("");

  els.gamesList.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const game = state.admin.games.find((entry) => entry.id === button.dataset.edit);
      if (!game) {
        return;
      }
      document.getElementById("game-id").value = game.id;
      document.getElementById("game-title").value = game.title;
      document.getElementById("game-cover").value = game.cover || "";
      document.getElementById("game-status").value = game.status;
      document.getElementById("game-weight").value = game.baseWeight;
    });
  });

  els.gamesList.querySelectorAll("[data-toggle]").forEach((button) => {
    button.addEventListener("click", async () => {
      const game = state.admin.games.find((entry) => entry.id === button.dataset.toggle);
      if (!game) {
        return;
      }
      await request("/api/games", {
        method: "POST",
        body: JSON.stringify({
          ...game,
          status: game.status === "in" ? "out" : "in",
        }),
      });
      loadAdminState();
    });
  });

  els.gamesList.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      await request(`/api/games/${button.dataset.delete}`, { method: "DELETE" });
      loadAdminState();
    });
  });
}

function renderWheelFeel() {
  const physics = state.admin.config?.wheel?.physics;
  const timings = state.admin.config?.wheel?.timings;
  if (!physics || !timings) {
    return;
  }

  syncNumericSlider(els.wheelMass, els.massOutput, physics.wheelMass);
  syncNumericSlider(els.launchForce, els.launchOutput, physics.launchForce);
  syncNumericSlider(els.drag, els.dragOutput, physics.drag);
  syncNumericSlider(els.brakeStrength, els.brakeOutput, physics.brakeStrength);
  syncMsSlider(els.minCruiseMs, els.cruiseMinOutput, physics.minCruiseMs);
  syncMsSlider(els.revealDelayMs, els.revealOutput, physics.revealDelayMs);

  els.wheelTotal.textContent =
    `Motion ${formatMs(state.admin.config.wheel.spinDurationMs)} • Reveal ${formatMs(timings.revealDelayMs)}`;
}

function syncNumericSlider(input, output, value) {
  if (document.activeElement !== input) {
    input.value = value;
  }
  output.textContent = Number(input.value).toFixed(2);
}

function syncMsSlider(input, output, value) {
  if (document.activeElement !== input) {
    input.value = value;
  }
  output.textContent = formatMs(Number(input.value));
}

function formatMs(value) {
  return `${(Number(value) / 1000).toFixed(2)}s`;
}

function render() {
  if (!state.admin) {
    return;
  }
  els.loginPanel.classList.add("hidden");
  els.app.classList.remove("hidden");
  renderConnections();
  renderQueue();
  renderSpin();
  renderGames();
  renderWheelFeel();
}

function renderConnections() {
  const connections = state.admin.connections;
  if (!connections) {
    els.instanceLine.textContent = "Instances: --";
    return;
  }
  els.instanceLine.textContent =
    `Instances: ${connections.total} total • C ${connections.controller} • O ${connections.overlay} • P ${connections.public}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    els.loginError.textContent = "";
    const secret = document.getElementById("secret").value;
    await request("/api/login", {
      method: "POST",
      body: JSON.stringify({ secret }),
    });
    await loadAdminState();
    connectSocket();
  } catch (error) {
    els.loginError.textContent = error.message;
  }
});

els.queueForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await request("/api/queue", {
    method: "POST",
    body: JSON.stringify({
      viewerName: document.getElementById("viewer-name").value,
      actionType: document.getElementById("action-type").value,
      userInput: document.getElementById("user-input").value,
    }),
  });
  els.queueForm.reset();
  loadAdminState();
});

els.nextGameButton.addEventListener("click", async () => {
  await request("/api/spins/next-game", { method: "POST" });
  loadAdminState();
});

els.forceResolveButton.addEventListener("click", async () => {
  await request("/api/spins/force-resolve", { method: "POST" });
  loadAdminState();
});

els.refreshButton.addEventListener("click", () => {
  loadAdminState();
});

els.logoutButton.addEventListener("click", async () => {
  await request("/api/logout", { method: "POST" });
  location.reload();
});

els.gameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await request("/api/games", {
    method: "POST",
    body: JSON.stringify({
      id: document.getElementById("game-id").value || undefined,
      title: document.getElementById("game-title").value,
      cover: document.getElementById("game-cover").value,
      status: document.getElementById("game-status").value,
      baseWeight: Number(document.getElementById("game-weight").value),
    }),
  });
  els.gameForm.reset();
  loadAdminState();
});

els.weightForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await request("/api/spins/add-weight", {
    method: "POST",
    body: JSON.stringify({
      viewerName: document.getElementById("weight-viewer").value || "Viewer",
      targetEntryId: document.getElementById("weight-target").value,
      weightDelta: Number(document.getElementById("weight-delta").value || 1),
    }),
  });
  loadAdminState();
});

els.testRedeemButton.addEventListener("click", async () => {
  els.testRedeemButton.disabled = true;
  try {
    const item = await request("/api/queue/test", { method: "POST" });
    els.testRedeemStatus.textContent = `Test redeem queued: ${item.actionType} by ${item.viewerName}`;
    await loadAdminState();
  } catch (error) {
    els.testRedeemStatus.textContent = error.message;
  } finally {
    els.testRedeemButton.disabled = false;
  }
});

["input", "change"].forEach((eventName) => {
  [
    els.wheelMass,
    els.launchForce,
    els.drag,
    els.brakeStrength,
    els.minCruiseMs,
    els.revealDelayMs,
  ].forEach((input) => {
    input.addEventListener(eventName, renderWheelFeel);
  });
});

els.wheelForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await request("/api/wheel-config", {
    method: "POST",
    body: JSON.stringify({
      physics: {
        wheelMass: Number(els.wheelMass.value),
        launchForce: Number(els.launchForce.value),
        drag: Number(els.drag.value),
        brakeStrength: Number(els.brakeStrength.value),
        minCruiseMs: Number(els.minCruiseMs.value),
        revealDelayMs: Number(els.revealDelayMs.value),
      },
    }),
  });
  els.statusLine.textContent = "Wheel feel updated";
  loadAdminState();
});

loadAdminState().then(connectSocket).catch(() => {
  els.statusLine.textContent = "Login required";
});
