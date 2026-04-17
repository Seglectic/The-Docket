const fs = require("node:fs");
const path = require("node:path");
const { parseYaml } = require("./simple-yaml");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_DIR = path.join(ROOT, "config");
const EXAMPLE_PATH = path.join(CONFIG_DIR, "config.example.yaml");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.yaml");

function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
  }
}

function loadConfig() {
  ensureConfig();
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const config = parseYaml(raw);
  return applyEnvOverrides(config);
}

function applyEnvOverrides(config) {
  const next = {
    ...config,
    server: {
      ...(config.server || {}),
    },
    auth: {
      ...(config.auth || {}),
    },
    storage: {
      ...(config.storage || {}),
      postgres: {
        ...(config.storage?.postgres || {}),
      },
    },
    twitch: {
      ...(config.twitch || {}),
      app: {
        ...(config.twitch?.app || {}),
      },
    },
    gameDatabase: {
      ...(config.gameDatabase || {}),
      igdb: {
        ...(config.gameDatabase?.igdb || {}),
      },
    },
  };

  if (process.env.HOST) {
    next.server.host = process.env.HOST;
  }
  if (process.env.PORT) {
    next.server.port = Number(process.env.PORT);
  }
  if (process.env.DOCKET_STORAGE_DRIVER) {
    next.storage.driver = process.env.DOCKET_STORAGE_DRIVER;
  }
  if (process.env.POSTGRES_URL || process.env.DATABASE_URL) {
    next.storage.postgres.connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  }
  if (process.env.AUTH_SHARED_SECRET) {
    next.auth.sharedSecret = process.env.AUTH_SHARED_SECRET;
  }
  if (process.env.TWITCH_ENABLED) {
    next.twitch.enabled = process.env.TWITCH_ENABLED === "true";
  }
  if (process.env.TWITCH_BROADCASTER_LOGIN) {
    next.twitch.broadcasterLogin = process.env.TWITCH_BROADCASTER_LOGIN;
  }
  if (process.env.TWITCH_SCOPES) {
    next.twitch.scopes = process.env.TWITCH_SCOPES;
  }
  if (process.env.TWITCH_CLIENT_ID) {
    next.twitch.app.clientId = process.env.TWITCH_CLIENT_ID;
  }
  if (process.env.TWITCH_CLIENT_SECRET) {
    next.twitch.app.clientSecret = process.env.TWITCH_CLIENT_SECRET;
  }
  if (process.env.TWITCH_REDIRECT_URI) {
    next.twitch.app.redirectUri = process.env.TWITCH_REDIRECT_URI;
  }
  if (process.env.GAME_DB_ENABLED) {
    next.gameDatabase.enabled = process.env.GAME_DB_ENABLED === "true";
  }
  if (process.env.IGDB_CLIENT_ID) {
    next.gameDatabase.igdb.clientId = process.env.IGDB_CLIENT_ID;
  }
  if (process.env.IGDB_CLIENT_SECRET) {
    next.gameDatabase.igdb.clientSecret = process.env.IGDB_CLIENT_SECRET;
  }

  if (!next.server.host) {
    next.server.host = "0.0.0.0";
  }
  if (!Number.isFinite(Number(next.server.port))) {
    next.server.port = 3030;
  }

  return next;
}

module.exports = {
  CONFIG_PATH,
  ROOT,
  loadConfig,
};
