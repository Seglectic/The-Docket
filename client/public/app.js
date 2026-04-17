const title = document.getElementById("title");
const lastAction = document.getElementById("last-action");
const inList = document.getElementById("in-list");
const outList = document.getElementById("out-list");

const appState = {
  data: null,
};

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/ws?client=public`);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state" && message.payload.public) {
      appState.data = message.payload.public;
      render();
    }
  });
  socket.addEventListener("close", () => {
    window.setTimeout(connect, 1500);
  });
}

async function bootstrap() {
  const res = await fetch("/api/public-state");
  appState.data = await res.json();
  render();
  connect();
}

function render() {
  const data = appState.data;
  title.textContent = data.overlayTitle || "The Docket";
  if (data.activeSpin?.winner) {
    lastAction.textContent = `${data.activeSpin.viewerName || "Streamer"} • ${data.activeSpin.type} • ${data.activeSpin.winner.label}`;
  } else if (data.lastCompletedSpin?.winner) {
    lastAction.textContent = `Last result: ${data.lastCompletedSpin.winner.label}`;
  } else {
    lastAction.textContent = "Live docket board";
  }
  renderList(inList, data.games.filter((game) => game.status === "in"));
  renderList(outList, data.games.filter((game) => game.status === "out"));
}

function renderList(target, games) {
  target.innerHTML = games
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(
      (game) => `
        <div class="item">
          <div class="cover" style="${game.cover ? `background-image:url('${encodeURI(game.cover)}')` : ""}"></div>
          <div>
            <strong>${escapeHtml(game.title)}</strong>
            <div class="muted">Weight ${game.baseWeight}${game.locked ? " • Locked" : ""}</div>
          </div>
        </div>
      `,
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

bootstrap();
