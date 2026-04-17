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
  return parseYaml(raw);
}

module.exports = {
  CONFIG_PATH,
  ROOT,
  loadConfig,
};
