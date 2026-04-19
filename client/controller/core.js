export const state = {
  admin: null,
  socket: null,
  ui: {
    gamesDrawerOpen: false,
    spinDrawerOpen: false,
    configDrawerOpen: false,
    gameEditorOpen: false,
    queueEditorOpen: false,
    wheelFeelOpen: false,
    viewerChoiceHidden: false,
    lastPendingChoiceId: null,
  },
  pending: {
    nextGame: false,
    forceResolve: false,
    queueStartId: null,
  },
  gameLookup: {
    controller: null,
    selectedSuggestion: null,
    suggestions: [],
    lastQuery: "",
  },
};

export const LAST_GAME_STATUS_KEY = "docket:last-game-status";

export const els = {
  loginPanel: document.getElementById("login-panel"),
  app: document.getElementById("app"),
  controllerShell: document.querySelector(".controller-shell"),
  loginForm: document.getElementById("login-form"),
  loginError: document.getElementById("login-error"),
  statusLine: document.getElementById("status-line"),
  instanceLine: document.getElementById("instance-line"),
  footerBrand: document.getElementById("footer-brand"),
  storageUsageLabel: document.getElementById("storage-usage-label"),
  storageUsageDetail: document.getElementById("storage-usage-detail"),
  storageBreakdown: document.getElementById("storage-breakdown"),
  storageMeterFill: document.getElementById("storage-meter-fill"),
  queueForm: document.getElementById("queue-form"),
  queueList: document.getElementById("queue-list"),
  drawerBackdrop: document.getElementById("drawer-backdrop"),
  gamesDrawer: document.getElementById("games-drawer"),
  gamesDrawerToggle: document.getElementById("games-drawer-toggle"),
  gamesDrawerClose: document.getElementById("games-drawer-close"),
  spinDrawer: document.getElementById("spin-drawer"),
  spinDrawerToggle: document.getElementById("spin-drawer-toggle"),
  spinDrawerClose: document.getElementById("spin-drawer-close"),
  configDrawer: document.getElementById("config-drawer"),
  configDrawerToggle: document.getElementById("config-drawer-toggle"),
  configDrawerClose: document.getElementById("config-drawer-close"),
  nextGameButton: document.getElementById("next-game-button"),
  forceResolveButton: document.getElementById("force-resolve-button"),
  logoutButton: document.getElementById("logout-button"),
  twitchStatus: document.getElementById("twitch-status"),
  connectTwitchButton: document.getElementById("connect-twitch-button"),
  disconnectTwitchButton: document.getElementById("disconnect-twitch-button"),
  gameForm: document.getElementById("game-form"),
  gameId: document.getElementById("game-id"),
  gameTitle: document.getElementById("game-title"),
  gameCover: document.getElementById("game-cover"),
  gameSource: document.getElementById("game-source"),
  gameSourceId: document.getElementById("game-source-id"),
  gameSourceSlug: document.getElementById("game-source-slug"),
  gameReleaseYear: document.getElementById("game-release-year"),
  gameSearchResults: document.getElementById("game-search-results"),
  gameSearchStatus: document.getElementById("game-search-status"),
  gameCoverPreview: document.getElementById("game-cover-preview"),
  gameStatus: document.getElementById("game-status"),
  gameWeight: document.getElementById("game-weight"),
  gameStatusIn: document.getElementById("game-status-in"),
  gameStatusOut: document.getElementById("game-status-out"),
  gameStatusSeasonal: document.getElementById("game-status-seasonal"),
  gameStatusNewRelease: document.getElementById("game-status-new-release"),
  gameStatusQueue: document.getElementById("game-status-queue"),
  gamesList: document.getElementById("games-list"),
  gameEditorModal: document.getElementById("game-editor-modal"),
  gameEditorTitle: document.getElementById("game-editor-title"),
  gameEditorClose: document.getElementById("game-editor-close"),
  queueModalOpen: document.getElementById("queue-modal-open"),
  queueEditorModal: document.getElementById("queue-editor-modal"),
  queueEditorClose: document.getElementById("queue-editor-close"),
  weightForm: document.getElementById("weight-form"),
  weightTarget: document.getElementById("weight-target"),
  testRedeemButton: document.getElementById("test-redeem-button"),
  testRedeemStatus: document.getElementById("test-redeem-status"),
  viewerChoiceModal: document.getElementById("viewer-choice-modal"),
  viewerChoiceTitle: document.getElementById("viewer-choice-title"),
  viewerChoiceCopy: document.getElementById("viewer-choice-copy"),
  viewerChoiceList: document.getElementById("viewer-choice-list"),
  viewerChoiceHide: document.getElementById("viewer-choice-hide"),
  viewerChoiceReopen: document.getElementById("viewer-choice-reopen"),
  wheelForm: document.getElementById("wheel-form"),
  wheelFeelOpen: document.getElementById("wheel-feel-open"),
  wheelFeelModal: document.getElementById("wheel-feel-modal"),
  wheelFeelClose: document.getElementById("wheel-feel-close"),
  wheelTotal: document.getElementById("wheel-total"),
  wheelMass: document.getElementById("wheel-mass"),
  launchForce: document.getElementById("launch-force"),
  drag: document.getElementById("drag"),
  brakeStrength: document.getElementById("brake-strength"),
  minCruiseMs: document.getElementById("min-cruise-ms"),
  revealDelayMs: document.getElementById("reveal-delay-ms"),
  massOutput: document.getElementById("mass-output"),
  launchOutput: document.getElementById("launch-output"),
  dragOutput: document.getElementById("drag-output"),
  brakeOutput: document.getElementById("brake-output"),
  cruiseMinOutput: document.getElementById("cruise-min-output"),
  revealOutput: document.getElementById("reveal-output"),
};

