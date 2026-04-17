const http = require("node:http");
const path = require("node:path");
const { WebSocketServer } = require("ws");
const { loadConfig, ROOT } = require("./config");
const { FileStore } = require("./storage");
const { DocketState } = require("./state");
const { AuthManager } = require("./auth");
const { createRouter } = require("./router");

const config = loadConfig();
const store = new FileStore(config);
const state = new DocketState(store, config);
const auth = new AuthManager(config);

state.bootstrap();

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

function broadcastState() {
  const payload = JSON.stringify({
    type: "state",
    payload: {
      public: state.publicSnapshot(),
      admin: state.controllerSnapshot(),
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
  broadcaster: broadcastState,
});

server.on("request", route);

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  ws.send(
    JSON.stringify({
      type: "state",
      payload: {
        public: state.publicSnapshot(),
        admin: state.controllerSnapshot(),
      },
    }),
  );
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
});
