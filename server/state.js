const { now, pickWeighted, randomId, shuffleEntries } = require("./utils");
const { deriveWheelProfile } = require("../client/overlay/spin-plan");

const GAME_STATUSES = ["in", "out", "seasonal", "new_release", "queue"];
const OVERRIDE_GAME_STATUSES = ["seasonal", "new_release", "queue"];

function normalizeGameStatus(status) {
  return GAME_STATUSES.includes(status) ? status : "in";
}

class DocketState {
  constructor(store, config, options = {}) {
    this.store = store;
    this.config = config;
    this.random = options.random || Math.random;
    this.onStateChange = options.onStateChange || null;
    this.timers = new Map();
    this.sessions = new Map();
  }

  async bootstrap() {
    await this.store.ensure();
    this.ensureWheelConfig();
    this.migrateSpecialEntries();
    this.cleanupPersistedQueue();
    this.enforceAtMostOneLock();
    this.recoverActiveSpin();
  }

  migrateSpecialEntries() {
    const entries = this.store.readJson("specialEntries");
    let changed = false;
    for (const entry of entries) {
      if (entry.id === "special-viewers-choice" && entry.wheelScope !== "both") {
        entry.wheelScope = "both";
        changed = true;
      }
      if (entry.id === "special-lock-it-in" && entry.label !== "Lock It In and Re-spin") {
        entry.label = "Lock It In and Re-spin";
        changed = true;
      }
    }
    if (changed) {
      this.store.writeJson("specialEntries", entries);
    }
  }

  enforceAtMostOneLock() {
    const games = this.getGames();
    const locked = games.filter((g) => g.locked);
    if (locked.length <= 1) return;
    // Keep only the first locked game.
    let kept = false;
    for (const g of games) {
      if (g.locked) {
        if (kept) g.locked = false;
        else kept = true;
      }
    }
    this.setGames(games);
  }

  snapshot() {
    const wheelConfig = this.getWheelConfig();
    return {
      games: this.getGames(),
      specialEntries: this.store.readJson("specialEntries"),
      wheelConfig,
      queue: this.store.readJson("queue"),
      spins: this.store.readJson("spins"),
      session: this.store.readJson("session"),
      activeSpin: this.getActiveSpin(),
      lastCompletedSpin: this.getLastCompletedSpin(),
      config: {
        wheel: wheelConfig,
        features: this.config.features,
        overlayTitle: wheelConfig.overlayTitle || "The Docket",
      },
    };
  }

  publicSnapshot() {
    const state = this.snapshot();
    const overrideGame = state.session.overrideGameId
      ? state.games.find((game) => game.id === state.session.overrideGameId) || null
      : null;
    const assets = this.config.assets || {};
    return {
      games: state.games,
      activeSpin: state.activeSpin,
      lastCompletedSpin: state.lastCompletedSpin,
      overrideGame,
      overlayTitle: state.config.overlayTitle,
      wheelConfig: state.config.wheel || {},
      overlayHidden: state.session.overlayHidden || false,
      assets: {
        restoreSound: assets.restoreSound || "",
        eliminateSound: assets.eliminateSound || "",
        nextGameSound: assets.nextGameSound || "",
        lockItInSound: assets.lockItInSound || "",
      },
    };
  }

  controllerSnapshot() {
    const wheelConfig = this.getWheelConfig();
    return {
      games: this.getGames(),
      queue: this.store.readJson("queue"),
      activeSpin: this.getActiveSpin(),
      lastCompletedSpin: this.getLastCompletedSpin(),
      session: this.store.readJson("session"),
      wheelConfig,
      config: {
        wheel: wheelConfig,
        features: this.config.features,
        overlayTitle: wheelConfig.overlayTitle || "The Docket",
      },
    };
  }

  getGames() {
    return this.store.readJson("games").slice().sort((a, b) => a.sortOrder - b.sortOrder);
  }

  setGames(games) {
    this.store.writeJson("games", games.slice().sort((a, b) => a.sortOrder - b.sortOrder));
  }

  getQueue() {
    return this.store.readJson("queue");
  }

  setQueue(queue) {
    this.store.writeJson("queue", queue);
  }

  getWheelConfig() {
    return this.store.readJson("wheelConfig");
  }

  setWheelConfig(wheelConfig) {
    this.store.writeJson("wheelConfig", wheelConfig);
  }

