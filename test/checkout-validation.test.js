const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateCheckout, normalizePostcode, fingerprint } = require("../validation/checkout");
const { validateRegistration, normalizeEmail } = require("../validation/auth");
const { canRead, grantOrder, publicOrder } = require("../services/orderAccess");
const valid = { email: " Buyer@Example.com ", firstName: "Jan", lastName: "Kowalski", shipping: { address1: "10 Test Road", city: "London", postcode: "sw1a1aa", country: "UK" } };
test("normalizes UK postcode, country and email", () => {
  const parsed = validateCheckout(valid);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.value.shipping.postcode, "SW1A 1AA");
  assert.equal(parsed.value.shipping.country, "GB");
  assert.equal(parsed.value.email, "buyer@example.com");
  assert.equal(normalizePostcode("m1 1ae"), "M1 1AE");
});
test("rejects missing names, invalid postcode and unsupported country", () => {
  const parsed = validateCheckout({ ...valid, firstName: "", lastName: null, shipping: { ...valid.shipping, postcode: "abc", country: "Narnia" } });
  assert.equal(parsed.valid, false);
  for (const name of ["firstName", "lastName", "shipping.postcode", "shipping.country"]) assert.ok(parsed.fieldErrors[name]);
});
test("malformed input produces validation errors without throwing", () => {
  for (const body of [null, [], { email: {}, firstName: 5, shipping: "address" }, { shipping: { postcode: ["a"] } }]) assert.equal(validateCheckout(body).valid, false);
});
test("normalized equivalent payloads have the same checkout fingerprint", () => {
  assert.equal(fingerprint(validateCheckout(valid).value), fingerprint(validateCheckout({ ...valid, email: "buyer@example.com", shipping: { ...valid.shipping, postcode: "SW1A 1AA", country: "GB" } }).value));
});
test("registration enforces the password requirements and email normalization", () => {
  assert.equal(normalizeEmail(" A@EXAMPLE.COM "), "a@example.com");
  assert.equal(validateRegistration({ email: "a@example.com", password: "x" }).valid, false);
  assert.equal(validateRegistration({ email: "a@example.com", password: "😀".repeat(20) }).valid, false);
  assert.equal(validateRegistration({ email: "a@example.com", password: "a secure test password" }).valid, true);
});
test("guest access is bound to an expiring grant and never just an order number", () => {
  const order = { id: 10, created_at: new Date(), user_id: null, guest_token: "secret", checkout_key: "internal", checkout_owner: "internal", checkout_hash: "internal" };
  const req = { session: {} }, other = { session: {} };
  assert.equal(canRead(req, order), false);
  grantOrder(req, order);
  assert.equal(canRead(req, order), true);
  assert.equal(canRead(other, order), false);
  assert.equal(publicOrder(req, order).guest_token, undefined);
  assert.equal(publicOrder(req, order).checkout_owner, undefined);
  assert.equal(publicOrder(req, order).checkout_key, undefined);
  assert.equal(publicOrder(req, order).checkout_hash, undefined);
  req.session.guestOrders[10].expiresAt = 0;
  assert.equal(canRead(req, order), false);
});
test("after claiming, only the owning account can read the order", () => {
  const order = { id: 10, user_id: 3, guest_token: null };
  assert.equal(canRead({ session: { userId: 3 } }, order), true);
  assert.equal(canRead({ session: { userId: 4, guestOrders: { 10: { token: "secret", expiresAt: Date.now() + 10000 } } } }, order), false);
});

test("replaying an old guest checkout cannot extend its access deadline", () => {
  const order = { id: 12, user_id: null, guest_token: "secret", created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) };
  const req = { session: {} };
  grantOrder(req, order);
  assert.equal(canRead(req, order), false);
});
const { safeReturnTo } = require("../auth/returnTo");
test("OAuth return paths stay on the application origin", () => {
  const origin = "https://hiking.example";
  assert.equal(safeReturnTo("/order/7/confirmation?source=guest", origin), "/order/7/confirmation?source=guest");
  for (const value of ["https://evil.example", "//evil.example", "/\\evil.example", null]) assert.equal(safeReturnTo(value, origin), "/");
});
