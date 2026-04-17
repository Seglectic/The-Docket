const { FileStore } = require("./storage");
const { PostgresStore } = require("./postgres-store");

function createStore(config) {
  const driver = resolveDriver(config);
  if (driver === "postgres") {
    return new PostgresStore(config);
  }
  return new FileStore(config);
}

function resolveDriver(config) {
  const explicit = String(config.storage?.driver || process.env.DOCKET_STORAGE_DRIVER || "").trim().toLowerCase();
  if (explicit === "file" || explicit === "postgres") {
    return explicit;
  }

  if (process.env.POSTGRES_URL || process.env.DATABASE_URL || config.storage?.postgres?.connectionString) {
    return "postgres";
  }

  return "file";
}

module.exports = {
  createStore,
  resolveDriver,
};
