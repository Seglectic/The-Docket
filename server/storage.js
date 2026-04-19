const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./config");
const { deriveWheelProfile } = require("../client/overlay/spin-plan");

const DATA_DIR = path.join(ROOT, "data");
const SEED_PATH = path.join(DATA_DIR, "games.seed.json");
const STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;
const COVER_CACHE_LIMIT_BYTES = 512 * 1024 * 1024;
const COVER_CACHE_LIMIT_FILES = 1200;
const SPIN_RETENTION_MS = 1000 * 60 * 60 * 24 * 183;
const EVENT_RETENTION_MS = SPIN_RETENTION_MS;
const MAX_SPIN_HISTORY = 2500;
const EVENT_PRUNE_INTERVAL_MS = 1000 * 60 * 60 * 12;
const STORAGE_SUMMARY_CACHE_MS = 5000;

const FILES = {
  games: "games.json",
  specialEntries: "special-entries.json",
  wheelConfig: "wheel-config.json",
  gameDbCache: "game-db-cache.json",
  gameDbSettings: "game-db-settings.json",
  twitchAuth: "twitch-auth.json",
  queue: "queue.json",
  spins: "spins.json",
  session: "session.json",
  events: "events.jsonl",
};

const DEFAULT_SPECIAL_ENTRIES = [
  {
    id: "special-viewers-choice",
    type: "viewers_choice",
    label: "Viewers Choice",
    wheelScope: "out",
    baseWeight: 2,
    enabled: true,
  },
  {
    id: "special-lock-it-in",
    type: "lock_it_in",
    label: "Lock It In",
    wheelScope: "in",
    baseWeight: 2,
    enabled: true,
  },
];

class FileStore {
  constructor(config) {
    this.config = config;
    this.dataDir = DATA_DIR;
    this.storageMode = "file";
    this.lastEventPruneAt = 0;
    this.lastStorageSummaryAt = 0;
    this.cachedStorageSummary = null;
  }

