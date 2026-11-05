const { test } = require("node:test");
const assert = require("node:assert/strict");
const { logout, regenerateSession, saveSession } = require("../auth/session");

function request(state) {
  const req = { user: { id: 7 } };
  function install(values) {
    req.session = {
      ...values,
      regenerate(callback) { install({}); callback(); },
      save(callback) { callback(); },
    };
  }
  install(state);
  return req;
}

test("logout removes local and Passport login without copying the account cart", async () => {
  const req = request({ userId: 7, cartId: 42, passport: { user: 7 }, guestOrders: { 9: "grant" } });
  await logout(req);
  assert.equal(req.session.userId, undefined);
  assert.equal(req.session.passport, undefined);
  assert.equal(req.session.cartId, undefined);
  assert.equal(req.user, undefined);
  assert.deepEqual(req.session.guestOrders, { 9: "grant" });
});

test("logout is safe for guests and repeated logout", async () => {
  const req = request({ cartId: 5 });
  await logout(req);
  await logout(req);
  assert.equal(req.session.userId, undefined);
  assert.equal(req.session.cartId, 5);
});

test("regeneration retains only explicitly selected state", async () => {
  const req = request({ cartId: 42, passport: { user: 7 }, unrelated: true });
  await regenerateSession(req, { userId: 8, cartId: 42 });
  assert.equal(req.session.userId, 8);
  assert.equal(req.session.cartId, 42);
  assert.equal(req.session.passport, undefined);
  assert.equal(req.session.unrelated, undefined);
});

test("session store errors are propagated", async () => {
  const error = new Error("store unavailable");
  await assert.rejects(saveSession({ session: { save: (cb) => cb(error) } }), error);
  await assert.rejects(regenerateSession({ session: { regenerate: (cb) => cb(error) } }), error);
});
