function rejectUpgrade(socket, status = "401 Unauthorized") {
  if (socket.writable) {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  }
  socket.destroy();
}

function createWebSocketUpgradeHandler({ auth, wss }) {
  return function handleWebSocketUpgrade(req, socket, head) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const clientRole = url.searchParams.get("client") || "unknown";
    if (clientRole === "controller") {
      try {
        auth.requireAuth(req);
      } catch (_) {
        rejectUpgrade(socket);
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.clientRole = clientRole;
      wss.emit("connection", ws, req);
    });
  };
}

module.exports = {
  createWebSocketUpgradeHandler,
};
