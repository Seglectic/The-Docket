const crypto = require("node:crypto");
const { parseCookies } = require("./utils");

class AuthManager {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
  }

  login(secret) {
    if (secret !== this.config.auth?.sharedSecret) {
      throw new Error("Invalid shared secret");
    }
    const token = crypto.randomUUID();
    this.sessions.set(token, {
      createdAt: Date.now(),
    });
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
    if (!token || !this.sessions.has(token)) {
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
