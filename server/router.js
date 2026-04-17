const fs = require("node:fs");
const path = require("node:path");
const { clearCookie, jsonResponse, readBody, setCookie } = require("./utils");
const { randomTestRedeem } = require("./generateTest");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
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

function createRouter({ rootDir, auth, state, broadcaster }) {
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

      if (pathname === "/api/login" && req.method === "POST") {
        const body = await readBody(req);
        const token = auth.login(body.secret);
        setCookie(res, "docket_session", token, { maxAge: 60 * 60 * 12 });
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
        jsonResponse(res, 200, state.controllerSnapshot());
        return;
      }

      if (pathname === "/api/queue" && req.method === "POST") {
        auth.requireAuth(req);
        const body = await readBody(req);
        const item = state.addQueueItem(body);
        broadcaster();
        jsonResponse(res, 201, item);
        return;
      }

      if (pathname === "/api/queue/test" && req.method === "POST") {
        auth.requireAuth(req);
        const item = state.addQueueItem(randomTestRedeem());
        broadcaster();
        jsonResponse(res, 201, item);
        return;
      }

      if (pathname.startsWith("/api/queue/") && pathname.endsWith("/start") && req.method === "POST") {
        auth.requireAuth(req);
        const id = pathname.split("/")[3];
        const spin = state.startQueueSpin(id);
        broadcaster();
        jsonResponse(res, 200, spin);
        return;
      }

      if (pathname.startsWith("/api/queue/") && pathname.endsWith("/cancel") && req.method === "POST") {
        auth.requireAuth(req);
        const id = pathname.split("/")[3];
        const item = state.cancelQueueItem(id);
        broadcaster();
        jsonResponse(res, 200, item);
        return;
      }

      if (pathname === "/api/spins/next-game" && req.method === "POST") {
        auth.requireAuth(req);
        const spin = state.startNextGameSpin();
        broadcaster();
        jsonResponse(res, 201, spin);
        return;
      }

      if (pathname === "/api/spins/force-resolve" && req.method === "POST") {
        auth.requireAuth(req);
        const spin = state.forceResolveActiveSpin();
        broadcaster();
        jsonResponse(res, 200, spin);
        return;
      }

      if (pathname === "/api/spins/add-weight" && req.method === "POST") {
        auth.requireAuth(req);
        const body = await readBody(req);
        const spin = state.addWeightToActiveSpin(body);
        broadcaster();
        jsonResponse(res, 200, spin);
        return;
      }

      if (pathname === "/api/games" && req.method === "POST") {
        auth.requireAuth(req);
        const body = await readBody(req);
        const game = state.upsertGame(body);
        broadcaster();
        jsonResponse(res, 201, game);
        return;
      }

      if (pathname.startsWith("/api/games/") && req.method === "DELETE") {
        auth.requireAuth(req);
        const id = pathname.split("/")[3];
        state.deleteGame(id);
        broadcaster();
        jsonResponse(res, 200, { ok: true });
        return;
      }

      if (pathname === "/api/games/reorder" && req.method === "POST") {
        auth.requireAuth(req);
        const body = await readBody(req);
        const games = state.reorderGames(body.order || []);
        broadcaster();
        jsonResponse(res, 200, games);
        return;
      }

      if (pathname === "/api/wheel-config" && req.method === "POST") {
        auth.requireAuth(req);
        const body = await readBody(req);
        const wheelConfig = state.updateWheelConfig(body);
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
