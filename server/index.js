const http = require("node:http");
const path = require("node:path");
const { WebSocketServer } = require("ws");
const { loadConfig, ROOT } = require("./config");
const { FileStore } = require("./storage");
const { DocketState } = require("./state");
const { AuthManager } = require("./auth");
const { createRouter } = require("./router");
const { GameDatabaseService } = require("./game-db");
const { TwitchAuthService } = require("./twitch-auth");
const { TwitchEventSubService } = require("./twitch-eventsub");
const { CoverCacheService } = require("./cover-cache");

const config = loadConfig();
const store = new FileStore(config);
const state = new DocketState(store, config);
const auth = new AuthManager(config);
const gameDatabase = new GameDatabaseService(config, store);
const twitchAuth = new TwitchAuthService(config, store);
const coverCache = new CoverCacheService(store);
const twitchEventSub = new TwitchEventSubService(config, twitchAuth, state, {
  onStateChange: broadcastState,
  onRedemption: (payload) => {
    if (state.hasQueueItemForRedemption(payload.sourceMetadata?.redemptionId)) {
      return null;
    }
    const item = state.addQueueItem(payload);
    broadcastState();
    return item;
  },
});

state.bootstrap();

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

function getConnectionSummary() {
  const summary = {
    total: 0,
    controller: 0,
    overlay: 0,
    public: 0,
    unknown: 0,
  };
  for (const client of wss.clients) {
    if (client.readyState !== 1) {
      continue;
    }
    summary.total += 1;
    const role = client.clientRole || "unknown";
    if (summary[role] !== undefined) {
      summary[role] += 1;
    } else {
      summary.unknown += 1;
    }
  }
  return summary;
}

function broadcastState() {
  const adminState = {
    ...state.controllerSnapshot(),
    connections: getConnectionSummary(),
    gameDatabase: gameDatabase.publicSettings(),
    twitch: {
      ...twitchAuth.getPublicState(),
      eventSub: twitchEventSub.getPublicState(),
    },
  };
  const payload = JSON.stringify({
    type: "state",
    payload: {
      public: state.publicSnapshot(),
      admin: adminState,
    },
  });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

const route = createRouter({
  rootDir: ROOT,
  auth,
  state,
  gameDatabase,
  twitchAuth,
  twitchEventSub,
  coverCache,
  buildAdminState: () => ({
    ...state.controllerSnapshot(),
    connections: getConnectionSummary(),
    gameDatabase: gameDatabase.publicSettings(),
    twitch: {
      ...twitchAuth.getPublicState(),
      eventSub: twitchEventSub.getPublicState(),
    },
  }),
  broadcaster: broadcastState,
});

async function warmExistingGameCovers() {
  const games = state.getGames();
  let changed = false;
  for (const game of games) {
    const remoteUrl =
      (/^https?:\/\//i.test(game.cover || "") && game.cover) ||
      (/^https?:\/\//i.test(game.coverFallback || "") && game.coverFallback) ||
      "";
    if (!remoteUrl) {
      continue;
    }
    try {
      const cached = await coverCache.cacheCover(remoteUrl, game.title || game.id);
      if (cached.localUrl && game.cover !== cached.localUrl) {
        state.updateGame(game.id, {
          cover: cached.localUrl,
          coverFallback: remoteUrl,
        });
        changed = true;
      }
    } catch (_) {
      // Keep the existing remote cover if caching fails.
    }
  }
  if (changed) {
    broadcastState();
  }
}

server.on("request", route);

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.clientRole = url.searchParams.get("client") || "unknown";
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  ws.send(
    JSON.stringify({
      type: "state",
      payload: {
        public: state.publicSnapshot(),
        admin: {
          ...state.controllerSnapshot(),
          connections: getConnectionSummary(),
          gameDatabase: gameDatabase.publicSettings(),
          twitch: {
            ...twitchAuth.getPublicState(),
            eventSub: twitchEventSub.getPublicState(),
          },
        },
      },
    }),
  );
  broadcastState();
  ws.on("close", () => {
    broadcastState();
  });
});

// Broadcast state changes from async timers without requiring an API request.
setInterval(() => {
  broadcastState();
}, 1000);

const port = Number(config.server?.port || 3030);
const host = config.server?.host || "0.0.0.0";

server.listen(port, host, () => {
  const overlayUrl = `http://localhost:${port}/overlay`;
  const controllerUrl = `http://localhost:${port}/controller`;
  const publicUrl = `http://localhost:${port}/public`;
  console.log(`The Docket listening on http://${host}:${port}`);
  console.log(`Controller: ${controllerUrl}`);
  console.log(`Overlay: ${overlayUrl}`);
  console.log(`Public: ${publicUrl}`);
  warmExistingGameCovers().catch((error) => {
    console.error(`Cover cache warmup failed: ${error.message}`);
  });
  twitchEventSub.start().catch((error) => {
    console.error(`Twitch EventSub failed to start: ${error.message}`);
  });
});