  ensureWheelConfig() {
    const current = this.store.readJson("wheelConfig");
    const hasNewPhysics =
      current?.physics &&
      ("launchEnergy" in current.physics ||
        "friction" in current.physics ||
        "suspense" in current.physics);
    const needsNormalization =
      !current ||
      !current.physics ||
      !current.timings ||
      !hasNewPhysics ||
      !Number.isFinite(Number(current.spinDurationMs)) ||
      !Number.isFinite(Number(current.revealDurationMs));

    if (!needsNormalization) {
      return current;
    }

    const normalized = this.updateWheelConfig({
      countdownSeconds: current?.countdownSeconds,
      overlayTitle: current?.overlayTitle,
      physics: current?.physics,
    });
    return normalized;
  }

  updateWheelConfig(input = {}) {
    const current = this.getWheelConfig();
    const base = {
      ...current,
      ...input,
      countdownSeconds: Number(input.countdownSeconds ?? current.countdownSeconds),
      overlayTitle: input.overlayTitle ?? current.overlayTitle,
      lockItInRevealMs: Number(input.lockItInRevealMs ?? current.lockItInRevealMs ?? 3500),
      physics: {
        ...(current.physics || {}),
        ...(input.physics || {}),
      },
    };
    const derived = deriveWheelProfile(base);
    const wheelConfig = {
      ...base,
      physics: derived.physics,
      timings: derived.timings,
      spinDurationMs: derived.spinDurationMs,
      revealDurationMs: derived.revealDurationMs,
    };
    this.setWheelConfig(wheelConfig);
    this.record("wheel.updated", {
      spinDurationMs: wheelConfig.spinDurationMs,
      physics: wheelConfig.physics,
    });
    return wheelConfig;
  }

  cleanupPersistedQueue() {
    const queue = this.getQueue();
    const cleaned = queue.filter((entry) => entry.status === "queued" || entry.status === "processing");
    if (cleaned.length !== queue.length) {
      this.setQueue(cleaned);
    }
  }

  getSpins() {
    return this.store.readJson("spins");
  }

  setSpins(spins) {
    this.store.writeJson("spins", this.store.normalizeSpins(spins));
  }

  getSession() {
    const session = this.store.readJson("session") || {};
    return {
      activeSpinId: session.activeSpinId || null,
      pendingChoice: session.pendingChoice || null,
      pendingLockItIn: session.pendingLockItIn || null,
      overlayHidden: session.overlayHidden || false,
      lockItInCooldownRemaining: Number(session.lockItInCooldownRemaining || 0),
      overrideGameId: session.overrideGameId || null,
    };
  }

  setSession(session) {
    this.store.writeJson("session", {
      activeSpinId: session.activeSpinId || null,
      pendingChoice: session.pendingChoice || null,
      pendingLockItIn: session.pendingLockItIn || null,
      overlayHidden: session.overlayHidden || false,
      lockItInCooldownRemaining: Number(session.lockItInCooldownRemaining || 0),
      overrideGameId: session.overrideGameId || null,
    });
  }

  updateSession(patch) {
    const current = this.getSession();
    const next = {
      ...current,
      ...patch,
    };
    this.setSession(next);
    return next;
  }

  getActiveSpin() {
    const session = this.getSession();
    if (!session.activeSpinId) {
      return null;
    }
    return this.getSpins().find((spin) => spin.id === session.activeSpinId) || null;
  }

