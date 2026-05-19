const http = require("node:http");
const { WebSocketServer } = require("ws");
const { version } = require("../package.json");
const { loadConfig, ROOT } = require("./config");
const { createStore } = require("./store-factory");
const { DocketState } = require("./state");
const { AuthManager } = require("./auth");
const { createRouter } = require("./router");
const { createWebSocketUpgradeHandler } = require("./ws-upgrade");
const { GameDatabaseService } = require("./game-db");
const { TwitchAuthService } = require("./twitch-auth");
const { TwitchEventSubService } = require("./twitch-eventsub");

async function main() {
  const config = loadConfig();
  const store = createStore(config);
  const state = new DocketState(store, config, {
    onStateChange: () => notifyClients(),
  });
  const auth = new AuthManager(config);
  const gameDatabase = new GameDatabaseService(config, store);
  const twitchAuth = new TwitchAuthService(config, store);
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: true });
  const lastPayloadByRole = new Map();

  function buildPublicMessage() {
    return {
      type: "state",
      payload: {
        public: state.publicSnapshot(),
      },
    };
  }

  function buildAdminMessage() {
    return {
      type: "state",
      payload: {
        admin: {
          ...state.controllerSnapshot(),
          appVersion: version,
          gameDatabase: gameDatabase.publicSettings(),
          twitch: {
            ...twitchAuth.getPublicState(),
            eventSub: twitchEventSub.getPublicState(),
          },
        },
      },
    };
  }

  function broadcastConnections() {
    const message = JSON.stringify({ type: "connections", connections: getConnectionSummary() });
    for (const client of wss.clients) {
      if (client.readyState === 1 && client.clientRole === "controller") {
        client.send(message);
      }
    }
  }

  function buildSerializedPayloads() {
    const publicPayload = JSON.stringify(buildPublicMessage());
    return new Map([
      ["controller", JSON.stringify(buildAdminMessage())],
      ["overlay", publicPayload],
      ["public", publicPayload],
      ["unknown", publicPayload],
    ]);
  }

  function payloadChanged(role, nextPayload) {
    return lastPayloadByRole.get(role) !== nextPayload;
  }

  function sendPayload(ws, payload) {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  }

  function notifyClients() {
    const payloadsByRole = buildSerializedPayloads();
    const changedRoles = new Set();

    for (const [role, payload] of payloadsByRole.entries()) {
      if (payloadChanged(role, payload)) {
        changedRoles.add(role);
        lastPayloadByRole.set(role, payload);
      }
    }

    for (const client of wss.clients) {
      if (client.readyState !== 1) {
        continue;
      }
      const role = client.clientRole || "unknown";
      const payload = payloadsByRole.get(role) || payloadsByRole.get("unknown");
      if (changedRoles.has(role)) {
        sendPayload(client, payload);
      }
    }
  }

  const twitchEventSub = new TwitchEventSubService(config, twitchAuth, state, {
    onStateChange: notifyClients,
    onRedemption: (payload) => {
      if (state.hasQueueItemForRedemption(payload.sourceMetadata?.redemptionId)) {
        return null;
      }
      const item = state.addQueueItem(payload);
      notifyClients();
      return item;
    },
  });

  await state.bootstrap();

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

  const route = createRouter({
    rootDir: ROOT,
    auth,
    state,
    gameDatabase,
    twitchAuth,
    twitchEventSub,
    buildAdminState: () => ({
      ...buildAdminMessage().payload.admin,
      connections: getConnectionSummary(),
    }),
    broadcaster: notifyClients,
  });

  server.on("request", route);
  server.on("upgrade", createWebSocketUpgradeHandler({ auth, wss }));

  // Ping all clients every 30s. Browsers respond with a pong automatically.
  // Clients that miss a pong are terminated so they can cleanly reconnect instead
  // of sitting as zombie connections that burn bandwidth on reconnect storms.
  const PING_INTERVAL_MS = 30_000;
  const pingTimer = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, PING_INTERVAL_MS);
  wss.on("close", () => clearInterval(pingTimer));

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    const role = ws.clientRole || "unknown";
    const payloadsByRole = buildSerializedPayloads();
    const payload = payloadsByRole.get(role) || payloadsByRole.get("unknown");
    sendPayload(ws, payload);
    lastPayloadByRole.set(role, payload);
    broadcastConnections();
    ws.on("close", () => {
      const anyRemainingOfRole = Array.from(wss.clients).some(
        (c) => c !== ws && c.readyState === 1 && c.clientRole === role,
      );
      if (!anyRemainingOfRole) {
        lastPayloadByRole.delete(role);
      }
      broadcastConnections();
    });
  });

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
    console.log(`Storage: ${store.storageMode}`);
    twitchEventSub.start().catch((error) => {
      console.error(`Twitch EventSub failed to start: ${error.message}`);
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
