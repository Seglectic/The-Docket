const { WebSocket } = require("ws");

const EVENTSUB_WS_URL = "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30";
const EVENTSUB_SUBSCRIPTIONS_URL = "https://api.twitch.tv/helix/eventsub/subscriptions";

class TwitchEventSubService {
  constructor(config, twitchAuth, state, options = {}) {
    this.config = config;
    this.twitchAuth = twitchAuth;
    this.state = state;
    this.fetchImpl = options.fetch || globalThis.fetch;
    this.WebSocketImpl = options.WebSocketImpl || WebSocket;
    this.onStateChange = options.onStateChange || (() => {});
    this.onRedemption = options.onRedemption || (() => {});
    this.socket = null;
    this.reconnectTimer = null;
    this.session = {
      status: "idle",
      sessionId: "",
      connectedAt: null,
      reconnectUrl: "",
      lastMessageAt: null,
      lastError: "",
      lastReward: "",
    };
    this.seenMessageIds = new Set();
  }

  getSettings() {
    const twitch = this.config.twitch || {};
    const eventSub = twitch.eventSub || {};
    return {
      enabled: twitch.enabled !== false,
      broadcasterLogin: twitch.broadcasterLogin || "",
      reconnectGraceMs: Number(eventSub.reconnectGraceMs || 30_000),
      subscriptions: {
        channelPointsCustomRewardRedemptionAdd:
          eventSub.subscriptions?.channelPointsCustomRewardRedemptionAdd !== false,
        channelPointsCustomRewardRedemptionUpdate:
          Boolean(eventSub.subscriptions?.channelPointsCustomRewardRedemptionUpdate),
      },
    };
  }

  getPublicState() {
    return {
      status: this.session.status,
      sessionId: this.session.sessionId,
      connectedAt: this.session.connectedAt,
      lastMessageAt: this.session.lastMessageAt,
      lastError: this.session.lastError,
      lastReward: this.session.lastReward,
    };
  }

  async start() {
    const settings = this.getSettings();
    if (!settings.enabled) {
      this.session.status = "disabled";
      this.onStateChange();
      return;
    }
    if (!this.twitchAuth.getStoredUserToken()) {
      this.session.status = "awaiting_auth";
      this.onStateChange();
      return;
    }
    await this.connect(EVENTSUB_WS_URL);
  }

  async restart() {
    this.stop();
    await this.start();
  }

