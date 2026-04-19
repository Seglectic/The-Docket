import {
  LAST_GAME_STATUS_KEY,
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
  const brokenImageMarkup = `
    <svg class="cover-preview__icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 10l2.5 2.5 2-2 3.5 3.5" />
      <path d="M15.5 8.5h.01" />
      <path d="M4 5l16 14" />
    </svg>
  `;

  function footerBrandText() {
    const version = state.admin?.appVersion || "0.1.0";
    return `The Docket v${version} - Seglectic Systems 2026`;
  }

  function openQueueEditor() {
    state.ui.queueEditorOpen = true;
    render();
    window.setTimeout(() => {
      els.queueForm.reset();
      document.getElementById("viewer-name").focus();
    }, 0);
  }

  function closeQueueEditor() {
    state.ui.queueEditorOpen = false;
    render();
  }

  function openWheelFeel() {
    state.ui.wheelFeelOpen = true;
    render();
  }

  function closeWheelFeel() {
    state.ui.wheelFeelOpen = false;
    render();
  }

  function persistedGameStatus() {
    try {
      const value = window.localStorage.getItem(LAST_GAME_STATUS_KEY);
      return value === "out" ? "out" : "in";
    } catch (_) {
      return "in";
    }
  }

  function rememberGameStatus(status) {
    try {
      window.localStorage.setItem(LAST_GAME_STATUS_KEY, status === "out" ? "out" : "in");
    } catch (_) {
      // Ignore storage failures.
    }
  }

  function setGameStatus(status) {
    const nextStatus = status === "out" ? "out" : "in";
    els.gameStatus.value = nextStatus;
    els.gameStatusIn.classList.toggle("is-active", nextStatus === "in");
    els.gameStatusOut.classList.toggle("is-active", nextStatus === "out");
    els.gameStatusIn.setAttribute("aria-pressed", String(nextStatus === "in"));
    els.gameStatusOut.setAttribute("aria-pressed", String(nextStatus === "out"));
  }

  function openGameEditor(game) {
    if (game) {
      els.gameEditorTitle.textContent = "Edit Game";
      els.gameId.value = game.id;
      els.gameTitle.value = game.title;
      els.gameCover.value = game.cover || "";
      els.gameSource.value = game.metadataSource || "";
      els.gameSourceId.value = game.metadataId || "";
      els.gameSourceSlug.value = game.metadataSlug || "";
      els.gameReleaseYear.value = game.releaseYear || "";
      setGameStatus(game.status);
      els.gameWeight.value = game.baseWeight;
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
    } else {
      els.gameEditorTitle.textContent = "Add Game";
      els.gameForm.reset();
      clearGameMetadataSelection();
      state.gameLookup.selectedSuggestion = null;
      setGameStatus(persistedGameStatus());
      els.gameWeight.value = 1;
      els.gameSearchStatus.textContent = "Search IGDB by title and pick a match to auto-fill the cover.";
      updateCoverPreview("");
    }
    clearGameSearchResults();
    updateCoverPreview(els.gameCover.value);
    state.ui.gameEditorOpen = true;
    render();
    window.setTimeout(() => {
      els.gameTitle.focus();
      els.gameTitle.select();
    }, 0);
  }

  function closeGameEditor() {
    state.ui.gameEditorOpen = false;
    render();
  }

  function viewerChoiceGames(pendingChoice) {
    const scope = pendingChoice?.wheelScope || "in";
    return state.admin.games
      .filter((game) => game.status === scope)
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title));
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
    const entries = spin?.entries || [];
    els.weightTarget.innerHTML = entries.length
      ? entries.map((entry) => `<option value="${entry.entryId}">${escapeHtml(entry.label)} (${entry.finalWeight})</option>`).join("")
      : `<option value="">No active countdown</option>`;
    els.weightTarget.disabled = !entries.length;
  }

  function renderGames() {
    const games = state.admin.games.slice().sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "in" ? -1 : 1;
      }
      return a.title.localeCompare(b.title);
    });
    els.gamesList.innerHTML = `
      ${games
        .map(
          (game) => `
            <article class="game-tile game-tile--${game.status}">
              <button class="game-tile__button" type="button" data-edit="${game.id}">
                <div class="game-tile__cover" style="${coverStyle(game.cover, game.coverFallback)}"></div>
                <div class="game-tile__title">${escapeHtml(game.title)}</div>
                <div class="game-tile__meta-row">
                  <span class="game-tile__year muted">${game.releaseYear || ""}</span>
                </div>
              </button>
              <div class="game-tile__actions">
                <button class="secondary game-tile__chip game-tile__chip--state" type="button" data-toggle="${game.id}">${game.status === "in" ? "IN" : "OUT"}</button>
                <button class="danger game-tile__chip game-tile__chip--icon" type="button" data-delete="${game.id}" aria-label="Delete game" title="Delete game">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 7h16" />
                    <path d="M9 4h6" />
                    <path d="M7 7l1 12h8l1-12" />
                    <path d="M10 11v5" />
                    <path d="M14 11v5" />
                  </svg>
                </button>
              </div>
            </article>
          `,
        )
        .join("")}
      <button id="game-add-button" class="game-add-tile" type="button" aria-label="Add game">
        <span class="game-add-tile__plus">+</span>
        <span>Add Game</span>
      </button>
    `;

    els.gamesList.querySelector("#game-add-button")?.addEventListener("click", () => {
      openGameEditor(null);
    });

    els.gamesList.querySelectorAll("[data-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        const game = state.admin.games.find((entry) => entry.id === button.dataset.edit);
        if (!game) {
          return;
        }
        openGameEditor(game);
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

  function renderGameEditor() {
    els.gameEditorModal.classList.toggle("hidden", !state.ui.gameEditorOpen);
  }

  function renderQueueEditor() {
    els.queueEditorModal.classList.toggle("hidden", !state.ui.queueEditorOpen);
  }

  function renderWheelFeelModal() {
    els.wheelFeelModal.classList.toggle("hidden", !state.ui.wheelFeelOpen);
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
        .then(() => footerDecoders.brand.setText(footerBrandText()));
      return;
    }
    const visibleControllerCount = Math.max(0, connections.controller - 1);
    const visibleTotal = Math.max(0, connections.total - 1);
    footerDecoders.instances
      .setText(`Instances: ${visibleTotal} total • C ${visibleControllerCount} • O ${connections.overlay} • P ${connections.public}`)
      .then(() => footerDecoders.brand.setText(footerBrandText()));
  }

  function renderStorageUsage() {
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

  function renderViewerChoice() {
    const pendingChoice = state.admin.session?.pendingChoice || null;
    const hasPendingChoice = Boolean(pendingChoice);
    const pendingId = pendingChoice?.spinId || null;
    if (pendingId !== state.ui.lastPendingChoiceId) {
      state.ui.lastPendingChoiceId = pendingId;
      state.ui.viewerChoiceHidden = false;
    }
    const isVisible = hasPendingChoice && !state.ui.viewerChoiceHidden;
    els.viewerChoiceModal.classList.toggle("hidden", !isVisible);
    els.viewerChoiceReopen.classList.toggle("hidden", !hasPendingChoice || isVisible);
    if (!hasPendingChoice) {
      els.viewerChoiceList.innerHTML = "";
      return;
    }

    const scopeLabel = pendingChoice.wheelScope === "out" ? "Out wheel" : "In wheel";
    els.viewerChoiceTitle.textContent = `${pendingChoice.viewerName || "Viewer"} landed on Viewer Choice`;
    els.viewerChoiceCopy.textContent = `Pick a game from the ${scopeLabel.toLowerCase()} for this ${pendingChoice.type.replaceAll("_", " ")} result.`;
    const choices = viewerChoiceGames(pendingChoice);
    els.viewerChoiceList.innerHTML = choices.length
      ? choices
          .map(
            (game) => `
              <button class="viewer-choice-option" type="button" data-viewer-choice-game="${game.id}">
                <div class="viewer-choice-option__cover" style="${coverStyle(game.cover, game.coverFallback)}"></div>
                <strong>${escapeHtml(game.title)}</strong>
                <span class="muted">${game.releaseYear || "Year unknown"} • Weight ${game.baseWeight}</span>
              </button>
            `,
          )
          .join("")
      : `<p class="muted">No games are available on that side of the docket.</p>`;

    els.viewerChoiceList.querySelectorAll("[data-viewer-choice-game]").forEach((button) => {
      button.addEventListener("click", async () => {
        state.ui.viewerChoiceHidden = false;
        await runControllerAction(
          () => request("/api/spins/viewers-choice", {
            method: "POST",
            body: JSON.stringify({
              gameId: button.dataset.viewerChoiceGame,
            }),
          }),
          {
            status: "Resolving viewer choice…",
            successStatus: "Viewer choice resolved",
          },
        );
      });
    });
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
      els.gameCoverPreview.innerHTML = brokenImageMarkup;
      els.gameCoverPreview.style.backgroundImage = "";
      return;
    }
    els.gameCoverPreview.innerHTML = "";
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
    const anyDrawerOpen = state.ui.gamesDrawerOpen || state.ui.spinDrawerOpen || state.ui.configDrawerOpen;
    els.loginPanel.classList.add("hidden");
    els.app.classList.remove("hidden");
    els.gamesDrawer.classList.toggle("is-open", state.ui.gamesDrawerOpen);
    els.spinDrawer.classList.toggle("is-open", state.ui.spinDrawerOpen);
    els.configDrawer.classList.toggle("is-open", state.ui.configDrawerOpen);
    els.gamesDrawerToggle.classList.toggle("is-open", state.ui.gamesDrawerOpen);
    els.spinDrawerToggle.classList.toggle("is-open", state.ui.spinDrawerOpen);
    els.configDrawerToggle.classList.toggle("is-open", state.ui.configDrawerOpen);
    els.gamesDrawerToggle.setAttribute("aria-expanded", String(state.ui.gamesDrawerOpen));
    els.spinDrawerToggle.setAttribute("aria-expanded", String(state.ui.spinDrawerOpen));
    els.configDrawerToggle.setAttribute("aria-expanded", String(state.ui.configDrawerOpen));
    els.drawerBackdrop.classList.toggle("hidden", !anyDrawerOpen);
    renderConnections();
    renderStorageUsage();
    renderQueue();
    renderSpin();
    renderGames();
    renderViewerChoice();
    renderGameEditor();
    renderQueueEditor();
    renderWheelFeelModal();
    renderWheelFeel();
    renderTwitch();
    updateCoverPreview(els.gameCover.value);
  }

  return {
    clearGameMetadataSelection,
    clearGameSearchResults,
    closeGameEditor,
    closeQueueEditor,
    closeWheelFeel,
    openQueueEditor,
    openGameEditor,
    openWheelFeel,
    render,
    renderWheelFeel,
    searchGames,
    setGameStatus,
    updateCoverPreview,
  };
}
