const title = document.getElementById("title");
const lastAction = document.getElementById("last-action");
const overrideCurrent = document.getElementById("override-current");
const activeCurrent = document.getElementById("active-current");
const inList = document.getElementById("in-list");
const outList = document.getElementById("out-list");
const overrideList = document.getElementById("override-list");

const appState = {
  data: null,
};

let socket = null;

function connect() {
  if (document.hidden || socket) {
    return;
  }
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}/ws?client=public`);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state" && message.payload.public) {
      appState.data = message.payload.public;
      render();
    }
  });
  socket.addEventListener("close", () => {
    socket = null;
    if (!document.hidden) {
      window.setTimeout(connect, 1500);
    }
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    socket?.close();
  } else {
    fetch("/api/public-state")
      .then((res) => res.json())
      .then((data) => {
        appState.data = data;
        render();
      })
      .catch(() => {})
      .finally(() => connect());
  }
});

async function bootstrap() {
  const res = await fetch("/api/public-state");
  appState.data = await res.json();
  render();
  connect();
}

function render() {
  const data = appState.data;
  const activeGame = data.activeGame || data.games.find((game) => game.status === "active");
  title.textContent = data.overlayTitle || "The Docket";
  if (data.overrideGame) {
    lastAction.textContent = `Override live: ${data.overrideGame.title}`;
  } else if (activeGame) {
    lastAction.textContent = `Current game: ${activeGame.title}`;
  } else if (data.activeSpin?.winner && (data.activeSpin.status === "reveal" || data.activeSpin.status === "complete")) {
    lastAction.textContent = `${data.activeSpin.viewerName || "Streamer"} • ${data.activeSpin.type} • ${data.activeSpin.winner.label}`;
  } else if (data.lastCompletedSpin?.winner) {
    lastAction.textContent = `Last result: ${data.lastCompletedSpin.winner.label}`;
  } else if (data.activeSpin) {
    lastAction.textContent = `${data.activeSpin.viewerName || "Streamer"} • ${data.activeSpin.type} in progress`;
  } else {
    lastAction.textContent = "Live docket board";
  }
  overrideCurrent.textContent = data.overrideGame
    ? `${data.overrideGame.title} is overriding the wheel`
    : "Wheel result is live";
  activeCurrent.textContent = activeGame
    ? `${activeGame.title} is currently active`
    : "No game active yet";
  renderList(inList, data.games.filter((game) => game.status === "in"));
  renderList(outList, data.games.filter((game) => game.status === "out"));
  renderList(overrideList, data.games.filter((game) => ["seasonal", "new_release", "queue"].includes(game.status)), {
    activeOverrideId: data.overrideGame?.id || null,
    showStatus: true,
  });
}

function renderList(target, games, options = {}) {
  target.innerHTML = games
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(
      (game) => `
        <div class="item${options.activeOverrideId === game.id ? " item--override-active" : ""}">
          <div class="cover" style="${resolveCoverStyle(game.cover, game.coverFallback)}"></div>
          <div>
            <strong>${escapeHtml(game.title)}</strong>
            <div class="muted">
              ${options.showStatus ? `${escapeHtml(formatStatus(game.status))} • ` : ""}Weight ${game.baseWeight}${game.locked ? " • Locked" : ""}
            </div>
          </div>
        </div>
      `,
    )
    .join("");
}

function formatStatus(status) {
  if (status === "new_release") {
    return "New Release";
  }
  return String(status || "")
    .replaceAll("_", " ")
    .replace(/^\w/, (match) => match.toUpperCase());
}

function resolveCoverStyle(primary, fallback) {
  const url = primary || fallback || "";
  return url ? `background-image:url('${encodeURI(url)}')` : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

bootstrap();