  ensure() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(path.join(this.dataDir, "media", "covers"), { recursive: true });
    const defaults = {
      games: this.readSeedGames(),
      specialEntries: this.applyConfigToSpecialEntries(DEFAULT_SPECIAL_ENTRIES),
      wheelConfig: this.defaultWheelConfig(),
      gameDbCache: { provider: null, entries: {} },
      gameDbSettings: this.defaultGameDbSettings(),
      twitchAuth: { connected: false },
      queue: [],
      spins: [],
      session: { activeSpinId: null, pendingChoice: null },
      events: "",
    };
    for (const [key, fileName] of Object.entries(FILES)) {
      const fullPath = path.join(this.dataDir, fileName);
      if (!fs.existsSync(fullPath)) {
        if (key === "events") {
          fs.writeFileSync(fullPath, "", "utf8");
        } else {
          this.atomicWrite(fullPath, defaults[key]);
        }
      }
    }
    this.pruneEvents();
    this.pruneSpinsFile();
    this.pruneCoverCache();
  }

  defaultWheelConfig() {
    const base = {
      countdownSeconds: Number(this.config.wheel?.countdownSeconds || 10),
      overlayTitle: this.config.wheel?.overlayTitle || "The Docket",
      physics: {
        ...(this.config.wheel?.physics || {}),
      },
    };
    const derived = deriveWheelProfile(base);
    return {
      ...base,
      physics: derived.physics,
      timings: derived.timings,
      spinDurationMs: derived.spinDurationMs,
      revealDurationMs: derived.revealDurationMs,
    };
  }

  defaultGameDbSettings() {
    return {
      enabled: this.config.gameDatabase?.enabled !== false,
      provider: this.config.gameDatabase?.provider || "igdb",
      maxResults: Number(this.config.gameDatabase?.maxResults || 8),
      igdb: {
        clientId: this.config.gameDatabase?.igdb?.clientId || "",
        clientSecret: this.config.gameDatabase?.igdb?.clientSecret || "",
        imageSize: this.config.gameDatabase?.igdb?.imageSize || "cover_big_2x",
      },
    };
  }

  readSeedGames() {
    if (fs.existsSync(SEED_PATH)) {
      return JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
    }
    return [];
  }

  applyConfigToSpecialEntries(entries) {
    return entries.map((entry) => {
      if (entry.type === "viewers_choice" && this.config.specialEntries?.viewersChoice) {
        const cfg = this.config.specialEntries.viewersChoice;
        return {
          ...entry,
          enabled: Boolean(cfg.enabled),
          label: cfg.label || entry.label,
          baseWeight: Number(cfg.baseWeight || entry.baseWeight),
          wheelScope: cfg.wheelScope || entry.wheelScope,
        };
      }
      if (entry.type === "lock_it_in" && this.config.specialEntries?.lockItIn) {
        const cfg = this.config.specialEntries.lockItIn;
        return {
          ...entry,
          enabled: Boolean(cfg.enabled),
          label: cfg.label || entry.label,
          baseWeight: Number(cfg.baseWeight || entry.baseWeight),
          wheelScope: cfg.wheelScope || entry.wheelScope,
        };
      }
      return entry;
    });
  }

  fullPath(key) {
    return path.join(this.dataDir, FILES[key]);
  }

  atomicWrite(filePath, value) {
    const tmpPath = `${filePath}.tmp`;
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    fs.writeFileSync(tmpPath, serialized, "utf8");
    fs.renameSync(tmpPath, filePath);
    this.invalidateStorageSummary();
  }

  readJson(key) {
    return JSON.parse(fs.readFileSync(this.fullPath(key), "utf8"));
  }

  writeJson(key, value) {
    this.atomicWrite(this.fullPath(key), value);
  }

  normalizeSpins(spins) {
    const cutoff = Date.now() - SPIN_RETENTION_MS;
    const kept = (Array.isArray(spins) ? spins : []).filter((spin) => {
      const timestamp = Date.parse(spin.completedAt || spin.startedAt || "");
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    });
    kept.sort((a, b) => new Date(a.startedAt || 0) - new Date(b.startedAt || 0));
    return kept.slice(-MAX_SPIN_HISTORY);
  }

  pruneSpinsFile() {
    const normalized = this.normalizeSpins(this.readJson("spins"));
    this.writeJson("spins", normalized);
    return normalized;
  }

  appendEvent(event) {
    fs.appendFileSync(this.fullPath("events"), `${JSON.stringify(event)}\n`, "utf8");
    this.invalidateStorageSummary();
    if (Date.now() - this.lastEventPruneAt >= EVENT_PRUNE_INTERVAL_MS) {
      this.pruneEvents();
    }
  }

  pruneEvents() {
    const filePath = this.fullPath("events");
    if (!fs.existsSync(filePath)) {
      return;
    }

    const cutoff = Date.now() - EVENT_RETENTION_MS;
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    const kept = [];

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line);
        const timestamp = Date.parse(parsed.at || "");
        if (Number.isFinite(timestamp) && timestamp >= cutoff) {
          kept.push(JSON.stringify(parsed));
        }
      } catch (_) {
        // Skip malformed lines while compacting.
      }
    }

    fs.writeFileSync(filePath, kept.length ? `${kept.join("\n")}\n` : "", "utf8");
    this.lastEventPruneAt = Date.now();
    this.invalidateStorageSummary();
  }

  pruneCoverCache() {
    const coversDir = path.join(this.dataDir, "media", "covers");
    if (!fs.existsSync(coversDir)) {
      return;
    }

    const files = fs
      .readdirSync(coversDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const filePath = path.join(coversDir, entry.name);
        const stats = fs.statSync(filePath);
        return {
          name: entry.name,
          path: filePath,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        };
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs);

    let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    let totalFiles = files.length;

    while (totalFiles > COVER_CACHE_LIMIT_FILES || totalBytes > COVER_CACHE_LIMIT_BYTES) {
      const next = files.shift();
      if (!next) {
        break;
      }
      fs.unlinkSync(next.path);
      totalBytes -= next.size;
      totalFiles -= 1;
    }
    this.invalidateStorageSummary();
  }

  getStorageSummary() {
    if (this.cachedStorageSummary && Date.now() - this.lastStorageSummaryAt < STORAGE_SUMMARY_CACHE_MS) {
      return this.cachedStorageSummary;
    }

    const files = this.walkFiles(this.dataDir);
    const summary = {
      limitBytes: STORAGE_LIMIT_BYTES,
      totalBytes: 0,
      percentUsed: 0,
      breakdown: {
        coversBytes: 0,
        eventLogBytes: 0,
        spinsBytes: 0,
        runtimeBytes: 0,
        otherBytes: 0,
      },
    };

    for (const file of files) {
      summary.totalBytes += file.size;
      if (file.relativePath.startsWith(path.join("media", "covers"))) {
        summary.breakdown.coversBytes += file.size;
      } else if (file.relativePath === FILES.events) {
        summary.breakdown.eventLogBytes += file.size;
      } else if (file.relativePath === FILES.spins) {
        summary.breakdown.spinsBytes += file.size;
      } else if (file.relativePath.endsWith(".json") || file.relativePath.endsWith(".jsonl")) {
        summary.breakdown.runtimeBytes += file.size;
      } else {
        summary.breakdown.otherBytes += file.size;
      }
    }

    summary.breakdown.runtimeBytes -= summary.breakdown.eventLogBytes + summary.breakdown.spinsBytes;
    summary.percentUsed = Math.min(100, (summary.totalBytes / STORAGE_LIMIT_BYTES) * 100);
    this.cachedStorageSummary = summary;
    this.lastStorageSummaryAt = Date.now();
    return summary;
  }

  walkFiles(rootDir, prefix = "") {
    if (!fs.existsSync(rootDir)) {
      return [];
    }

    const files = [];
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
      const fullPath = path.join(rootDir, entry.name);
      const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        files.push(...this.walkFiles(fullPath, relativePath));
        continue;
      }
      const stats = fs.statSync(fullPath);
      files.push({
        path: fullPath,
        relativePath,
        size: stats.size,
      });
    }
    return files;
  }

  invalidateStorageSummary() {
    this.cachedStorageSummary = null;
    this.lastStorageSummaryAt = 0;
  }

  whenIdle() {
    return Promise.resolve();
  }
}

module.exports = {
  FileStore,
  FILES,
  STORAGE_LIMIT_BYTES,
  COVER_CACHE_LIMIT_BYTES,
  COVER_CACHE_LIMIT_FILES,
  SPIN_RETENTION_MS,
  EVENT_RETENTION_MS,
};