  stop() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.close();
      this.socket = null;
    }
    this.session = {
      ...this.session,
      status: "idle",
      sessionId: "",
      reconnectUrl: "",
    };
    this.onStateChange();
  }

  async connect(url) {
    this.session.status = "connecting";
    this.session.lastError = "";
    this.onStateChange();

    const socket = new this.WebSocketImpl(url);
    this.socket = socket;

    socket.on("open", () => {
      this.session.status = "connected";
      this.session.lastMessageAt = new Date().toISOString();
      this.onStateChange();
    });

    socket.on("message", async (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        await this.handleMessage(payload);
      } catch (error) {
        this.session.lastError = error.message;
        this.onStateChange();
      }
    });

    socket.on("close", () => {
      this.socket = null;
      if (this.getSettings().enabled && this.twitchAuth.getStoredUserToken()) {
        this.session.status = "reconnecting";
        this.scheduleReconnect();
      } else {
        this.session.status = "idle";
      }
      this.onStateChange();
    });

    socket.on("error", (error) => {
      this.session.lastError = error.message;
      this.onStateChange();
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect(this.session.reconnectUrl || EVENTSUB_WS_URL);
      } catch (error) {
        this.session.lastError = error.message;
        this.onStateChange();
      }
    }, this.getSettings().reconnectGraceMs);
  }

  async handleMessage(message) {
    const metadata = message.metadata || {};
    this.session.lastMessageAt = metadata.message_timestamp || new Date().toISOString();
    const messageType = metadata.message_type;

    switch (messageType) {
      case "session_welcome":
        this.session.sessionId = message.payload?.session?.id || "";
        this.session.connectedAt = message.payload?.session?.connected_at || new Date().toISOString();
        this.session.reconnectUrl = message.payload?.session?.reconnect_url || "";
        this.session.status = "subscribing";
        this.onStateChange();
        await this.syncSubscriptions();
        this.session.status = "listening";
        this.onStateChange();
        break;
      case "session_keepalive":
        this.onStateChange();
        break;
      case "session_reconnect":
        this.session.reconnectUrl = message.payload?.session?.reconnect_url || "";
        this.stop();
        await this.connect(this.session.reconnectUrl || EVENTSUB_WS_URL);
        break;
      case "notification":
        if (this.seenMessageIds.has(metadata.message_id)) {
          return;
        }
        this.seenMessageIds.add(metadata.message_id);
        if (this.seenMessageIds.size > 200) {
          this.seenMessageIds = new Set(Array.from(this.seenMessageIds).slice(-100));
        }
        await this.handleNotification(message);
        break;
      case "revocation":
        this.session.status = "revoked";
        this.session.lastError = message.payload?.subscription?.status || "EventSub subscription revoked";
        this.onStateChange();
        break;
      default:
        break;
    }
  }

  async handleNotification(message) {
    const subscriptionType = message.metadata?.subscription_type;
    if (subscriptionType !== "channel.channel_points_custom_reward_redemption.add") {
      return;
    }

    const event = message.payload?.event || {};
    const rewardTitle = event.reward?.title || "";
    const actionType = this.mapRewardTitleToAction(rewardTitle);
    if (!actionType) {
      return;
    }

    this.session.lastReward = rewardTitle;
    this.onStateChange();

    const created = this.onRedemption({
      source: "twitch",
      viewerName: event.user_name || event.user_login || "Unknown Viewer",
      actionType,
      userInput: event.user_input || "",
      sourceMetadata: {
        redemptionId: event.id,
        rewardId: event.reward?.id || "",
        rewardTitle,
        redemptionStatus: event.status || "",
      },
    });
    if (created) {
      this.onStateChange();
    }
  }

  mapRewardTitleToAction(rewardTitle) {
    const normalized = normalizeName(rewardTitle);
    const rewards = this.config.rewards || {};
    if (normalized === normalizeName(rewards.restore)) {
      return "restore";
    }
    if (normalized === normalizeName(rewards.eliminate)) {
      return "eliminate";
    }
    return null;
  }

  async syncSubscriptions() {
    const settings = this.getSettings();
    const auth = this.twitchAuth.getStoredUserToken();
    if (!auth?.user?.id) {
      throw new Error("Missing connected Twitch broadcaster");
    }
    const userToken = await this.twitchAuth.getValidUserAccessToken();
    const existing = await this.listSubscriptions(userToken);
    const desired = [];

    if (settings.subscriptions.channelPointsCustomRewardRedemptionAdd) {
      desired.push({
        type: "channel.channel_points_custom_reward_redemption.add",
        version: "1",
        condition: { broadcaster_user_id: auth.user.id },
      });
    }
    if (settings.subscriptions.channelPointsCustomRewardRedemptionUpdate) {
      desired.push({
        type: "channel.channel_points_custom_reward_redemption.update",
        version: "1",
        condition: { broadcaster_user_id: auth.user.id },
      });
    }

    for (const subscription of desired) {
      const matches = existing.filter((item) =>
        item.type === subscription.type &&
        item.condition?.broadcaster_user_id === subscription.condition.broadcaster_user_id,
      );

      const current = matches.find((item) => item.transport?.session_id === this.session.sessionId && item.status === "enabled");
      if (current) {
        continue;
      }

      for (const stale of matches) {
        if (stale.id) {
          await this.deleteSubscription(userToken, stale.id);
        }
      }

      await this.createSubscription(userToken, subscription);
    }
  }

  async listSubscriptions(userToken) {
    const response = await this.fetchImpl(EVENTSUB_SUBSCRIPTIONS_URL, {
      method: "GET",
      headers: this.buildApiHeaders(userToken),
    });
    if (!response.ok) {
      throw new Error(`Failed to list EventSub subscriptions (${response.status})`);
    }
    const payload = await response.json();
    return payload.data || [];
  }

  async createSubscription(userToken, subscription) {
    const auth = this.twitchAuth.getStoredUserToken();
    const response = await this.fetchImpl(EVENTSUB_SUBSCRIPTIONS_URL, {
      method: "POST",
      headers: {
        ...this.buildApiHeaders(userToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: subscription.type,
        version: subscription.version,
        condition: subscription.condition,
        transport: {
          method: "websocket",
          session_id: this.session.sessionId,
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to create EventSub subscription (${response.status})`);
    }
    this.state.record("twitch.eventsub.subscription_created", {
      type: subscription.type,
      broadcasterUserId: auth?.user?.id || "",
    });
  }

  async deleteSubscription(userToken, id) {
    const response = await this.fetchImpl(`${EVENTSUB_SUBSCRIPTIONS_URL}?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: this.buildApiHeaders(userToken),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete EventSub subscription (${response.status})`);
    }
  }

  buildApiHeaders(userToken) {
    const settings = this.twitchAuth.getSettings();
    return {
      Authorization: `Bearer ${userToken}`,
      "Client-Id": settings.clientId,
    };
  }
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

module.exports = {
  TwitchEventSubService,
};
