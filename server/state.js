const { now, pickWeighted, randomId } = require("./utils");
const { deriveWheelProfile } = require("../client/overlay/spin-plan");

class DocketState {
  constructor(store, config, options = {}) {
    this.store = store;
    this.config = config;
    this.random = options.random || Math.random;
    this.timers = new Map();
    this.sessions = new Map();
  }

  bootstrap() {
    this.store.ensure();
    this.ensureWheelConfig();
    this.cleanupPersistedQueue();
    this.recoverActiveSpin();
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
    return {
      games: state.games,
      activeSpin: state.activeSpin,
      lastCompletedSpin: state.lastCompletedSpin,
      overlayTitle: state.config.overlayTitle,
      wheelConfig: state.config.wheel || {},
    };
  }

  controllerSnapshot() {
    const state = this.snapshot();
    return {
      ...state,
      rewards: this.config.rewards || {},
      assets: this.config.assets || {},
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
    const needsNormalization =
      !current ||
      !current.physics ||
      !current.timings ||
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
    this.store.writeJson("spins", spins);
  }

  getSession() {
    return this.store.readJson("session");
  }

  setSession(session) {
    this.store.writeJson("session", session);
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
    if (existing) {
      Object.assign(existing, {
        title: input.title,
        cover: input.cover || "",
        status: input.status,
        baseWeight: Number(input.baseWeight || 1),
        sortOrder: Number(input.sortOrder || existing.sortOrder || games.length + 1),
        locked: Boolean(input.locked),
      });
      this.setGames(games);
      this.record("game.updated", { id: existing.id });
      return existing;
    }
    const game = {
      id: input.id || randomId("game"),
      title: input.title,
      cover: input.cover || "",
      status: input.status || "in",
      baseWeight: Number(input.baseWeight || 1),
      sortOrder: Number(input.sortOrder || games.length + 1),
      locked: Boolean(input.locked),
    };
    games.push(game);
    this.setGames(games);
    this.record("game.created", { id: game.id });
    return game;
  }

  deleteGame(id) {
    const games = this.getGames().filter((entry) => entry.id !== id);
    this.setGames(games);
    this.record("game.deleted", { id });
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

  startNextGameSpin(triggerSource = "manual") {
    if (this.getActiveSpin()) {
      throw new Error("A spin is already active");
    }
    const countdownMs = Number(this.getWheelConfig().countdownSeconds || 10) * 1000;
    const games = this.buildEligibleEntries("in");
    if (!games.length) {
      throw new Error("No eligible entries available");
    }
    const spin = {
      id: randomId("spin"),
      type: "next_game",
      status: "countdown",
      startedAt: now(),
      countdownEndsAt: new Date(Date.now() + countdownMs).toISOString(),
      triggerQueueItemId: null,
      triggerSource,
      viewerName: "Streamer",
      entries: games.map((entry) => ({
        spinSessionId: null,
        entryKind: entry.entryKind,
        entryId: entry.entryId,
        label: entry.label,
        cover: entry.cover,
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
    this.setSession({ activeSpinId: spin.id });
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
      this.setSession({ activeSpinId: null });
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
    this.setSession({ activeSpinId: null });
  }

  createImmediateSpin(actionType, queueItem) {
    const wheelScope = actionType === "restore" ? "out" : "in";
    const entries = this.buildEligibleEntries(wheelScope);
    if (!entries.length) {
      throw new Error("No eligible entries available");
    }
    const snapshots = entries.map((entry) => ({
      spinSessionId: null,
      entryKind: entry.entryKind,
      entryId: entry.entryId,
      label: entry.label,
      cover: entry.cover,
      baseWeight: entry.baseWeight,
      bonusWeight: 0,
      finalWeight: entry.baseWeight,
    }));
    const winner = pickWeighted(snapshots, this.random);
    const spin = {
      id: randomId("spin"),
      type: actionType,
      status: "spinning",
      startedAt: now(),
      countdownEndsAt: null,
      triggerQueueItemId: queueItem.id,
      triggerSource: queueItem.source,
      viewerName: queueItem.viewerName,
      entries: snapshots.map((entry) => ({ ...entry })),
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
    this.setSession({ activeSpinId: spin.id });
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
      }
    }

    if ((spin.type === "eliminate" || spin.type === "next_game") && spin.winner.entryKind === "game") {
      const game = games.find((entry) => entry.id === spin.winner.entryId);
      if (game && spin.type === "eliminate") {
        if (!game.locked) {
          game.status = "out";
        }
      }
    }

    if ((spin.type === "eliminate" || spin.type === "next_game") && spin.winner.entryKind === "special") {
      const game = games.find((entry) => entry.id === spin.winner.entryId);
      if (!game && spin.winner.entryId === "special-lock-it-in") {
        const candidates = games.filter((entry) => entry.status === "in");
        if (candidates.length) {
          candidates[0].locked = true;
        }
      }
    }

    this.setGames(games);
    if (queueItem) {
      this.setQueue(queue.filter((entry) => entry.id !== queueItem.id));
    }
  }

  buildEligibleEntries(wheelScope) {
    const games = this.getGames()
      .filter((game) => game.status === wheelScope)
      .map((game) => ({
        entryKind: "game",
        entryId: game.id,
        label: game.title,
        cover: game.cover,
        baseWeight: Number(game.baseWeight || 1),
      }));
    const specials = this.store
      .readJson("specialEntries")
      .filter((entry) => entry.enabled && entry.wheelScope === wheelScope)
      .map((entry) => ({
        entryKind: "special",
        entryId: entry.id,
        label: entry.label,
        cover: "",
        baseWeight: Number(entry.baseWeight || 1),
      }));
    return [...games, ...specials];
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
      this.scheduleComplete(spinId, Number(this.getWheelConfig().revealDurationMs || 5000));
    }, Math.max(0, delayMs));
    this.timers.set(spinId, timer);
  }

  scheduleComplete(spinId, delayMs) {
    this.clearTimer(spinId);
    const timer = setTimeout(() => {
      try {
        this.completeSpin(spinId);
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
};
