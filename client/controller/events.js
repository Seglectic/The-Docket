import { els, request, state } from "./core.js";

export function bindControllerEvents({
  loadAdminState,
  render,
  runControllerAction,
  connectSocket,
  clearGameMetadataSelection,
  clearGameSearchResults,
  renderWheelFeel,
  searchGames,
  setFooterStatus,
  updateCoverPreview,
}) {
  let gameSearchDebounce = null;

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
