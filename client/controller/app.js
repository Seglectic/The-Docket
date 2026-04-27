import { els, request, setFooterStatus, state } from "./core.js";
import { bindControllerEvents } from "./events.js";
import { createRenderer } from "./render.js";

let render = () => {};

async function loadAdminState() {
  const data = await request("/api/admin/state", { method: "GET" });
  state.admin = data;
  render();
}

async function runControllerAction(action, options = {}) {
  const { status = "Working…", successStatus = "", setPending } = options;
  if (typeof setPending === "function") {
    setPending(true);
    render();
  }
  setFooterStatus(status);
  try {
    const result = await action();
    await loadAdminState();
    if (successStatus) {
      setFooterStatus(successStatus);
    }
    return result;
  } catch (error) {
    setFooterStatus(error.message);
    throw error;
  } finally {
    if (typeof setPending === "function") {
      setPending(false);
      render();
    }
  }
}

function connectSocket() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  state.socket = new WebSocket(`${protocol}://${location.host}/ws?client=controller`);
  state.socket.addEventListener("open", () => {
    setFooterStatus("", { immediate: true });
  });
  state.socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state" && message.payload.admin) {
      // Preserve connections — state updates don't include them
      state.admin = { ...message.payload.admin, connections: state.admin?.connections };
      render();
    } else if (message.type === "connections") {
      if (!state.admin) return;
      state.admin = { ...state.admin, connections: message.connections };
      render();
    }
  });
  state.socket.addEventListener("close", () => {
    setFooterStatus("Disconnected. Retrying…", { persist: true });
    window.setTimeout(connectSocket, 1500);
  });
}

const renderer = createRenderer({
  request,
  loadAdminState,
  runControllerAction,
  setFooterStatus,
});

render = renderer.render;

bindControllerEvents({
  loadAdminState,
  render,
  runControllerAction,
  connectSocket,
  clearGameMetadataSelection: renderer.clearGameMetadataSelection,
  clearGameSearchResults: renderer.clearGameSearchResults,
  closeGameEditor: renderer.closeGameEditor,
  closeQueueEditor: renderer.closeQueueEditor,
  closeWheelFeel: renderer.closeWheelFeel,
  openQueueEditor: renderer.openQueueEditor,
  openGameEditor: renderer.openGameEditor,
  rememberGameStatus: renderer.rememberGameStatus,
  renderWheelFeel: renderer.renderWheelFeel,
  searchGames: renderer.searchGames,
  setGameStatus: renderer.setGameStatus,
  setFooterStatus,
  updateCoverPreview: renderer.updateCoverPreview,
  openWheelFeel: renderer.openWheelFeel,
});

loadAdminState().then(connectSocket).catch(() => {
  els.statusLine.textContent = "";
  setFooterStatus("Login required", { immediate: true });
});
