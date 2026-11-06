const { test } = require("node:test");
const assert = require("node:assert/strict");
const { beginOAuth, consumeOAuth, MAX_AGE_MS } = require("../auth/oauthState");
const origin = "https://hiking.test";

test("OAuth state is random, session-bound, provider-bound and single-use", () => {
  const session = {}, other = {};
  const state = beginOAuth(session, "google", "/order/28/confirmation", origin, 1000);
  const otherState = beginOAuth(other, "google", "/", origin, 1000);
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(state, otherState);
  assert.equal(consumeOAuth({}, "google", state, origin, 1001), null);
  assert.equal(consumeOAuth(session, "facebook", state, origin, 1001), null);
  assert.deepEqual(consumeOAuth(session, "google", state, origin, 1001), { returnTo: "/order/28/confirmation" });
  assert.equal(consumeOAuth(session, "google", state, origin, 1002), null);
  assert.equal(session.oauthAttempts, undefined);
});

test("missing, malformed, mismatched and expired OAuth callbacks consume the attempt", () => {
  for (const value of [undefined, "", ["duplicate"], "x".repeat(43), "x".repeat(10000)]) {
    const session = {};
    const state = beginOAuth(session, "google", "/", origin, 1000);
    assert.equal(consumeOAuth(session, "google", value, origin, 1001), null);
    assert.equal(consumeOAuth(session, "google", state, origin, 1002), null);
  }
  for (const now of [999, 1000 + MAX_AGE_MS, 1000 + MAX_AGE_MS + 1]) {
    const session = {};
    const state = beginOAuth(session, "facebook", "/", origin, 1000);
    assert.equal(consumeOAuth(session, "facebook", state, origin, now), null);
  }
});

test("the latest attempt per provider is used and other providers remain independent", () => {
  const session = {};
  const google = beginOAuth(session, "google", "/orders", origin);
  const facebook = beginOAuth(session, "facebook", "/cart", origin);
  const nextGoogle = beginOAuth(session, "google", "/checkout", origin);
  assert.notEqual(google, nextGoogle);
  assert.deepEqual(consumeOAuth(session, "google", nextGoogle, origin), { returnTo: "/checkout" });
  assert.deepEqual(consumeOAuth(session, "facebook", facebook, origin), { returnTo: "/cart" });
});

test("OAuth return paths cannot redirect to another origin", () => {
  for (const value of ["https://example.com", "//example.com", "/\\example.com", "/\n/example.com", ["/orders"]]) {
    const session = {};
    const state = beginOAuth(session, "google", value, origin);
    assert.deepEqual(consumeOAuth(session, "google", state, origin), { returnTo: "/" });
  }
});
