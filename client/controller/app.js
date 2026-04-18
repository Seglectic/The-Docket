const state = {
  admin: null,
  socket: null,
  ui: {
    storageExpanded: false,
  },
  pending: {
    nextGame: false,
    forceResolve: false,
    queueStartId: null,
  },
  gameLookup: {
    controller: null,
    selectedSuggestion: null,
    suggestions: [],
    lastQuery: "",
  },
};

const els = {
  loginPanel: document.getElementById("login-panel"),
  app: document.getElementById("app"),
  loginForm: document.getElementById("login-form"),
  loginError: document.getElementById("login-error"),
  statusLine: document.getElementById("status-line"),
  instanceLine: document.getElementById("instance-line"),
  storageWidget: document.getElementById("storage-widget"),
  storageWidgetDetail: document.getElementById("storage-widget-detail"),
  storageUsageLabel: document.getElementById("storage-usage-label"),
  storageUsageDetail: document.getElementById("storage-usage-detail"),
  storageBreakdown: document.getElementById("storage-breakdown"),
  storageMeterFill: document.getElementById("storage-meter-fill"),
  queueForm: document.getElementById("queue-form"),
  queueList: document.getElementById("queue-list"),
  activeSpin: document.getElementById("active-spin"),
  nextGameButton: document.getElementById("next-game-button"),
  forceResolveButton: document.getElementById("force-resolve-button"),
  refreshButton: document.getElementById("refresh-button"),
  logoutButton: document.getElementById("logout-button"),
  twitchStatus: document.getElementById("twitch-status"),
  connectTwitchButton: document.getElementById("connect-twitch-button"),
  disconnectTwitchButton: document.getElementById("disconnect-twitch-button"),
  gameForm: document.getElementById("game-form"),
  gameId: document.getElementById("game-id"),
  gameTitle: document.getElementById("game-title"),
  gameCover: document.getElementById("game-cover"),
  gameSource: document.getElementById("game-source"),
  gameSourceId: document.getElementById("game-source-id"),
  gameSourceSlug: document.getElementById("game-source-slug"),
  gameReleaseYear: document.getElementById("game-release-year"),
  gameSearchResults: document.getElementById("game-search-results"),
  gameSearchStatus: document.getElementById("game-search-status"),
  gameCoverPreview: document.getElementById("game-cover-preview"),
  gameDbForm: document.getElementById("game-db-form"),
  gameDbEnabled: document.getElementById("game-db-enabled"),
  gameDbClientId: document.getElementById("game-db-client-id"),
  gameDbClientSecret: document.getElementById("game-db-client-secret"),
  gameDbMaxResults: document.getElementById("game-db-max-results"),
  gameDbStatus: document.getElementById("game-db-status"),
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

async function runControllerAction(action, options = {}) {
  const { status = "Working…", successStatus = "", setPending } = options;
  if (typeof setPending === "function") {
    setPending(true);
    render();
  }
  setFooterStatus(status);
  try {
    const result = await action();
    await loadAdminState();
    if (successStatus) {
      setFooterStatus(successStatus);
    }
    return result;
  } catch (error) {
    setFooterStatus(error.message);
    throw error;
  } finally {
    if (typeof setPending === "function") {
      setPending(false);
      render();
    }
  }
}

function createDecoderText(element, options = {}) {
  const alphabet = options.alphabet || "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789%$#@!?*+-=<>~";
  const minDelayMs = options.minDelayMs || 26;
  const maxDelayMs = options.maxDelayMs || 52;
  const minScrambles = options.minScrambles || 1;
  const maxScrambles = options.maxScrambles || 3;
  let targetText = "";
  let ticket = 0;

  function delay() {
    return minDelayMs + Math.floor(Math.random() * Math.max(1, maxDelayMs - minDelayMs + 1));
  }

  function randomChar() {
    return alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function animate(nextText, immediateTicket) {
    let committed = "";
    for (const char of nextText) {
      if (ticket !== immediateTicket) {
        return;
      }
      if (char === " ") {
        committed += char;
        element.textContent = committed;
        await sleep(delay());
        continue;
      }
      const scrambleCount = minScrambles + Math.floor(Math.random() * Math.max(1, maxScrambles - minScrambles + 1));
      for (let index = 0; index < scrambleCount; index += 1) {
        if (ticket !== immediateTicket) {
          return;
        }
        element.textContent = `${committed}${randomChar()}`;
        await sleep(delay());
        if (ticket !== immediateTicket) {
          return;
        }
        element.textContent = committed;
        await sleep(Math.max(12, Math.round(delay() * 0.45)));
      }
      committed += char;
      element.textContent = committed;
      await sleep(delay());
    }
  }

  return {
    setText(nextText, { immediate = false } = {}) {
      const normalized = String(nextText || "");
      if (normalized === targetText) {
        return;
      }
      targetText = normalized;
      ticket += 1;
      const currentTicket = ticket;
      if (immediate) {
        element.textContent = normalized;
        return;
      }
      animate(normalized, currentTicket);
    },
  };
}

const footerDecoders = {
  instances: createDecoderText(els.instanceLine),
  status: createDecoderText(els.statusLine, {
    minDelayMs: 22,
    maxDelayMs: 46,
  }),
};

function setFooterStatus(message, options) {
  footerDecoders.status.setText(message, options);
}

function connectSocket() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  state.socket = new WebSocket(`${protocol}://${location.host}/ws?client=controller`);
  state.socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state" && message.payload.admin) {
      state.admin = message.payload.admin;
      render();
    }
  });
  state.socket.addEventListener("close", () => {
    setFooterStatus("Disconnected. Retrying…");
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
            ${active ? `<button type="button" data-start="${item.id}">Start</button>` : ""}
            ${active ? `<button type="button" class="danger" data-cancel="${item.id}">Cancel</button>` : ""}
          </div>
        </div>
      `;
    })
    .join("");

  els.queueList.querySelectorAll("[data-start]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (state.pending.queueStartId) {
        return;
      }
      await runControllerAction(() => request(`/api/queue/${button.dataset.start}/start`, { method: "POST" }), {
        status: "Starting spin…",
        successStatus: "Spin started",
        setPending: (pending) => {
          state.pending.queueStartId = pending ? button.dataset.start : null;
        },
      });
    });
  });
  els.queueList.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", async () => {
      await runControllerAction(() => request(`/api/queue/${button.dataset.cancel}/cancel`, { method: "POST" }), {
        status: "Canceling queue item…",
        successStatus: "Queue item canceled",
      });
    });
  });
}

function renderSpin() {
  const spin = state.admin.activeSpin;
  els.nextGameButton.disabled = Boolean(spin || state.pending.nextGame || state.pending.queueStartId);
  els.forceResolveButton.disabled = Boolean(!spin || state.pending.forceResolve);
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
          <div class="game-row__media">
            <div class="game-thumb" style="${coverStyle(game.cover, game.coverFallback)}"></div>
          </div>
          <div class="game-row__body">
          <header>
            <strong>${escapeHtml(game.title)}</strong>
            <span>${escapeHtml(game.status)}</span>
          </header>
          <div class="muted">Weight: ${game.baseWeight} | Locked: ${game.locked ? "yes" : "no"}${game.releaseYear ? ` | ${game.releaseYear}` : ""}</div>
          <div class="inline-actions">
            <button class="secondary" data-edit="${game.id}">Edit</button>
            <button class="secondary" data-toggle="${game.id}">${game.status === "in" ? "Move Out" : "Move In"}</button>
            <button class="danger" data-delete="${game.id}">Delete</button>
          </div>
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
      els.gameId.value = game.id;
      els.gameTitle.value = game.title;
      els.gameCover.value = game.cover || "";
      els.gameSource.value = game.metadataSource || "";
      els.gameSourceId.value = game.metadataId || "";
      els.gameSourceSlug.value = game.metadataSlug || "";
      els.gameReleaseYear.value = game.releaseYear || "";
      document.getElementById("game-status").value = game.status;
      document.getElementById("game-weight").value = game.baseWeight;
      updateCoverPreview(els.gameCover.value);
      clearGameSearchResults();
      state.gameLookup.selectedSuggestion = game.metadataId
        ? {
            id: game.metadataId,
            title: game.title,
            cover: game.cover || "",
            source: game.metadataSource || "",
            slug: game.metadataSlug || "",
            releaseYear: game.releaseYear || null,
          }
        : null;
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
      await loadAdminState();
    });
  });

  els.gamesList.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      await request(`/api/games/${button.dataset.delete}`, { method: "DELETE" });
      await loadAdminState();
    });
  });
}

function renderGameDatabaseSettings() {
  const settings = state.admin.gameDatabase;
  if (!settings) {
    return;
  }
  els.gameDbEnabled.checked = Boolean(settings.enabled);
  els.gameDbClientId.value = settings.igdb?.clientId || "";
  els.gameDbClientSecret.value = settings.igdb?.clientSecret || "";
  els.gameDbMaxResults.value = Number(settings.maxResults || 8);
  if (settings.configured && settings.credentialSource === "twitchApp") {
    els.gameDbStatus.textContent = `${settings.enabled ? "Enabled" : "Disabled"} • Using Twitch app credentials from config.yaml`;
  } else if (settings.configured) {
    els.gameDbStatus.textContent = `Configured • ${settings.enabled ? "Autocomplete enabled" : "Autocomplete disabled"}`;
  } else {
    els.gameDbStatus.textContent = "Using Twitch app creds is supported. Paste overrides here only if you want different IGDB credentials.";
  }
}

function renderTwitch() {
  const twitch = state.admin.twitch || {};
  const connected = Boolean(twitch.connected);
  const configured = Boolean(twitch.configured);
  const scopeText = Array.isArray(twitch.scopes) && twitch.scopes.length ? twitch.scopes.join(", ") : "none";
  const eventSub = twitch.eventSub || {};

  if (!configured) {
    els.twitchStatus.innerHTML = `
      <strong>Twitch</strong>
      <div class="muted">Not configured. Add your Twitch app credentials in config first.</div>
      <div class="muted">Redirect: ${escapeHtml(twitch.redirectUri || "http://localhost:3030/auth/twitch/callback")}</div>
    `;
  } else if (!connected) {
    els.twitchStatus.innerHTML = `
      <strong>Twitch</strong>
      <div class="muted">Ready to connect the broadcaster account.</div>
      <div class="muted">Scopes: ${escapeHtml(scopeText)}</div>
    `;
  } else {
    els.twitchStatus.innerHTML = `
      <strong>Twitch Connected</strong>
      <div class="muted">${escapeHtml(twitch.displayName || twitch.broadcasterLogin || "Unknown user")} • ${escapeHtml(twitch.broadcasterLogin || "")}</div>
      <div class="muted">Scopes: ${escapeHtml(scopeText)}</div>
      <div class="muted">Token expires: ${twitch.tokenExpiresAt ? new Date(twitch.tokenExpiresAt).toLocaleString() : "unknown"}</div>
      <div class="muted">EventSub: ${escapeHtml(eventSub.status || "idle")}${eventSub.lastReward ? ` • Last reward: ${escapeHtml(eventSub.lastReward)}` : ""}</div>
      ${eventSub.lastError ? `<div class="error">${escapeHtml(eventSub.lastError)}</div>` : ""}
    `;
  }

  els.connectTwitchButton.disabled = !configured;
  els.disconnectTwitchButton.disabled = !connected;
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

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

function render() {
  if (!state.admin) {
    return;
  }
  els.loginPanel.classList.add("hidden");
  els.app.classList.remove("hidden");
  renderConnections();
  renderStorageUsage();
  renderQueue();
  renderSpin();
  renderGames();
  renderGameDatabaseSettings();
  renderWheelFeel();
  renderTwitch();
  updateCoverPreview(els.gameCover.value);
}

function renderConnections() {
  const connections = state.admin.connections;
  if (!connections) {
    footerDecoders.instances.setText("Instances: --");
    return;
  }
  const visibleControllerCount = Math.max(0, connections.controller - 1);
  const visibleTotal = Math.max(0, connections.total - 1);
  footerDecoders.instances.setText(
    `Instances: ${visibleTotal} total • C ${visibleControllerCount} • O ${connections.overlay} • P ${connections.public}`,
  );
}

function renderStorageUsage() {
  els.storageWidget.setAttribute("aria-expanded", String(state.ui.storageExpanded));
  els.storageWidgetDetail.classList.toggle("hidden", !state.ui.storageExpanded);
  const storage = state.admin.storage;
  if (!storage) {
    els.storageUsageLabel.textContent = "--";
    els.storageUsageDetail.textContent = "Storage summary unavailable";
    els.storageBreakdown.textContent = "";
    els.storageMeterFill.style.height = "0%";
    return;
  }

  const percent = Math.max(0, Math.min(100, Number(storage.percentUsed || 0)));
  els.storageUsageLabel.textContent = `${formatBytes(storage.totalBytes)} / ${formatBytes(storage.limitBytes)}`;
  els.storageUsageDetail.textContent = `${percent.toFixed(1)}% of the 1 GB controller budget`;
  els.storageBreakdown.innerHTML = [
    `Covers ${formatBytes(storage.breakdown?.coversBytes || 0)}`,
    `Events ${formatBytes(storage.breakdown?.eventLogBytes || 0)}`,
    `Spins ${formatBytes(storage.breakdown?.spinsBytes || 0)}`,
    `Runtime ${formatBytes(storage.breakdown?.runtimeBytes || 0)}`,
  ]
    .map((line) => `<span>${escapeHtml(line)}</span>`)
    .join("");
  els.storageMeterFill.style.height = `${percent}%`;
}

function renderGameSearchResults(suggestions) {
  state.gameLookup.suggestions = suggestions;
  if (!suggestions.length) {
    clearGameSearchResults();
    return;
  }
  els.gameSearchResults.innerHTML = suggestions
    .map(
      (item, index) => `
        <button class="search-result" type="button" data-suggestion-index="${index}">
          <span class="search-result__cover" style="${item.coverThumb ? `background-image:url('${encodeURI(item.coverThumb)}')` : ""}"></span>
          <span class="search-result__body">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="muted">${item.releaseYear || "Year unknown"} • ${escapeHtml(item.source.toUpperCase())}</span>
          </span>
        </button>
      `,
    )
    .join("");
  els.gameSearchResults.classList.remove("hidden");
  els.gameSearchResults.querySelectorAll("[data-suggestion-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const suggestion = state.gameLookup.suggestions[Number(button.dataset.suggestionIndex)];
      if (suggestion) {
        applyGameSuggestion(suggestion);
      }
    });
  });
}

function clearGameSearchResults() {
  state.gameLookup.suggestions = [];
  els.gameSearchResults.innerHTML = "";
  els.gameSearchResults.classList.add("hidden");
}

function applyGameSuggestion(suggestion) {
  state.gameLookup.selectedSuggestion = suggestion;
  els.gameTitle.value = suggestion.title || "";
  els.gameCover.value = suggestion.cover || "";
  els.gameSource.value = suggestion.source || "";
  els.gameSourceId.value = suggestion.id || "";
  els.gameSourceSlug.value = suggestion.slug || "";
  els.gameReleaseYear.value = suggestion.releaseYear || "";
  els.gameSearchStatus.textContent = `Selected ${suggestion.title}${suggestion.releaseYear ? ` (${suggestion.releaseYear})` : ""} from IGDB.`;
  updateCoverPreview(els.gameCover.value);
  clearGameSearchResults();
}

async function searchGames(query) {
  const trimmed = query.trim();
  state.gameLookup.lastQuery = trimmed;
  if (trimmed.length < 2) {
    clearGameSearchResults();
    els.gameSearchStatus.textContent = "Search IGDB by title and pick a match to auto-fill the cover.";
    return;
  }

  if (state.gameLookup.controller) {
    state.gameLookup.controller.abort();
  }

  const controller = new AbortController();
  state.gameLookup.controller = controller;
  els.gameSearchStatus.textContent = `Searching for "${trimmed}"…`;

  try {
    const response = await fetch(`/api/game-db/search?q=${encodeURIComponent(trimmed)}`, {
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Game search failed");
    }
    if (state.gameLookup.lastQuery !== trimmed) {
      return;
    }
    if (!data.enabled) {
      clearGameSearchResults();
      els.gameSearchStatus.textContent = data.message || "Game lookup is currently disabled.";
      return;
    }
    renderGameSearchResults(data.suggestions || []);
    els.gameSearchStatus.textContent = data.suggestions?.length
      ? `Found ${data.suggestions.length} match${data.suggestions.length === 1 ? "" : "es"} from IGDB.`
      : `No matches found for "${trimmed}".`;
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }
    clearGameSearchResults();
    els.gameSearchStatus.textContent = error.message;
  }
}

function updateCoverPreview(coverUrl) {
  const trimmed = String(coverUrl || "").trim();
  if (!trimmed) {
    els.gameCoverPreview.textContent = "No cover selected";
    els.gameCoverPreview.style.backgroundImage = "";
    return;
  }
  els.gameCoverPreview.textContent = "";
  els.gameCoverPreview.style.backgroundImage = `url("${trimmed.replaceAll('"', '\\"')}")`;
}

function coverStyle(primary, fallback) {
  const url = primary || fallback || "";
  return url ? `background-image:url('${encodeURI(url)}')` : "";
}

function clearGameMetadataSelection() {
  state.gameLookup.selectedSuggestion = null;
  els.gameSource.value = "";
  els.gameSourceId.value = "";
  els.gameSourceSlug.value = "";
  els.gameReleaseYear.value = "";
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
  await runControllerAction(
    () => request("/api/queue", {
      method: "POST",
      body: JSON.stringify({
        viewerName: document.getElementById("viewer-name").value,
        actionType: document.getElementById("action-type").value,
        userInput: document.getElementById("user-input").value,
      }),
    }),
    {
      status: "Queueing redeem…",
      successStatus: "Redeem queued",
    },
  );
  els.queueForm.reset();
});

els.nextGameButton.addEventListener("click", async () => {
  if (state.pending.nextGame) {
    return;
  }
  await runControllerAction(() => request("/api/spins/next-game", { method: "POST" }), {
    status: "Starting next game spin…",
    successStatus: "Next game spin started",
    setPending: (pending) => {
      state.pending.nextGame = pending;
    },
  });
});

els.forceResolveButton.addEventListener("click", async () => {
  if (state.pending.forceResolve) {
    return;
  }
  await runControllerAction(() => request("/api/spins/force-resolve", { method: "POST" }), {
    status: "Advancing active spin…",
    successStatus: "Spin advanced",
    setPending: (pending) => {
      state.pending.forceResolve = pending;
    },
  });
});

els.refreshButton.addEventListener("click", () => {
  loadAdminState();
});

els.storageWidget.addEventListener("click", () => {
  state.ui.storageExpanded = !state.ui.storageExpanded;
  render();
});

els.logoutButton.addEventListener("click", async () => {
  await request("/api/logout", { method: "POST" });
  location.reload();
});

els.connectTwitchButton.addEventListener("click", () => {
  window.location.href = "/auth/twitch/start";
});

els.disconnectTwitchButton.addEventListener("click", async () => {
  await request("/api/twitch/disconnect", { method: "POST" });
  setFooterStatus("Twitch disconnected");
  await loadAdminState();
});

els.gameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await request("/api/games", {
    method: "POST",
    body: JSON.stringify({
      id: els.gameId.value || undefined,
      title: els.gameTitle.value,
      cover: els.gameCover.value,
      status: document.getElementById("game-status").value,
      baseWeight: Number(document.getElementById("game-weight").value),
      metadataSource: els.gameSource.value,
      metadataId: els.gameSourceId.value,
      metadataSlug: els.gameSourceSlug.value,
      releaseYear: els.gameReleaseYear.value,
    }),
  });
  els.gameForm.reset();
  clearGameMetadataSelection();
  clearGameSearchResults();
  els.gameSearchStatus.textContent = "Search IGDB by title and pick a match to auto-fill the cover.";
  updateCoverPreview("");
  await loadAdminState();
});

els.gameDbForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await request("/api/game-db/settings", {
    method: "POST",
    body: JSON.stringify({
      enabled: els.gameDbEnabled.checked,
      maxResults: Number(els.gameDbMaxResults.value || 8),
      igdb: {
        clientId: els.gameDbClientId.value,
        clientSecret: els.gameDbClientSecret.value,
      },
    }),
  });
  setFooterStatus("Game database settings saved");
  await loadAdminState();
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
  await loadAdminState();
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
  setFooterStatus("Wheel feel updated");
  await loadAdminState();
});

let gameSearchDebounce = null;

els.gameTitle.addEventListener("input", () => {
  if (!state.gameLookup.selectedSuggestion || els.gameTitle.value !== state.gameLookup.selectedSuggestion.title) {
    clearGameMetadataSelection();
  }
  window.clearTimeout(gameSearchDebounce);
  gameSearchDebounce = window.setTimeout(() => {
    searchGames(els.gameTitle.value);
  }, 160);
});

els.gameTitle.addEventListener("blur", () => {
  window.setTimeout(() => {
    if (!els.gameSearchResults.contains(document.activeElement)) {
      clearGameSearchResults();
    }
  }, 120);
});

els.gameCover.addEventListener("input", () => {
  updateCoverPreview(els.gameCover.value);
});

loadAdminState().then(connectSocket).catch(() => {
  setFooterStatus("Login required", { immediate: true });
});

const params = new URLSearchParams(window.location.search);
if (params.get("twitch") === "connected") {
  setFooterStatus("Twitch connected");
  history.replaceState({}, "", "/controller");
}
if (params.get("twitch_error")) {
  setFooterStatus(params.get("twitch_error"));
  history.replaceState({}, "", "/controller");
}