  getLastCompletedSpin() {
    return this.getSpins()
      .filter((spin) => spin.status === "complete")
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0] || null;
  }

  addQueueItem({ source = "manual", viewerName, actionType, userInput = "", sourceMetadata = {} }) {
    const queue = this.getQueue();
    const item = {
      id: randomId("queue"),
      source,
      sourceMetadata,
      viewerName: viewerName || "Unknown Viewer",
      actionType,
      userInput,
      status: "queued",
      createdAt: now(),
      completedAt: null,
      spinSessionId: null,
    };
    queue.push(item);
    this.setQueue(queue);
    this.record("queue.added", {
      id: item.id,
      source: item.source,
      actionType: item.actionType,
    });
    return item;
  }

  hasQueueItemForRedemption(redemptionId) {
    if (!redemptionId) {
      return false;
    }
    return this.getQueue().some((entry) => entry.sourceMetadata?.redemptionId === redemptionId);
  }

  cancelQueueItem(id) {
    const queue = this.getQueue();
    const item = queue.find((entry) => entry.id === id);
    if (!item) {
      throw new Error("Queue item not found");
    }
    this.setQueue(queue.filter((entry) => entry.id !== id));
    this.record("queue.canceled", { id });
    return item;
  }

  updateGame(id, patch) {
    const games = this.getGames();
    const game = games.find((entry) => entry.id === id);
    if (!game) {
      throw new Error("Game not found");
    }
    Object.assign(game, patch);
    this.setGames(games);
    this.record("game.updated", { id, patch });
    return game;
  }

  upsertGame(input) {
    const games = this.getGames();
    const existing = input.id ? games.find((entry) => entry.id === input.id) : null;
    const normalizedStatus = normalizeGameStatus(input.status);
    if (existing) {
      Object.assign(existing, {
        title: input.title,
        cover: input.cover || "",
        coverFallback: input.coverFallback !== undefined ? input.coverFallback || "" : existing.coverFallback || "",
        status: normalizedStatus,
        baseWeight: Number(input.baseWeight || 1),
        sortOrder: Number(input.sortOrder || existing.sortOrder || games.length + 1),
        locked: Boolean(input.locked),
        metadataSource: input.metadataSource || "",
        metadataId: input.metadataId || "",
        metadataSlug: input.metadataSlug || "",
        releaseYear: Number(input.releaseYear || 0) || null,
      });
      this.setGames(games);
      if (this.getSession().overrideGameId === existing.id && !OVERRIDE_GAME_STATUSES.includes(existing.status)) {
        this.updateSession({ overrideGameId: null });
      }
      this.record("game.updated", { id: existing.id });
      return existing;
    }
    const game = {
      id: input.id || randomId("game"),
      title: input.title,
      cover: input.cover || "",
      coverFallback: input.coverFallback || "",
      status: normalizedStatus,
      baseWeight: Number(input.baseWeight || 1),
      sortOrder: Number(input.sortOrder || games.length + 1),
      locked: Boolean(input.locked),
      metadataSource: input.metadataSource || "",
      metadataId: input.metadataId || "",
      metadataSlug: input.metadataSlug || "",
      releaseYear: Number(input.releaseYear || 0) || null,
    };
    games.push(game);
    this.setGames(games);
    this.record("game.created", { id: game.id });
    return game;
  }

  deleteGame(id) {
    const games = this.getGames().filter((entry) => entry.id !== id);
    this.setGames(games);
    if (this.getSession().overrideGameId === id) {
      this.updateSession({ overrideGameId: null });
    }
    this.record("game.deleted", { id });
  }

  setOverrideGame(gameId) {
    if (!gameId) {
      this.updateSession({ overrideGameId: null });
      this.record("game.override_cleared", {});
      return null;
    }

    const game = this.getGames().find((entry) => entry.id === gameId);
    if (!game) {
      throw new Error("Game not found");
    }
    if (!OVERRIDE_GAME_STATUSES.includes(game.status)) {
      throw new Error("Only Seasonal, New Release, or Queue games can be overridden");
    }

    this.updateSession({ overrideGameId: game.id });
    this.record("game.override_set", { id: game.id, status: game.status });
    return game;
  }

  reorderGames(order) {
    const games = this.getGames();
    const position = new Map(order.map((id, index) => [id, index + 1]));
    for (const game of games) {
      if (position.has(game.id)) {
        game.sortOrder = position.get(game.id);
      }
    }
    this.setGames(games);
    this.record("game.reordered", { order });
    return this.getGames();
  }

  startQueueSpin(queueItemId) {
    if (this.getActiveSpin()) {
      throw new Error("A spin is already active");
    }
    const queue = this.getQueue();
    const item = queue.find((entry) => entry.id === queueItemId);
    if (!item) {
      throw new Error("Queue item not found");
    }
    if (item.status !== "queued") {
      throw new Error("Queue item is not queued");
    }
    if (item.actionType === "add_weight") {
      throw new Error("Add weight is only valid during an active next-game countdown");
    }
    const spin = this.createImmediateSpin(item.actionType, item);
    item.status = "processing";
    item.spinSessionId = spin.id;
    this.setQueue(queue);
    this.record("spin.started", { queueItemId, spinId: spin.id });
    return spin;
  }

  startDebugViewersChoiceSpin() {
    if (this.getActiveSpin()) {
      throw new Error("A spin is already active");
    }
    const viewersChoice = this.store
      .readJson("specialEntries")
      .find((entry) => entry.id === "special-viewers-choice");
    if (!viewersChoice || !viewersChoice.enabled) {
      throw new Error("Viewers Choice is disabled");
    }
    const actionType = viewersChoice.wheelScope === "out" ? "restore" : "eliminate";
    const spin = this.createImmediateSpin(
      actionType,
      {
        id: null,
        source: "debug",
        viewerName: "Debug",
      },
      {
        forcedWinnerEntryId: viewersChoice.id,
        consumeCooldown: false,
      },
    );
    this.record("spin.debug_started", { spinId: spin.id, forcedWinnerEntryId: viewersChoice.id });
    return spin;
  }

  startNextGameSpin(triggerSource = "manual") {
    if (this.getActiveSpin()) {
      throw new Error("A spin is already active");
    }
    const countdownMs = Number(this.getWheelConfig().countdownSeconds || 10) * 1000;
    const games = this.buildEligibleEntries("in");
    const session = this.getSession();
    if (session.lockItInCooldownRemaining > 0) {
      this.updateSession({ lockItInCooldownRemaining: session.lockItInCooldownRemaining - 1 });
    }
    if (!games.length) {
      throw new Error("No eligible entries available");
    }
    const shuffled = shuffleEntries(games, this.random);
    const spin = {
      id: randomId("spin"),
      type: "next_game",
      status: "countdown",
      startedAt: now(),
      countdownEndsAt: new Date(Date.now() + countdownMs).toISOString(),
      triggerQueueItemId: null,
      triggerSource,
      viewerName: "Streamer",
      entries: shuffled.map((entry) => ({
        spinSessionId: null,
        entryKind: entry.entryKind,
        entryId: entry.entryId,
        label: entry.label,
        cover: entry.cover,
        coverFallback: entry.coverFallback || "",
        wheelScope: entry.wheelScope || "in",
        baseWeight: entry.baseWeight,
        bonusWeight: 0,
        finalWeight: entry.baseWeight,
      })),
      winner: null,
      revealStyle: "next_game",
    };
    for (const entry of spin.entries) {
      entry.spinSessionId = spin.id;
    }
    const spins = this.getSpins();
    spins.push(spin);
    this.setSpins(spins);
    this.updateSession({ activeSpinId: spin.id, pendingChoice: null, pendingLockItIn: null });
    this.scheduleCountdown(spin.id, countdownMs);
    this.record("spin.countdown_started", { spinId: spin.id });
    return spin;
  }

  addWeightToActiveSpin({ viewerName, targetEntryId, weightDelta = 1, source = "manual", userInput = "" }) {
    const spin = this.getActiveSpin();
    if (!spin || spin.type !== "next_game" || spin.status !== "countdown") {
      throw new Error("No active next-game countdown");
    }
    if (Date.now() >= new Date(spin.countdownEndsAt).getTime()) {
      throw new Error("Countdown already ended");
    }
    const target = spin.entries.find((entry) => entry.entryId === targetEntryId);
    if (!target) {
      throw new Error("Target entry not found in active spin");
    }
    const queueItem = this.addQueueItem({
      source,
      viewerName,
      actionType: "add_weight",
      userInput,
    });
    this.setQueue(this.getQueue().filter((entry) => entry.id !== queueItem.id));
    target.bonusWeight += Number(weightDelta || 1);
    target.finalWeight = target.baseWeight + target.bonusWeight;
    this.upsertSpin(spin);
    this.record("spin.weight_added", { spinId: spin.id, targetEntryId, viewerName });
    return spin;
  }

  completeSpin(spinId) {
    const spin = this.findSpin(spinId);
    if (!spin) {
      throw new Error("Spin not found");
    }
    if (spin.status === "complete") {
      return spin;
    }
    if (spin.status === "countdown") {
      this.resolveCountdownSpin(spinId);
      return this.findSpin(spinId);
    }
    if (spin.status === "spinning" || spin.status === "reveal") {
      spin.status = "complete";
      this.clearTimer(spin.id);
      this.applyWinner(spin);
      this.upsertSpin(spin);
      this.updateSession({ activeSpinId: null });
      this.record("spin.completed", { spinId });
      return spin;
    }
    return spin;
  }

  forceResolveActiveSpin() {
    const spin = this.getActiveSpin();
    if (!spin) {
      throw new Error("No active spin");
    }
    if (spin.status === "countdown") {
      return this.resolveCountdownSpin(spin.id);
    }
    if (spin.status === "spinning") {
      spin.status = "reveal";
      this.upsertSpin(spin);
      return spin;
    }
      return this.completeSpin(spin.id);
  }

  recoverActiveSpin() {
    const active = this.getActiveSpin();
    if (!active) {
      return;
    }
    const wheelConfig = this.getWheelConfig();
    if (active.status === "countdown") {
      const ms = new Date(active.countdownEndsAt).getTime() - Date.now();
      if (ms <= 0) {
        this.resolveCountdownSpin(active.id);
      } else {
        this.scheduleCountdown(active.id, ms);
      }
      return;
    }
    if (active.status === "spinning") {
      const revealAt = this.getRevealAt(active, wheelConfig);
      const ms = new Date(revealAt).getTime() - Date.now();
      if (ms <= 0) {
        active.status = "reveal";
        this.upsertSpin(active);
        const completeAt = this.getCompleteAt(active, wheelConfig);
        const completeMs = new Date(completeAt).getTime() - Date.now();
        if (completeMs <= 0) {
          this.completeSpin(active.id);
        } else {
          this.scheduleComplete(active.id, completeMs);
        }
      } else {
        this.scheduleReveal(active.id, ms);
      }
      return;
    }
    if (active.status === "reveal") {
      const completeAt = this.getCompleteAt(active, wheelConfig);
      const ms = new Date(completeAt).getTime() - Date.now();
      if (ms <= 0) {
        this.completeSpin(active.id);
      } else {
        this.scheduleComplete(active.id, ms);
      }
      return;
    }
    this.updateSession({ activeSpinId: null });
  }

  createImmediateSpin(actionType, queueItem, options = {}) {
    const { forcedWinnerEntryId = null, consumeCooldown = true } = options;
    const wheelScope = actionType === "restore" ? "out" : "in";
    const entries = this.buildEligibleEntries(wheelScope);
    if (wheelScope === "in" && consumeCooldown) {
      const session = this.getSession();
      if (session.lockItInCooldownRemaining > 0) {
        this.updateSession({ lockItInCooldownRemaining: session.lockItInCooldownRemaining - 1 });
      }
    }
    if (!entries.length) {
      throw new Error("No eligible entries available");
    }
    const snapshots = entries.map((entry) => ({
      spinSessionId: null,
      entryKind: entry.entryKind,
      entryId: entry.entryId,
      label: entry.label,
      cover: entry.cover,
      coverFallback: entry.coverFallback || "",
      wheelScope: entry.wheelScope || wheelScope,
      baseWeight: entry.baseWeight,
      bonusWeight: 0,
      finalWeight: entry.baseWeight,
    }));
    const winner = forcedWinnerEntryId
      ? snapshots.find((entry) => entry.entryId === forcedWinnerEntryId) || null
      : pickWeighted(snapshots, this.random);
    if (!winner) {
      throw new Error("Forced winner entry not found in spin entries");
    }
    const displayEntries = shuffleEntries(snapshots, this.random);
    const spin = {
      id: randomId("spin"),
      type: actionType,
      status: "spinning",
      startedAt: now(),
      countdownEndsAt: null,
      triggerQueueItemId: queueItem?.id || null,
      triggerSource: queueItem?.source || "manual",
      viewerName: queueItem?.viewerName || "Streamer",
      entries: displayEntries.map((entry) => ({ ...entry })),
      winner: { ...winner },
      revealStyle: actionType,
    };
    for (const entry of spin.entries) {
      entry.spinSessionId = spin.id;
    }
    spin.winner.spinSessionId = spin.id;
    const spins = this.getSpins();
    spins.push(spin);
    this.setSpins(spins);
    this.updateSession({ activeSpinId: spin.id, pendingChoice: null, pendingLockItIn: null });
    this.scheduleReveal(spin.id, Number(this.getWheelConfig().spinDurationMs || 6500));
    return spin;
  }

  resolveCountdownSpin(spinId) {
    const spin = this.findSpin(spinId);
    if (!spin) {
      throw new Error("Spin not found");
    }
    if (spin.status !== "countdown") {
      return spin;
    }
    this.clearTimer(spin.id);
    for (const entry of spin.entries) {
      entry.finalWeight = entry.baseWeight + entry.bonusWeight;
    }
    const winner = pickWeighted(spin.entries, this.random);
    spin.winner = winner ? { ...winner } : null;
    spin.status = "spinning";
    this.upsertSpin(spin);
    this.scheduleReveal(spin.id, Number(this.getWheelConfig().spinDurationMs || 6500));
    this.record("spin.countdown_resolved", { spinId: spin.id });
    return spin;
  }

  applyWinner(spin) {
    if (!spin.winner) {
      return;
    }
    const games = this.getGames();
    const queue = this.getQueue();
    const queueItem = spin.triggerQueueItemId
      ? queue.find((entry) => entry.id === spin.triggerQueueItemId)
      : null;

    if (spin.type === "restore" && spin.winner.entryKind === "game") {
      const game = games.find((entry) => entry.id === spin.winner.entryId);
      if (game) {
        game.status = "in";
        game.locked = false;
        if (this.getSession().overrideGameId === game.id) {
          this.updateSession({ overrideGameId: null });
        }
      }
    }

    if ((spin.type === "eliminate" || spin.type === "next_game") && spin.winner.entryKind === "game") {
      const game = games.find((entry) => entry.id === spin.winner.entryId);
      if (game && spin.type === "eliminate") {
        if (!game.locked) {
          game.status = "out";
          if (this.getSession().overrideGameId === game.id) {
            this.updateSession({ overrideGameId: null });
          }
        }
      }
    }

    if ((spin.type === "restore" || spin.type === "eliminate" || spin.type === "next_game") && spin.winner.entryKind === "special") {
      const game = games.find((entry) => entry.id === spin.winner.entryId);
      if (!game && spin.winner.entryId === "special-viewers-choice") {
        this.updateSession({
          pendingChoice: {
            spinId: spin.id,
            type: spin.type,
            wheelScope: spin.type === "restore" ? "out" : "in",
            viewerName: spin.viewerName || "Viewer",
          },
        });
      }
      if (!game && spin.winner.entryId === "special-lock-it-in") {
        const lockable = games.filter((g) => g.status === "in" && !g.locked);
        if (lockable.length > 0) {
          this.updateSession({
            pendingLockItIn: {
              spinId: spin.id,
              viewerName: spin.viewerName || "Streamer",
            },
          });
        }
        // If no lockable games, the special entry resolves as a no-op.
      }
    }

    this.setGames(games);
    if (queueItem) {
      this.setQueue(queue.filter((entry) => entry.id !== queueItem.id));
    }
  }

  buildEligibleEntries(wheelScope) {
    const session = this.getSession();
    const games = this.getGames()
      .filter((game) => (wheelScope === "in" || wheelScope === "out") && game.status === wheelScope)
      .map((game) => ({
        entryKind: "game",
        entryId: game.id,
        label: game.title,
        cover: game.cover,
        coverFallback: game.coverFallback || "",
        wheelScope,
        baseWeight: game.locked
          ? Math.max(1, Math.ceil(Number(game.baseWeight || 1) * 0.5))
          : Number(game.baseWeight || 1),
      }));
    const specials = this.store
      .readJson("specialEntries")
      .filter((entry) => {
        if (!entry.enabled) return false;
        if (entry.wheelScope !== wheelScope && entry.wheelScope !== "both") return false;
        if (entry.id === "special-lock-it-in" && session.lockItInCooldownRemaining > 0) return false;
        return true;
      })
      .map((entry) => ({
        entryKind: "special",
        entryId: entry.id,
        label: entry.label,
        cover: "",
        coverFallback: "",
        wheelScope,
        baseWeight: Number(entry.baseWeight || 1),
      }));
    return [...games, ...specials];
  }

  resolveViewersChoice(gameId) {
    const session = this.getSession();
    const pendingChoice = session.pendingChoice;
    if (!pendingChoice) {
      throw new Error("No pending viewer choice");
    }
    const spin = this.findSpin(pendingChoice.spinId);
    if (!spin) {
      throw new Error("Pending spin not found");
    }
    const games = this.getGames();
    const game = games.find((entry) => entry.id === gameId);
    if (!game) {
      throw new Error("Game not found");
    }
    if (game.status !== pendingChoice.wheelScope) {
      throw new Error("Selected game is not on the expected side of the docket");
    }

    if (this.getActiveSpin()) {
      throw new Error("A spin is already active");
    }

    const wheelScope = pendingChoice.wheelScope || (spin.type === "restore" ? "out" : "in");
    const resolvedSpin = {
      id: randomId("spin"),
      type: spin.type,
      status: "reveal",
      startedAt: now(),
      countdownEndsAt: null,
      triggerQueueItemId: null,
      triggerSource: "viewers_choice_resolved",
      viewerName: spin.viewerName || pendingChoice.viewerName || "Viewer",
      entries: [],
      winner: {
        spinSessionId: null,
        entryKind: "game",
        entryId: game.id,
        label: game.title,
        cover: game.cover || "",
        coverFallback: game.coverFallback || "",
        wheelScope,
        baseWeight: Number(game.baseWeight || 1),
        bonusWeight: 0,
        finalWeight: Number(game.baseWeight || 1),
        selectedByViewerChoice: true,
      },
      revealStyle: spin.type,
    };
    resolvedSpin.winner.spinSessionId = resolvedSpin.id;

    const spins = this.getSpins();
    spins.push(resolvedSpin);
    this.setSpins(spins);
    this.updateSession({ activeSpinId: resolvedSpin.id, pendingChoice: null });
    this.scheduleComplete(resolvedSpin.id, Number(this.getWheelConfig().revealDurationMs || 5000));
    this.record("spin.viewers_choice_resolved", {
      sourceSpinId: spin.id,
      spinId: resolvedSpin.id,
      gameId: game.id,
    });
    return resolvedSpin;
  }

  resolveLockItIn(gameId) {
    const session = this.getSession();
    const pendingLockItIn = session.pendingLockItIn;
    if (!pendingLockItIn) {
      throw new Error("No pending lock-it-in");
    }
    const games = this.getGames();
    const game = games.find((g) => g.id === gameId);
    if (!game) {
      throw new Error("Game not found");
    }
    if (game.status !== "in") {
      throw new Error("Game must be on the in-wheel to lock");
    }
    const originalSpin = this.findSpin(pendingLockItIn.spinId);

    for (const g of games) g.locked = false;
    game.locked = true;
    this.setGames(games);

    this.updateSession({
      pendingLockItIn: null,
      lockItInCooldownRemaining: 1,
    });

    this.record("spin.lock_it_in_resolved", {
      spinId: pendingLockItIn.spinId,
      gameId: game.id,
    });

    this.startLockItInReveal(game, originalSpin);
  }

  startLockItInReveal(game, originalSpin) {
    if (this.getActiveSpin()) {
      throw new Error("A spin is already active");
    }
    const spin = {
      id: randomId("spin"),
      type: originalSpin ? originalSpin.type : "eliminate",
      status: "reveal",
      startedAt: now(),
      countdownEndsAt: null,
      triggerQueueItemId: null,
      triggerSource: "lock_it_in",
      viewerName: originalSpin ? originalSpin.viewerName : "Streamer",
      entries: [],
      winner: {
        spinSessionId: null,
        entryKind: "game",
        entryId: game.id,
        label: game.title,
        cover: game.cover || "",
        coverFallback: game.coverFallback || "",
        wheelScope: "in",
        baseWeight: Number(game.baseWeight || 1),
        bonusWeight: 0,
        finalWeight: Number(game.baseWeight || 1),
        lockedByLockItIn: true,
      },
      revealStyle: "lock_it_in",
    };
    spin.winner.spinSessionId = spin.id;

    const spins = this.getSpins();
    spins.push(spin);
    this.setSpins(spins);
    this.updateSession({ activeSpinId: spin.id });

    const revealMs = Number(this.getWheelConfig().lockItInRevealMs ?? 3500);
    const timerId = `lock-reveal-${spin.id}`;
    this.timers.set(timerId, setTimeout(() => {
      this.timers.delete(timerId);
      try {
        const currentSpin = this.findSpin(spin.id);
        if (currentSpin) {
          currentSpin.status = "complete";
          this.upsertSpin(currentSpin);
        }
        this.updateSession({ activeSpinId: null });
        this.record("spin.lock_reveal_completed", { spinId: spin.id });
        this.startLockItInReSpin(originalSpin);
        this.onStateChange?.();
      } catch (error) {
        this.record("spin.error", { spinId: spin.id, message: error.message });
        this.updateSession({ activeSpinId: null });
        this.onStateChange?.();
      }
    }, Math.max(500, revealMs)));

    return spin;
  }

  startLockItInReSpin(originalSpin) {
    if (this.getActiveSpin()) {
      throw new Error("A spin is already active");
    }
    const actionType = originalSpin?.type === "next_game" ? "eliminate" : (originalSpin?.type || "eliminate");
    const entries = this.buildEligibleEntries("in");
    const session = this.getSession();
    if (session.lockItInCooldownRemaining > 0) {
      this.updateSession({ lockItInCooldownRemaining: session.lockItInCooldownRemaining - 1 });
    }
    if (!entries.length) {
      throw new Error("No eligible entries available for re-spin");
    }
    const snapshots = entries.map((entry) => ({
      spinSessionId: null,
      entryKind: entry.entryKind,
      entryId: entry.entryId,
      label: entry.label,
      cover: entry.cover,
      coverFallback: entry.coverFallback || "",
      wheelScope: entry.wheelScope || "in",
      baseWeight: entry.baseWeight,
      bonusWeight: 0,
      finalWeight: entry.baseWeight,
    }));
    const winner = pickWeighted(snapshots, this.random);
    const displayEntries = shuffleEntries(snapshots, this.random);
    const spin = {
      id: randomId("spin"),
      type: actionType,
      status: "spinning",
      startedAt: now(),
      countdownEndsAt: null,
      triggerQueueItemId: null,
      triggerSource: "lock_it_in_respun",
      viewerName: originalSpin ? originalSpin.viewerName : "Streamer",
      entries: displayEntries.map((entry) => ({ ...entry })),
      winner: { ...winner },
      revealStyle: actionType,
    };
    for (const entry of spin.entries) {
      entry.spinSessionId = spin.id;
    }
    spin.winner.spinSessionId = spin.id;
    const spins = this.getSpins();
    spins.push(spin);
    this.setSpins(spins);
    this.updateSession({ activeSpinId: spin.id });
    this.scheduleReveal(spin.id, Number(this.getWheelConfig().spinDurationMs || 6500));
    this.record("spin.lock_it_in_respun", { spinId: spin.id });
    return spin;
  }

  toggleGameLock(gameId) {
    const games = this.getGames();
    const game = games.find((g) => g.id === gameId);
    if (!game) {
      throw new Error("Game not found");
    }
    if (game.status !== "in") {
      throw new Error("Only in-wheel games can be locked");
    }
    if (game.locked) {
      game.locked = false;
      this.setGames(games);
      this.record("game.unlocked", { gameId });
    } else {
      for (const g of games) {
        g.locked = false;
      }
      game.locked = true;
      this.setGames(games);
      this.record("game.locked", { gameId });
    }
    return game;
  }

  skipLockItIn() {
    const session = this.getSession();
    if (!session.pendingLockItIn) {
      throw new Error("No pending lock-it-in");
    }
    this.updateSession({ pendingLockItIn: null });
    this.record("spin.lock_it_in_skipped", { spinId: session.pendingLockItIn.spinId });
  }

  toggleOverlayHidden() {
    const session = this.getSession();
    this.updateSession({ overlayHidden: !session.overlayHidden });
    this.record("overlay.visibility_toggled", { overlayHidden: !session.overlayHidden });
  }

  findSpin(id) {
    return this.getSpins().find((entry) => entry.id === id) || null;
  }

  upsertSpin(spin) {
    const spins = this.getSpins();
    const index = spins.findIndex((entry) => entry.id === spin.id);
    if (index === -1) {
      spins.push(spin);
    } else {
      spins[index] = spin;
    }
    this.setSpins(spins);
  }

  scheduleCountdown(spinId, delayMs) {
    this.clearTimer(spinId);
    const timer = setTimeout(() => {
      try {
        this.resolveCountdownSpin(spinId);
      } catch (error) {
        this.record("spin.error", { spinId, message: error.message });
      }
    }, Math.max(0, delayMs));
    this.timers.set(spinId, timer);
  }

  scheduleReveal(spinId, delayMs) {
    this.clearTimer(spinId);
    const timer = setTimeout(() => {
      const spin = this.findSpin(spinId);
      if (!spin) {
        return;
      }
      spin.status = "reveal";
      this.upsertSpin(spin);
      this.onStateChange?.();
      this.scheduleComplete(spinId, Number(this.getWheelConfig().revealDurationMs || 5000));
    }, Math.max(0, delayMs));
    this.timers.set(spinId, timer);
  }

  scheduleComplete(spinId, delayMs) {
    this.clearTimer(spinId);
    const timer = setTimeout(() => {
      try {
        this.completeSpin(spinId);
        this.onStateChange?.();
      } catch (error) {
        this.record("spin.error", { spinId, message: error.message });
      }
    }, Math.max(0, delayMs));
    this.timers.set(spinId, timer);
  }

  getRevealAt(spin, wheelConfig = this.getWheelConfig()) {
    return new Date(
      new Date(spin.startedAt).getTime() + Number(wheelConfig.spinDurationMs || 6500),
    ).toISOString();
  }

  getCompleteAt(spin, wheelConfig = this.getWheelConfig()) {
    return new Date(
      new Date(spin.startedAt).getTime() +
        Number(wheelConfig.spinDurationMs || 6500) +
        Number(wheelConfig.revealDurationMs || 5000),
    ).toISOString();
  }

  clearTimer(spinId) {
    const timer = this.timers.get(spinId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(spinId);
    }
  }

  record(type, payload) {
    this.store.appendEvent({
      type,
      payload,
      at: now(),
    });
  }
}

module.exports = {
  DocketState,
  GAME_STATUSES,
  OVERRIDE_GAME_STATUSES,
};
