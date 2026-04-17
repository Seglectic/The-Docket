const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./config");

const DATA_DIR = path.join(ROOT, "data");
const SEED_PATH = path.join(DATA_DIR, "games.seed.json");

const FILES = {
  games: "games.json",
  specialEntries: "special-entries.json",
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
  }

  ensure() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const defaults = {
      games: this.readSeedGames(),
      specialEntries: this.applyConfigToSpecialEntries(DEFAULT_SPECIAL_ENTRIES),
      queue: [],
      spins: [],
      session: { activeSpinId: null },
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
  }

  readJson(key) {
    return JSON.parse(fs.readFileSync(this.fullPath(key), "utf8"));
  }

  writeJson(key, value) {
    this.atomicWrite(this.fullPath(key), value);
  }

  appendEvent(event) {
    fs.appendFileSync(this.fullPath("events"), `${JSON.stringify(event)}\n`, "utf8");
  }
}

module.exports = {
  FileStore,
};
