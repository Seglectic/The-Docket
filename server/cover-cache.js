const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_DIR = path.join("media", "covers");
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

class CoverCacheService {
  constructor(store, options = {}) {
    this.store = store;
    this.fetchImpl = options.fetch || globalThis.fetch;
  }

  ensure() {
    fs.mkdirSync(this.mediaDir(), { recursive: true });
  }

  mediaDir() {
    return path.join(this.store.dataDir, DEFAULT_DIR);
  }

  async cacheCover(url, key = "") {
    const remoteUrl = String(url || "").trim();
    if (!remoteUrl || !/^https?:\/\//i.test(remoteUrl) || !this.fetchImpl) {
      return {
        localUrl: "",
        remoteUrl,
        cached: false,
      };
    }

    this.ensure();
    const extension = inferExtension(remoteUrl);
    const fileName = `${safeName(key || "cover")}-${hash(remoteUrl).slice(0, 12)}${extension}`;
    const filePath = path.join(this.mediaDir(), fileName);

    if (!fs.existsSync(filePath)) {
      const response = await this.fetchImpl(remoteUrl);
      if (!response.ok) {
        throw new Error(`Cover download failed (${response.status})`);
      }
      const contentType = response.headers.get("content-type") || "";
      const actualExtension = inferExtension(remoteUrl, contentType);
      const finalPath = actualExtension === extension ? filePath : path.join(this.mediaDir(), `${safeName(key || "cover")}-${hash(remoteUrl).slice(0, 12)}${actualExtension}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(finalPath, buffer);
      return {
        localUrl: `/media/covers/${path.basename(finalPath)}`,
        remoteUrl,
        cached: true,
      };
    }

    return {
      localUrl: `/media/covers/${fileName}`,
      remoteUrl,
      cached: true,
    };
  }
}

function hash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}

function safeName(value) {
  return String(value || "cover")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "cover";
}

function inferExtension(url, contentType = "") {
  const fromType = contentTypeToExtension(contentType);
  if (fromType) {
    return fromType;
  }
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      return ext === ".jpeg" ? ".jpg" : ext;
    }
  } catch (_) {
    // Ignore malformed URLs and fall through.
  }
  return ".jpg";
}

function contentTypeToExtension(contentType) {
  const normalized = String(contentType).toLowerCase();
  if (normalized.includes("image/png")) {
    return ".png";
  }
  if (normalized.includes("image/webp")) {
    return ".webp";
  }
  if (normalized.includes("image/jpeg") || normalized.includes("image/jpg")) {
    return ".jpg";
  }
  return "";
}

module.exports = {
  CoverCacheService,
};
