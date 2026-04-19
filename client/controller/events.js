import { els, request, state } from "./core.js";

export function bindControllerEvents({
  loadAdminState,
  render,
  runControllerAction,
  connectSocket,
  clearGameMetadataSelection,
  clearGameSearchResults,
  closeGameEditor,
  closeQueueEditor,
  closeWheelFeel,
  openGameEditor,
  openQueueEditor,
  rememberGameStatus,
  renderWheelFeel,
  searchGames,
  setGameStatus,
  setFooterStatus,
  updateCoverPreview,
  openWheelFeel,
}) {
  let gameSearchDebounce = null;
  let lastSearchTriggeredAt = 0;

  function isTypingField(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    if (target.isContentEditable) {
      return true;
    }
    if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
      return true;
    }
    if (target.tagName !== "INPUT") {
      return false;
    }
    const inputType = (target.getAttribute("type") || "text").toLowerCase();
    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(inputType);
  }

  function closeDrawers() {
    state.ui.gamesDrawerOpen = false;
    state.ui.spinDrawerOpen = false;
    state.ui.configDrawerOpen = false;
    render();
  }

  function toggleDrawer(side) {
    const openingGames = side === "games" && !state.ui.gamesDrawerOpen;
    const openingSpin = side === "spin" && !state.ui.spinDrawerOpen;
    const openingConfig = side === "config" && !state.ui.configDrawerOpen;
    state.ui.gamesDrawerOpen = openingGames;
    state.ui.spinDrawerOpen = openingSpin;
    state.ui.configDrawerOpen = openingConfig;
    render();
  }

  function setDrawerPeek(side, peeking) {
    const drawer = side === "games" ? els.gamesDrawer : side === "spin" ? els.spinDrawer : els.configDrawer;
    if (!drawer || drawer.classList.contains("is-open")) {
      return;
    }
    drawer.classList.toggle("is-peeking", peeking);
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
    closeQueueEditor();
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

  els.gamesDrawerToggle.addEventListener("click", () => {
    toggleDrawer("games");
  });

  els.spinDrawerToggle.addEventListener("click", () => {
    toggleDrawer("spin");
  });

  els.configDrawerToggle.addEventListener("click", () => {
    toggleDrawer("config");
  });

  els.gamesDrawerClose.addEventListener("click", closeDrawers);
  els.spinDrawerClose.addEventListener("click", closeDrawers);
  els.configDrawerClose.addEventListener("click", closeDrawers);
  els.drawerBackdrop.addEventListener("click", closeDrawers);
  els.gameEditorClose.addEventListener("click", closeGameEditor);
  els.queueModalOpen.addEventListener("click", openQueueEditor);
  els.queueEditorClose.addEventListener("click", closeQueueEditor);
  els.wheelFeelOpen.addEventListener("click", openWheelFeel);
  els.wheelFeelClose.addEventListener("click", closeWheelFeel);

  els.gamesDrawerToggle.addEventListener("mouseenter", () => {
    setDrawerPeek("games", true);
  });
  els.gamesDrawerToggle.addEventListener("mouseleave", () => {
    setDrawerPeek("games", false);
  });
  els.gamesDrawerToggle.addEventListener("focus", () => {
    setDrawerPeek("games", true);
  });
  els.gamesDrawerToggle.addEventListener("blur", () => {
    setDrawerPeek("games", false);
  });

  els.spinDrawerToggle.addEventListener("mouseenter", () => {
    setDrawerPeek("spin", true);
  });
  els.spinDrawerToggle.addEventListener("mouseleave", () => {
    setDrawerPeek("spin", false);
  });
  els.spinDrawerToggle.addEventListener("focus", () => {
    setDrawerPeek("spin", true);
  });
  els.spinDrawerToggle.addEventListener("blur", () => {
    setDrawerPeek("spin", false);
  });

  els.configDrawerToggle.addEventListener("mouseenter", () => {
    setDrawerPeek("config", true);
  });
  els.configDrawerToggle.addEventListener("mouseleave", () => {
    setDrawerPeek("config", false);
  });
  els.configDrawerToggle.addEventListener("focus", () => {
    setDrawerPeek("config", true);
  });
  els.configDrawerToggle.addEventListener("blur", () => {
    setDrawerPeek("config", false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.ui.wheelFeelOpen) {
      closeWheelFeel();
      return;
    }
    if (event.key === "Escape" && state.ui.queueEditorOpen) {
      closeQueueEditor();
      return;
    }
    if (event.key === "Escape" && state.ui.gameEditorOpen) {
      closeGameEditor();
      return;
    }
    if (event.key !== "Escape") {
      const target = event.target;
      if (isTypingField(target)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "arrowleft" || key === "a") {
        event.preventDefault();
        toggleDrawer("games");
      } else if (key === "arrowright" || key === "d") {
        event.preventDefault();
        toggleDrawer("spin");
      } else if (key === "arrowup" || key === "w") {
        event.preventDefault();
        toggleDrawer("config");
      }
      return;
    }
    if (!state.ui.gamesDrawerOpen && !state.ui.spinDrawerOpen && !state.ui.configDrawerOpen) {
      return;
    }
    closeDrawers();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!state.ui.gamesDrawerOpen && !state.ui.spinDrawerOpen && !state.ui.configDrawerOpen && !state.ui.gameEditorOpen && !state.ui.queueEditorOpen && !state.ui.wheelFeelOpen) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (state.ui.gameEditorOpen) {
      if (target.closest(".game-editor-modal__card")) {
        return;
      }
      if (target.closest(".game-editor-modal")) {
        closeGameEditor();
        return;
      }
    }
    if (state.ui.queueEditorOpen) {
      if (target.closest(".game-editor-modal__card")) {
        return;
      }
      if (target.closest(".game-editor-modal")) {
        closeQueueEditor();
        return;
      }
    }
    if (state.ui.wheelFeelOpen) {
      if (target.closest(".game-editor-modal__card")) {
        return;
      }
      if (target.closest(".game-editor-modal")) {
        closeWheelFeel();
        return;
      }
    }
    if (target.closest(".drawer-card, .drawer-tab")) {
      return;
    }
    closeDrawers();
  });

  els.viewerChoiceHide.addEventListener("click", () => {
    state.ui.viewerChoiceHidden = true;
    render();
  });

  els.viewerChoiceReopen.addEventListener("click", () => {
    state.ui.viewerChoiceHidden = false;
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
        status: els.gameStatus.value,
        baseWeight: Number(els.gameWeight.value || 1),
        metadataSource: els.gameSource.value,
        metadataId: els.gameSourceId.value,
        metadataSlug: els.gameSourceSlug.value,
        releaseYear: els.gameReleaseYear.value,
      }),
    });
    rememberGameStatus(els.gameStatus.value || "in");
    els.gameForm.reset();
    clearGameMetadataSelection();
    clearGameSearchResults();
    els.gameSearchStatus.textContent = "Type at least 3 characters to search IGDB by title.";
    updateCoverPreview("");
    closeGameEditor();
    await loadAdminState();
  });

  els.gameForm.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.closest("#game-search-results")) {
      return;
    }
    if (target.tagName === "TEXTAREA") {
      return;
    }
    event.preventDefault();
    els.gameForm.requestSubmit();
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
    closeWheelFeel();
    await loadAdminState();
  });

  els.gameTitle.addEventListener("input", () => {
    if (!state.gameLookup.selectedSuggestion || els.gameTitle.value !== state.gameLookup.selectedSuggestion.title) {
      clearGameMetadataSelection();
    }
    window.clearTimeout(gameSearchDebounce);
    gameSearchDebounce = window.setTimeout(() => {
      const now = Date.now();
      const delaySinceLastSearch = now - lastSearchTriggeredAt;
      if (delaySinceLastSearch < 350) {
        window.clearTimeout(gameSearchDebounce);
        gameSearchDebounce = window.setTimeout(() => {
          lastSearchTriggeredAt = Date.now();
          searchGames(els.gameTitle.value);
        }, 350 - delaySinceLastSearch);
        return;
      }
      lastSearchTriggeredAt = now;
      searchGames(els.gameTitle.value);
    }, 380);
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

  els.gamesList.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const addButton = target.closest("[data-game-add]");
    if (addButton) {
      openGameEditor(null);
      return;
    }

    const editButton = target.closest("[data-edit]");
    if (editButton instanceof HTMLElement) {
      const game = state.admin?.games?.find((entry) => entry.id === editButton.dataset.edit);
      if (game) {
        openGameEditor(game);
      }
      return;
    }

    const toggleButton = target.closest("[data-toggle]");
    const toggleWheelButton = target.closest("[data-toggle-wheel-status]");
    if (toggleWheelButton instanceof HTMLElement) {
      const game = state.admin?.games?.find((entry) => entry.id === toggleWheelButton.dataset.toggleWheelStatus);
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
      return;
    }

    const overrideButton = target.closest("[data-override]");
    if (overrideButton instanceof HTMLElement) {
      const gameId = overrideButton.dataset.override;
      const isActive = state.admin?.session?.overrideGameId === gameId;
      await request("/api/games/override", {
        method: "POST",
        body: JSON.stringify({
          gameId: isActive ? null : gameId,
        }),
      });
      await loadAdminState();
      return;
    }

    const deleteButton = target.closest("[data-delete]");
    if (deleteButton instanceof HTMLElement) {
      await request(`/api/games/${deleteButton.dataset.delete}`, { method: "DELETE" });
      await loadAdminState();
    }
  });

  [
    els.gameStatusIn,
    els.gameStatusOut,
    els.gameStatusSeasonal,
    els.gameStatusNewRelease,
    els.gameStatusQueue,
  ].forEach((button) => {
    button.addEventListener("click", () => {
      setGameStatus(button.dataset.gameStatusValue);
    });
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
}
