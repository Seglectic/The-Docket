const test = require("node:test");
const assert = require("node:assert/strict");
const { randomTestRedeem, randomViewerName } = require("../server/generateTest");

test("randomViewerName produces a twitch-like string", () => {
  const name = randomViewerName(() => 0.1);
  assert.match(name, /^[a-z]+[a-z]+[0-9a-z]*$/);
});

test("randomTestRedeem always returns an accepted payload shape", () => {
  const redeem = randomTestRedeem(() => 0.2);
  assert.equal(redeem.source, "test");
  assert.equal(redeem.userInput, "");
  assert.equal(redeem.sourceMetadata.generated, true);
  assert.match(redeem.viewerName, /^[a-z0-9]+$/);
  assert(["restore", "eliminate"].includes(redeem.actionType));
});
