const test = require("node:test");
const assert = require("node:assert/strict");
const { TwitchEventSubService } = require("../server/twitch-eventsub");

function createConfig(overrides = {}) {
  return {
    twitch: {
      enabled: true,
      broadcasterLogin: "seglectic",
      eventSub: {
        reconnectGraceMs: 50,
        subscriptions: {
          channelPointsCustomRewardRedemptionAdd: true,
          channelPointsCustomRewardRedemptionUpdate: false,
        },
      },
    },
    rewards: {
      restore: "Docket Restoration",
      eliminate: "Docket Elimination!",
    },
    ...overrides,
  };
}

function createTwitchAuthStub() {
  return {
    getStoredUserToken: () => ({
      connected: true,
      user: { id: "1234", login: "seglectic", displayName: "Seglectic" },
      token: { accessToken: "token-123", expiresAt: new Date(Date.now() + 60_000).toISOString() },
    }),
    getValidUserAccessToken: async () => "token-123",
    getSettings: () => ({
      clientId: "client-id",
    }),
  };
}

test("custom reward redemption matching queues restore and eliminate by configured titles", async () => {
  const queued = [];
  const service = new TwitchEventSubService(createConfig(), createTwitchAuthStub(), { record: () => {} }, {
    onRedemption: (payload) => {
      queued.push(payload);
      return payload;
    },
  });

  await service.handleNotification({
    metadata: {
      subscription_type: "channel.channel_points_custom_reward_redemption.add",
      message_id: "msg-1",
    },
    payload: {
      event: {
        id: "redemption-1",
        user_name: "ViewerOne",
        user_input: "",
        status: "unfulfilled",
        reward: {
          id: "reward-1",
          title: "Docket Restoration",
        },
      },
    },
  });

  await service.handleNotification({
    metadata: {
      subscription_type: "channel.channel_points_custom_reward_redemption.add",
      message_id: "msg-2",
    },
    payload: {
      event: {
        id: "redemption-2",
        user_name: "ViewerTwo",
        user_input: "",
        status: "unfulfilled",
        reward: {
          id: "reward-2",
          title: "Docket Elimination!",
        },
      },
    },
  });

  assert.equal(queued.length, 2);
  assert.equal(queued[0].actionType, "restore");
  assert.equal(queued[1].actionType, "eliminate");
});

test("non-matching reward titles are ignored", async () => {
  const queued = [];
  const service = new TwitchEventSubService(createConfig(), createTwitchAuthStub(), { record: () => {} }, {
    onRedemption: (payload) => {
      queued.push(payload);
      return payload;
    },
  });

  await service.handleNotification({
    metadata: {
      subscription_type: "channel.channel_points_custom_reward_redemption.add",
      message_id: "msg-3",
    },
    payload: {
      event: {
        id: "redemption-3",
        user_name: "ViewerThree",
        reward: {
          id: "reward-3",
          title: "Some Other Reward",
        },
      },
    },
  });

  assert.equal(queued.length, 0);
});
