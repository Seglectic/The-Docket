const crypto = require("node:crypto");

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf("=");
      if (index === -1) {
        return acc;
      }
      const key = decodeURIComponent(part.slice(0, index));
      const value = decodeURIComponent(part.slice(index + 1));
      acc[key] = value;
      return acc;
    }, {});
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request too large"));
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function setCookie(res, name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  if (options.httpOnly !== false) {
    segments.push("HttpOnly");
  }
  segments.push("Path=/");
  segments.push(`SameSite=${options.sameSite || "Lax"}`);
  if (options.maxAge !== undefined) {
    segments.push(`Max-Age=${options.maxAge}`);
  }
  res.setHeader("Set-Cookie", segments.join("; "));
}

function clearCookie(res, name) {
  setCookie(res, name, "", { maxAge: 0 });
}

function randomId(prefix = "id") {
  return `${prefix}-${crypto.randomUUID()}`;
}

function now() {
  return new Date().toISOString();
}

function pickWeighted(entries, random = Math.random) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.finalWeight), 0);
  if (total <= 0) {
    return null;
  }
  let cursor = random() * total;
  for (const entry of entries) {
    cursor -= Math.max(0, entry.finalWeight);
    if (cursor <= 0) {
      return entry;
    }
  }
  return entries.at(-1) || null;
}

module.exports = {
  clearCookie,
  jsonResponse,
  now,
  parseCookies,
  pickWeighted,
  randomId,
  readBody,
  setCookie,
};
