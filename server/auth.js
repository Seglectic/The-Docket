const crypto = require("node:crypto");
const { parseCookies } = require("./utils");

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

class AuthManager {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
  }

  login(secret) {
    const expected = this.config.auth?.sharedSecret || "";
    // Hash both sides so timingSafeEqual always compares fixed-length buffers.
    const a = crypto.createHash("sha256").update(secret || "").digest();
    const b = crypto.createHash("sha256").update(expected).digest();
    if (!crypto.timingSafeEqual(a, b)) {
      throw new Error("Invalid shared secret");
    }
    const token = crypto.randomUUID();
    this.sessions.set(token, { createdAt: Date.now() });
    return token;
  }

  logout(token) {
    if (token) {
      this.sessions.delete(token);
    }
  }

  requireAuth(req) {
    const cookies = parseCookies(req.headers.cookie || "");
    const token = cookies.docket_session;
    const session = token && this.sessions.get(token);
    if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) {
      if (session) {
        this.sessions.delete(token);
      }
      const error = new Error("Unauthorized");
      error.statusCode = 401;
      throw error;
    }
    return token;
  }
}

module.exports = {
  AuthManager,
};
