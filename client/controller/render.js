import {
  coverStyle,
  els,
  escapeHtml,
  footerDecoders,
  formatBytes,
  formatMs,
  state,
  syncMsSlider,
  syncNumericSlider,
} from "./core.js";

export function createRenderer({ request, loadAdminState, runControllerAction, setFooterStatus }) {
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
      els.gameDbStatus.textContent =
        "Using Twitch app creds is supported. Paste overrides here only if you want different IGDB credentials.";
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

  function renderConnections() {
    const connections = state.admin.connections;
    if (!connections) {
      footerDecoders.instances
        .setText("Instances: --")
        .then(() => footerDecoders.brand.setText("Seglectic Systems"));
      return;
    }
    const visibleControllerCount = Math.max(0, connections.controller - 1);
    const visibleTotal = Math.max(0, connections.total - 1);
    footerDecoders.instances
      .setText(`Instances: ${visibleTotal} total • C ${visibleControllerCount} • O ${connections.overlay} • P ${connections.public}`)
      .then(() => footerDecoders.brand.setText("Seglectic Systems"));
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

  function clearGameMetadataSelection() {
    state.gameLookup.selectedSuggestion = null;
    els.gameSource.value = "";
    els.gameSourceId.value = "";
    els.gameSourceSlug.value = "";
    els.gameReleaseYear.value = "";
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

  return {
    clearGameMetadataSelection,
    clearGameSearchResults,
    render,
    renderWheelFeel,
    searchGames,
    updateCoverPreview,
  };
}
