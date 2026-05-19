const test = require("node:test");
const assert = require("node:assert/strict");
const { AuthManager } = require("../server/auth");
const { createWebSocketUpgradeHandler } = require("../server/ws-upgrade");

function createSocket() {
  return {
    writable: true,
    writes: [],
    destroyed: false,
    write(chunk) {
      this.writes.push(String(chunk));
    },
    destroy() {
      this.destroyed = true;
    },
  };
}

function createWss() {
  return {
    handleUpgradeCalls: [],
    emitted: [],
    handleUpgrade(req, socket, head, callback) {
      this.handleUpgradeCalls.push({ req, socket, head });
      callback({});
    },
    emit(event, ws, req) {
      this.emitted.push({ event, ws, req });
    },
  };
}

test("controller websocket upgrade requires auth", () => {
  const auth = new AuthManager({ auth: { sharedSecret: "test-secret" } });
  const wss = createWss();
  const socket = createSocket();
  const handleUpgrade = createWebSocketUpgradeHandler({ auth, wss });

  handleUpgrade(
    {
      url: "/ws?client=controller",
      headers: { host: "localhost:3030" },
    },
    socket,
    Buffer.alloc(0),
  );

  assert.equal(wss.handleUpgradeCalls.length, 0);
  assert.equal(socket.destroyed, true);
  assert.match(socket.writes[0], /401 Unauthorized/);
});

test("controller websocket upgrade succeeds with auth cookie", () => {
  const auth = new AuthManager({ auth: { sharedSecret: "test-secret" } });
  const token = auth.login("test-secret");
  const wss = createWss();
  const socket = createSocket();
  const handleUpgrade = createWebSocketUpgradeHandler({ auth, wss });

  handleUpgrade(
    {
      url: "/ws?client=controller",
      headers: { host: "localhost:3030", cookie: `docket_session=${token}` },
    },
    socket,
    Buffer.alloc(0),
  );

  assert.equal(wss.handleUpgradeCalls.length, 1);
  assert.equal(wss.emitted.length, 1);
  assert.equal(wss.emitted[0].event, "connection");
  assert.equal(wss.emitted[0].ws.clientRole, "controller");
  assert.equal(socket.destroyed, false);
});

test("public websocket roles do not require auth", () => {
  const auth = new AuthManager({ auth: { sharedSecret: "test-secret" } });
  const wss = createWss();
  const socket = createSocket();
  const handleUpgrade = createWebSocketUpgradeHandler({ auth, wss });

  handleUpgrade(
    {
      url: "/ws?client=overlay",
      headers: { host: "localhost:3030" },
    },
    socket,
    Buffer.alloc(0),
  );

  assert.equal(wss.handleUpgradeCalls.length, 1);
  assert.equal(wss.emitted[0].ws.clientRole, "overlay");
  assert.equal(socket.destroyed, false);
});
