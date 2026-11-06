const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runtime } = require("../config/runtime");
test("production session policy has explicit trusted origins and secure cookies", () => {
  const config = runtime({ SESSION_SECRET: "test-secret", NODE_ENV: "production", APP_ORIGIN: "https://hiking.test", SESSION_SAME_SITE: "lax" });
  assert.equal(config.secure, true); assert.equal(config.sameSite, "lax");
  assert.deepEqual(config.origins, ["https://hiking.test"]);
  assert.throws(() => runtime({}), /SESSION_SECRET/);
  assert.throws(() => runtime({ SESSION_SECRET: "x", SESSION_SAME_SITE: "invalid" }), /SAME_SITE/);
  assert.throws(() => runtime({ SESSION_SECRET: "x", AUTH_RATE_LIMIT: "bad" }), /AUTH_RATE_LIMIT/);
});