export async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

export function createDecoderText(element, options = {}) {
  const alphabet = options.alphabet || "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789%$#@!?*+-=<>~";
  const minDelayMs = options.minDelayMs || 9;
  const maxDelayMs = options.maxDelayMs || 22;
  const minScrambles = options.minScrambles || 1;
  const maxScrambles = options.maxScrambles || 1;
  let targetText = "";
  let ticket = 0;
  let activePromise = Promise.resolve();

  function delay() {
    return minDelayMs + Math.floor(Math.random() * Math.max(1, maxDelayMs - minDelayMs + 1));
  }

  function randomChar() {
    return alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function animate(nextText, currentTicket) {
    let committed = "";
    for (const char of nextText) {
      if (ticket !== currentTicket) {
        return;
      }
      if (char === " ") {
        committed += char;
        element.textContent = committed;
        await sleep(delay());
        continue;
      }
      const scrambleCount = minScrambles + Math.floor(Math.random() * Math.max(1, maxScrambles - minScrambles + 1));
      for (let index = 0; index < scrambleCount; index += 1) {
        if (ticket !== currentTicket) {
          return;
        }
        element.textContent = `${committed}${randomChar()}`;
        await sleep(delay());
        if (ticket !== currentTicket) {
          return;
        }
        element.textContent = committed;
        await sleep(Math.max(6, Math.round(delay() * 0.3)));
      }
      committed += char;
      element.textContent = committed;
      await sleep(delay());
    }
  }

  return {
    setText(nextText, { immediate = false } = {}) {
      const normalized = String(nextText || "");
      if (normalized === targetText) {
        return activePromise;
      }
      targetText = normalized;
      ticket += 1;
      const currentTicket = ticket;
      if (immediate) {
        element.textContent = normalized;
        activePromise = Promise.resolve();
        return activePromise;
      }
      activePromise = animate(normalized, currentTicket);
      return activePromise;
    },
  };
}

export const footerDecoders = {
  instances: createDecoderText(els.instanceLine, {
    minDelayMs: 8,
    maxDelayMs: 18,
  }),
  status: createDecoderText(els.statusLine, {
    minDelayMs: 10,
    maxDelayMs: 22,
  }),
  brand: createDecoderText(els.footerBrand, {
    minDelayMs: 8,
    maxDelayMs: 18,
  }),
};

let footerStatusTimer = null;

export function setFooterStatus(message, options) {
  const { persist = false, durationMs = 2800, immediate = false } = options || {};
  window.clearTimeout(footerStatusTimer);
  footerDecoders.status.setText(message, { immediate });
  if (!persist && message) {
    footerStatusTimer = window.setTimeout(() => {
      footerDecoders.status.setText("", { immediate: true });
    }, durationMs);
  }
}

export function syncNumericSlider(input, output, value) {
  if (document.activeElement !== input) {
    input.value = value;
  }
  output.textContent = Number(input.value).toFixed(2);
}

export function syncMsSlider(input, output, value) {
  if (document.activeElement !== input) {
    input.value = value;
  }
  output.textContent = formatMs(Number(input.value));
}

export function formatMs(value) {
  return `${(Number(value) / 1000).toFixed(2)}s`;
}

export function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

export function coverStyle(primary, fallback) {
  const url = primary || fallback || "";
  return url ? `background-image:url('${encodeURI(url)}')` : "";
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
