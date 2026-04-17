const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveDriver } = require("../server/store-factory");

test("resolveDriver defaults to file storage", () => {
  assert.equal(resolveDriver({ storage: { driver: "file" } }), "file");
  assert.equal(resolveDriver({}), "file");
});

test("resolveDriver prefers explicit postgres storage", () => {
  assert.equal(
    resolveDriver({
      storage: {
        driver: "postgres",
      },
    }),
    "postgres",
  );
});
