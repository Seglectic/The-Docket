const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { deriveWheelProfile } = require("../client/overlay/spin-plan");
const { ROOT } = require("./config");
const {
  FILES,
  STORAGE_LIMIT_BYTES,
  SPIN_RETENTION_MS,
  EVENT_RETENTION_MS,
} = require("./storage");

const STATE_KEYS = Object.keys(FILES).filter((key) => key !== "events");
const STORAGE_SUMMARY_CACHE_MS = 5000;
const EVENT_PRUNE_INTERVAL_MS = 1000 * 60 * 60 * 12;
const MAX_CACHE_QUERIES = 150;
const SEED_PATH = path.join(ROOT, "data", "games.seed.json");

class PostgresStore {
  constructor(config, options = {}) {
    this.config = config;
    this.storageMode = "postgres";
    this.connectionString =
      options.connectionString ||
      config.storage?.postgres?.connectionString ||
      process.env.POSTGRES_URL ||
      process.env.DATABASE_URL ||
      "";
    if (!this.connectionString) {
      throw new Error("Postgres storage requires POSTGRES_URL, DATABASE_URL, or storage.postgres.connectionString");
    }

    this.pool =
      options.pool ||
      new Pool({
        connectionString: this.connectionString,
        ssl: resolveSsl(config.storage?.postgres?.ssl),
      });

    this.cache = {};
    this.pending = Promise.resolve();
    this.lastEventPruneAt = 0;
    this.lastStorageSummaryAt = 0;
    this.cachedStorageSummary = null;
    this.eventLogBytes = 0;
  }

  async ensure() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS docket_state (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS docket_events (
        id BIGSERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL,
        event JSONB NOT NULL
      );
    `);

    const defaults = {
      games: this.readSeedGames(),
      specialEntries: this.applyConfigToSpecialEntries(DEFAULT_SPECIAL_ENTRIES),
      wheelConfig: this.defaultWheelConfig(),
      gameDbCache: { provider: null, entries: {} },
      gameDbSettings: this.defaultGameDbSettings(),
      twitchAuth: { connected: false },
      queue: [],
      spins: [],
      session: { activeSpinId: null },
    };

    const result = await this.pool.query("SELECT key, value FROM docket_state");
    for (const row of result.rows) {
      this.cache[row.key] = row.value;
    }

    for (const key of STATE_KEYS) {
      if (this.cache[key] === undefined) {
        this.cache[key] = clone(defaults[key]);
        await this.pool.query(
          `
            INSERT INTO docket_state (key, value)
            VALUES ($1, $2::jsonb)
            ON CONFLICT (key) DO NOTHING
          `,
          [key, JSON.stringify(this.cache[key])],
        );
      }
    }

    await this.pruneEvents();
    const normalizedSpins = this.normalizeSpins(this.cache.spins || []);
    if (JSON.stringify(normalizedSpins) !== JSON.stringify(this.cache.spins || [])) {
      this.writeJson("spins", normalizedSpins);
      await this.whenIdle();
    }
    await this.refreshStorageSummary(true);
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

  readJson(key) {
    return clone(this.cache[key]);
  }

  writeJson(key, value) {
    const nextValue = key === "spins" ? this.normalizeSpins(value) : clone(value);
    if (key === "gameDbCache") {
      nextValue.entries = Object.fromEntries(
        Object.entries(nextValue.entries || {})
          .sort((a, b) => Number(b[1]?.cachedAt || 0) - Number(a[1]?.cachedAt || 0))
          .slice(0, MAX_CACHE_QUERIES),
      );
    }
    this.cache[key] = nextValue;
    this.invalidateStorageSummary();
    this.enqueue(async () => {
      await this.pool.query(
        `
          INSERT INTO docket_state (key, value, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT (key)
          DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `,
        [key, JSON.stringify(nextValue)],
      );
    });
  }

  normalizeSpins(spins) {
    const cutoff = Date.now() - SPIN_RETENTION_MS;
    const kept = (Array.isArray(spins) ? spins : []).filter((spin) => {
      const timestamp = Date.parse(spin.completedAt || spin.startedAt || "");
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    });
    kept.sort((a, b) => new Date(a.startedAt || 0) - new Date(b.startedAt || 0));
    return kept.slice(-2500);
  }

  appendEvent(event) {
    this.eventLogBytes += Buffer.byteLength(`${JSON.stringify(event)}\n`);
    this.invalidateStorageSummary();
    this.enqueue(async () => {
      await this.pool.query("INSERT INTO docket_events (at, event) VALUES ($1, $2::jsonb)", [
        event.at,
        JSON.stringify(event),
      ]);
      if (Date.now() - this.lastEventPruneAt >= EVENT_PRUNE_INTERVAL_MS) {
        await this.pruneEvents();
      }
    });
  }

  async pruneEvents() {
    const cutoff = new Date(Date.now() - EVENT_RETENTION_MS).toISOString();
    await this.pool.query("DELETE FROM docket_events WHERE at < $1::timestamptz", [cutoff]);
    this.lastEventPruneAt = Date.now();
    await this.refreshStorageSummary(true);
  }

  getStorageSummary() {
    if (this.cachedStorageSummary && Date.now() - this.lastStorageSummaryAt < STORAGE_SUMMARY_CACHE_MS) {
      return clone(this.cachedStorageSummary);
    }

    const summary = {
      limitBytes: STORAGE_LIMIT_BYTES,
      totalBytes: 0,
      percentUsed: 0,
      breakdown: {
        coversBytes: 0,
        eventLogBytes: this.eventLogBytes,
        spinsBytes: sizeOfJson(this.cache.spins || []),
        runtimeBytes: 0,
        otherBytes: 0,
      },
    };

    for (const key of STATE_KEYS) {
      const bytes = sizeOfJson(this.cache[key]);
      if (key === "spins") {
        continue;
      }
      summary.breakdown.runtimeBytes += bytes;
    }

    summary.totalBytes =
      summary.breakdown.coversBytes +
      summary.breakdown.eventLogBytes +
      summary.breakdown.spinsBytes +
      summary.breakdown.runtimeBytes;
    summary.percentUsed = Math.min(100, (summary.totalBytes / STORAGE_LIMIT_BYTES) * 100);
    this.cachedStorageSummary = summary;
    this.lastStorageSummaryAt = Date.now();
    return clone(summary);
  }

  async refreshStorageSummary(force = false) {
    if (!force && this.cachedStorageSummary && Date.now() - this.lastStorageSummaryAt < STORAGE_SUMMARY_CACHE_MS) {
      return this.getStorageSummary();
    }

    const result = await this.pool.query("SELECT COALESCE(SUM(OCTET_LENGTH(event::text) + 1), 0) AS bytes FROM docket_events");
    this.eventLogBytes = Number(result.rows[0]?.bytes || 0);
    this.invalidateStorageSummary();
    return this.getStorageSummary();
  }

  invalidateStorageSummary() {
    this.cachedStorageSummary = null;
    this.lastStorageSummaryAt = 0;
  }

  enqueue(task) {
    const next = this.pending.then(task);
    this.pending = next.catch(() => {});
    return next;
  }

  whenIdle() {
    return this.pending;
  }
}

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

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sizeOfJson(value) {
  return Buffer.byteLength(JSON.stringify(value === undefined ? null : value));
}

function resolveSsl(value) {
  if (value === false) {
    return false;
  }
  return { rejectUnauthorized: false };
}

module.exports = {
  PostgresStore,
};
