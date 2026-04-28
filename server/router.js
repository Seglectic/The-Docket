const fs = require("node:fs");
const path = require("node:path");
const { clearCookie, jsonResponse, readBody, setCookie } = require("./utils");
const { randomTestRedeem } = require("./generateTest");

// Simple in-memory rate limiter for the login endpoint.
// 5 attempts per IP per 15-minute window; resets after the window.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= LOGIN_MAX_ATTEMPTS;
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    jsonResponse(res, 404, { error: "Not found" });
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(res);
}

function createRouter({
  rootDir,
  auth,
  state,
  broadcaster,
  gameDatabase = { searchGames: async () => ({ enabled: false, configured: false, provider: "igdb", suggestions: [] }) },
  twitchAuth = { getPublicState: () => ({ configured: false, connected: false }), startAuthorization: () => "", completeAuthorization: async () => ({}), disconnect: () => ({ connected: false }) },
  twitchEventSub = { restart: async () => {}, stop: () => {} },
  buildAdminState = () => state.controllerSnapshot(),
}) {
  return async function route(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;

      if (pathname === "/") {
        res.writeHead(302, { Location: "/public" });
        res.end();
        return;
      }

      if (pathname === "/controller") {
        sendFile(res, path.join(rootDir, "client/controller/index.html"));
        return;
      }
      if (pathname === "/overlay") {
        sendFile(res, path.join(rootDir, "client/overlay/index.html"));
        return;
      }
      if (pathname === "/public") {
        sendFile(res, path.join(rootDir, "client/public/index.html"));
        return;
      }
      if (pathname.startsWith("/client/")) {
        sendFile(res, path.join(rootDir, pathname));
        return;
      }
      if (pathname.startsWith("/public/assets/")) {
        sendFile(res, path.join(rootDir, pathname));
        return;
      }
      if (pathname.startsWith("/media/covers/")) {
        if (!state.store.dataDir) {
          jsonResponse(res, 404, { error: "Not found" });
          return;
        }
        sendFile(res, path.join(state.store.dataDir, "media", "covers", path.basename(pathname)));
        return;
      }

      if (pathname === "/api/login" && req.method === "POST") {
        const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
        if (!checkLoginRateLimit(ip)) {
          jsonResponse(res, 429, { error: "Too many login attempts. Try again later." });
          return;
        }
        const body = await readBody(req);
        const token = auth.login(body.secret);
        setCookie(res, "docket_session", token, { maxAge: 60 * 60 * 24 * 30, secure: true });
        jsonResponse(res, 200, { ok: true });
        return;
      }

      if (pathname === "/api/logout" && req.method === "POST") {
        try {
          const token = auth.requireAuth(req);
          auth.logout(token);
        } catch (_) {
          // Ignore missing session on logout.
        }
        clearCookie(res, "docket_session");
        jsonResponse(res, 200, { ok: true });
        return;
      }

      if (pathname === "/api/public-state" && req.method === "GET") {
        jsonResponse(res, 200, state.publicSnapshot());
        return;
      }

      if (pathname === "/api/admin/state" && req.method === "GET") {
        auth.requireAuth(req);
        jsonResponse(res, 200, buildAdminState());
        return;
      }

      if (pathname === "/auth/twitch/start" && req.method === "GET") {
        const sessionToken = auth.requireAuth(req);
        const authorizeUrl = twitchAuth.startAuthorization(sessionToken);
        res.writeHead(302, { Location: authorizeUrl });
        res.end();
        return;
      }

      if (pathname === "/auth/twitch/callback" && req.method === "GET") {
        try {
          await twitchAuth.completeAuthorization({
            code: url.searchParams.get("code") || "",
            state: url.searchParams.get("state") || "",
          });
          await state.store.whenIdle();
          await twitchEventSub.restart();
          broadcaster();
          res.writeHead(302, { Location: "/controller?twitch=connected" });
          res.end();
        } catch (error) {
          const message = encodeURIComponent(error.message || "Twitch connection failed");
          res.writeHead(302, { Location: `/controller?twitch_error=${message}` });
          res.end();
        }
        return;
      }

      if (pathname === "/api/twitch/disconnect" && req.method === "POST") {
        auth.requireAuth(req);
        const result = twitchAuth.disconnect();
        await state.store.whenIdle();
        twitchEventSub.stop();
        broadcaster();
        jsonResponse(res, 200, result);
        return;
      }

      if (pathname === "/api/game-db/search" && req.method === "GET") {
        auth.requireAuth(req);
        const results = await gameDatabase.searchGames(url.searchParams.get("q") || "");
        jsonResponse(res, 200, results);
        return;
      }

      if (pathname === "/api/game-db/settings" && req.method === "GET") {
        auth.requireAuth(req);
        jsonResponse(res, 200, gameDatabase.publicSettings());
        return;
      }

      if (pathname === "/api/game-db/settings" && req.method === "POST") {
        auth.requireAuth(req);
        const body = await readBody(req);
        const settings = gameDatabase.updateSettings(body);
        await state.store.whenIdle();
        broadcaster();
        jsonResponse(res, 200, settings);
        return;
      }

      if (pathname === "/api/queue" && req.method === "POST") {
        auth.requireAuth(req);
        const body = await readBody(req);
        const item = state.addQueueItem(body);
        await state.store.whenIdle();
        broadcaster();
        jsonResponse(res, 201, item);
        return;
      }

      if (pathname === "/api/queue/test" && req.method === "POST") {
        auth.requireAuth(req);
        const item = state.addQueueItem(randomTestRedeem());
        await state.store.whenIdle();
        broadcaster();
        jsonResponse(res, 201, item);
        return;
      }

      if (pathname.startsWith("/api/queue/") && pathname.endsWith("/start") && req.method === "POST") {
        auth.requireAuth(req);
        const id = pathname.split("/")[3];
        const spin = state.startQueueSpin(id);
        await state.store.whenIdle();
        broadcaster();
        jsonResponse(res, 200, spin);
        return;
      }

      if (pathname.startsWith("/api/queue/") && pathname.endsWith("/cancel") && req.method === "POST") {
        auth.requireAuth(req);
        const id = pathname.split("/")[3];
        const item = state.cancelQueueItem(id);
        await state.store.whenIdle();
        broadcaster();
        jsonResponse(res, 200, item);
        return;
      }

      if (pathname === "/api/spins/next-game" && req.method === "POST") {
        auth.requireAuth(req);
        const spin = state.startNextGameSpin();
        await state.store.whenIdle();
        broadcaster();
        jsonResponse(res, 201, spin);
        return;
      }

      if (pathname === "/api/spins/force-resolve" && req.method === "POST") {
        auth.requireAuth(req);
        const spin = state.forceResolveActiveSpin();
        await state.store.whenIdle();
        broadcaster();
        jsonResponse(res, 200, spin);
        return;
      }

      if (pathname === "/api/spins/add-weight" && req.method === "POST") {
        auth.requireAuth(req);
        const body = await readBody(req);
        const spin = state.addWeightToActiveSpin(body);
        await state.store.whenIdle();
        broadcaster();
        jsonResponse(res, 200, spin);
        return;
      }

      if (pathname === "/api/spins/viewers-choice" && req.method === "POST") {
        auth.requireAuth(req);
        const body = await readBody(req);
        const spin = state.resolveViewersChoice(body.gameId);
        await state.store.whenIdle();
        broadcaster();
        jsonResponse(res, 200, spin);
        return;
      }

      if (pathname === "/api/games" && req.method === "POST") {
        auth.requireAuth(req);
        const body = await readBody(req);
        const game = state.upsertGame(body);
        await state.store.whenIdle();
        broadcaster();
        jsonResponse(res, 201, game);
        return;
      }

      if (pathname === "/api/games/override" && req.method === "POST") {
        auth.requireAuth(req);
        const body = await readBody(req);
        const game = state.setOverrideGame(body.gameId || null);
        await state.store.whenIdle();
        broadcaster();
        jsonResponse(res, 200, { game });
        return;
      }

      if (pathname.startsWith("/api/games/") && req.method === "DELETE") {
        auth.requireAuth(req);
        const id = pathname.split("/")[3];
        state.deleteGame(id);
        await state.store.whenIdle();
        broadcaster();
        jsonResponse(res, 200, { ok: true });
        return;
      }

      if (pathname === "/api/games/reorder" && req.method === "POST") {
        auth.requireAuth(req);
        const body = await readBody(req);
        const games = state.reorderGames(body.order || []);
        await state.store.whenIdle();
        broadcaster();
        jsonResponse(res, 200, games);
        return;
      }

      if (pathname === "/api/wheel-config" && req.method === "POST") {
        auth.requireAuth(req);
        const body = await readBody(req);
        const wheelConfig = state.updateWheelConfig(body);
        await state.store.whenIdle();
        broadcaster();
        jsonResponse(res, 200, wheelConfig);
        return;
      }

      jsonResponse(res, 404, { error: "Not found" });
    } catch (error) {
      const statusCode = error.statusCode || 400;
      jsonResponse(res, statusCode, { error: error.message });
    }
  };
}

module.exports = {
  createRouter,
};
