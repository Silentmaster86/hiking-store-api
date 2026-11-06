const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

test("HTTP store flows on migrated PostgreSQL", {
  skip: !process.env.TEST_DATABASE_URL && "Set TEST_DATABASE_URL to a dedicated PostgreSQL test database",
}, async (t) => {
  const { Pool } = require("pg");
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  const pool = require("../db");
  const { migrate } = require("../db/migrate");
  await migrate(pool);
  await pool.query("INSERT INTO products(name, description, price_cents) VALUES ('Test backpack', 'Test only', 1499)");
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: "integration-google-client", GOOGLE_CLIENT_SECRET: "integration-only",
    GOOGLE_CALLBACK_URL: "http://localhost:5173/api/auth/google/callback",
    FB_APP_ID: "integration-facebook-client", FB_APP_SECRET: "integration-only",
    FB_CALLBACK_URL: "http://localhost:5173/api/auth/facebook/callback",
    APP_ORIGIN: "http://localhost:5173", NODE_ENV: "test", SESSION_SECRET: "integration-session-secret-only",
  });
  const express = require("express"), session = require("express-session");
  const passport = require("../auth/passport");
  const providerFixture = { exchanges: 0, fail: false, profile: null };
  for (const name of ["google", "facebook"]) {
    const strategy = passport._strategy(name);
    strategy._oauth2.getOAuthAccessToken = (_code, _options, done) => {
      providerFixture.exchanges++;
      if (providerFixture.fail) return done(new Error("Private provider details"));
      done(null, "test-access-token", "test-refresh-token", {});
    };
    strategy.userProfile = (_token, done) => done(null, providerFixture.profile);
  }
  const sessionStore = new session.MemoryStore();
  const { runtime } = require("../config/runtime");
  const { createApp } = require("../app");
  const config = { ...runtime(), loginLimit: 1000, registerLimit: 1000, checkoutLimit: 1000 };
  const app = createApp({ sessionStore, config });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  function agent(initialCookie = "") {
    let cookie = initialCookie;
    async function redirect(path) {
      const response = await fetch(origin + path, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
      const nextCookie = response.headers.getSetCookie()[0];
      if (nextCookie) cookie = nextCookie.split(";")[0];
      assert.equal(response.status, 302, path);
      return new URL(response.headers.get("location"));
    }
    return { cookie: () => cookie, redirect, async request(path, method = "GET", body, expected = 200, headers = {}) {
      const response = await fetch(origin + path, { method,
        headers: { "Content-Type": "application/json", "X-Store-Request": "1", ...(cookie ? { Cookie: cookie } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const next = response.headers.getSetCookie()[0];
      if (next) cookie = next.split(";")[0];
      const data = await response.json();
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
      return data;
    } };
  }
  const credentials = { email: "regression@example.com", password: "regression-test-password" };
  const owner = agent();
  const payload = { email: "guest@example.com", firstName: "Jan", lastName: "Kowalski", shipping: { address1: "10 Test Road", city: "London", postcode: "SW1A 1AA", country: "GB" } };
  const attempt = () => ({ "Idempotency-Key": randomUUID() });
  const countOrders = async () => Number((await pool.query("SELECT count(*) FROM orders")).rows[0].count);
  async function guestWithItem(quantity = 1, productId = 1) {
    const guest = agent();
    await guest.request("/cart");
    await guest.request("/cart/items", "POST", { productId, quantity }, 201);
    return guest;
  }
  await t.test("production middleware rejects cross-site/simple writes and malformed bodies", async () => {
    const send = (headers, body = "{}") => fetch(origin + "/auth/login", { method: "POST", headers, body });
    assert.equal((await send({ "Content-Type": "application/json" })).status, 403);
    assert.equal((await send({ "Content-Type": "application/json", "X-Store-Request": "1", Origin: "https://evil.invalid" })).status, 403);
    assert.equal((await send({ "Content-Type": "text/plain", "X-Store-Request": "1" })).status, 415);
    assert.equal((await send({ "Content-Type": "application/json", "X-Store-Request": "1" }, "{")).status, 400);
    assert.equal((await send({ "Content-Type": "application/json", "X-Store-Request": "1" }, JSON.stringify({ data: "x".repeat(40000) }))).status, 413);
    const emptyPost = await fetch(origin + "/auth/logout", { method: "POST", headers: { "X-Store-Request": "1" } });
    assert.equal(emptyPost.status, 200, "Bodyless actions do not need a JSON content type");
    const health = await fetch(origin + "/ready"); assert.equal(health.status, 200);
    assert.equal(health.headers.get("X-Content-Type-Options"), "nosniff");
    const preflight = await fetch(origin + "/cart/items", { method: "OPTIONS", headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-store-request,content-type" } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
  });
  await t.test("PostgreSQL rate limits are atomic and return a retry delay", async () => {
    const { rateLimit } = require("../middleware/rateLimit");
    const middleware = rateLimit(pool, { scope: "test", limit: 2, windowMs: 60000, secret: "test-only" });
    const invoke = () => new Promise((resolve, reject) => {
      const res = { set(name, value) { this.retry = value; }, status(code) { this.code = code; return this; }, json() { resolve({ code: this.code, retry: this.retry }); } };
      middleware({ ip: "192.0.2.1" }, res, error => error ? reject(error) : resolve({ code: 200 }));
    });
    const results = await Promise.all([invoke(), invoke(), invoke()]);
    assert.deepEqual(results.map(item => item.code).sort(), [200, 200, 429]);
    assert.ok(Number(results.find(item => item.code === 429).retry) > 0);
    await pool.query("UPDATE request_limits SET expires_at=NOW()-INTERVAL '1 second'");
    assert.equal((await invoke()).code, 200);
  });
  await t.test("migration can be applied twice without losing products", async () => {
    await migrate(pool);
    assert.equal((await pool.query("SELECT count(*) FROM schema_migrations")).rows[0].count, "5");
    assert.equal((await pool.query("SELECT count(*) FROM products")).rows[0].count, "1");
  });
  await t.test("account cart survives repeated logout/login without duplication", async () => {
    await owner.request("/auth/register", "POST", credentials, 201);
    await owner.request("/cart/items", "POST", { productId: 1, quantity: 1 }, 201);
    for (let cycle = 0; cycle < 3; cycle++) {
      await owner.request("/auth/logout", "POST");
      assert.equal((await owner.request("/auth/me")).user, null);
      assert.deepEqual((await owner.request("/cart")).items, []);
      await owner.request("/auth/login", "POST", credentials);
      assert.equal((await owner.request("/cart")).items[0].quantity, 1);
    }
    await owner.request("/auth/logout", "POST");
    await owner.request("/cart/items", "POST", { productId: 1, quantity: 2 }, 201);
    await owner.request("/auth/login", "POST", credentials);
    assert.equal((await owner.request("/cart")).items[0].quantity, 3);
    await owner.request("/auth/login", "POST", credentials);
    assert.equal((await owner.request("/cart")).items[0].quantity, 3);
    const mergeGuestCart = require("../services/mergeGuestCart");
    const guest = await pool.query("INSERT INTO carts(user_id) VALUES(NULL) RETURNING id");
    await pool.query("INSERT INTO cart_items(cart_id, product_id, quantity) VALUES ($1,1,2)", [guest.rows[0].id]);
    const userId = (await owner.request("/auth/me")).user.id;
    await Promise.all([mergeGuestCart(pool, userId, guest.rows[0].id), mergeGuestCart(pool, userId, guest.rows[0].id)]);
    assert.equal((await owner.request("/cart")).items[0].quantity, 5);
  });
  await t.test("merging caps quantities with a notice, consumes once, and repairs old carts", async () => {
    const browser = agent(), login = { email: "limits@example.com", password: "a valid test password" };
    await browser.request("/auth/register", "POST", login, 201);
    await browser.request("/cart/items", "POST", { productId: 1, quantity: 60 }, 201);
    await browser.request("/auth/logout", "POST");
    await browser.request("/cart/items", "POST", { productId: 1, quantity: 60 }, 201);
    await browser.request("/auth/login", "POST", login);
    let cart = await browser.request("/cart");
    assert.equal(cart.items[0].quantity, 99); assert.ok(cart.notice); assert.equal(cart.maxQuantity, 99);
    await browser.request("/auth/login", "POST", login);
    assert.equal((await browser.request("/cart")).items[0].quantity, 99);
    await browser.request(`/cart/items/${cart.items[0].cart_item_id}`, "PATCH", { quantity: 98 });
    assert.equal((await browser.request("/cart")).notice, null);
    await pool.query("UPDATE cart_items SET quantity = 198 WHERE cart_id=$1", [cart.cartId]);
    cart = await browser.request("/cart");
    assert.equal(cart.items[0].quantity, 99); assert.ok(cart.notice);
    await browser.request("/auth/logout", "POST");
    await browser.request("/cart/items", "POST", { productId: 1, quantity: 1 }, 201);
    await browser.request("/auth/login", "POST", login);
    assert.equal((await browser.request("/cart")).items[0].quantity, 99);
  });
  await t.test("validates registration and normalizes account email", async () => {
    await agent().request("/auth/register", "POST", { email: "weak@example.com", password: "x" }, 422);
    await owner.request("/auth/login", "POST", { ...credentials, email: credentials.email.toUpperCase() });
    await agent().request("/auth/register", "POST", { ...credentials, email: credentials.email.toUpperCase() }, 409);
  });
  await t.test("invalid address or checkout key cannot create an order", async () => {
    await agent().request("/checkout", "POST", { ...payload, shipping: { ...payload.shipping, postcode: "abc", country: "Narnia" } }, 422, attempt());
    await agent().request("/checkout", "POST", payload, 422, { "Idempotency-Key": "invalid" });
    assert.equal(await countOrders(), 0);
  });
  const guest = await guestWithItem(2), key = attempt();
  let order;
  await t.test("guest checkout records totals, shipping and a historical product name", async () => {
    order = (await guest.request("/checkout", "POST", payload, 201, key)).order;
    assert.equal(order.total_cents, 2998);
    assert.equal(order.shipping_country, "GB");
    assert.equal(order.canClaim, true);
    for (const internal of ["guest_token", "checkout_key", "checkout_hash", "checkout_owner"]) assert.equal(order[internal], undefined);
    assert.deepEqual((await guest.request("/cart")).items, []);
    await pool.query("UPDATE products SET name = 'Changed catalogue name' WHERE id = 1");
    const details = await guest.request(`/orders/${order.id}`);
    assert.equal(details.items[0].name, "Test backpack");
    assert.equal(details.items[0].line_total_cents, 2998);
  });
  await t.test("same browser can reopen guest order; another browser cannot", async () => {
    assert.equal((await agent(guest.cookie()).request(`/orders/${order.id}`)).order.id, order.id);
    await agent().request(`/orders/${order.id}`, "GET", undefined, 404);
    await agent().request("/orders/999999999", "GET", undefined, 404);
  });
  await t.test("same key replays once and detects changed details without leaking to another session", async () => {
    const replay = await guest.request("/checkout", "POST", payload, 200, key);
    assert.equal(replay.order.id, order.id);
    assert.equal(replay.replay, true);
    assert.equal((await guest.request(`/checkout/attempt/${key["Idempotency-Key"]}`)).order.id, order.id);
    await agent().request(`/checkout/attempt/${key["Idempotency-Key"]}`, "GET", undefined, 404);
    assert.equal(await countOrders(), 1);
    const conflict = await guest.request("/checkout", "POST", { ...payload, firstName: "Anna" }, 409, key);
    assert.equal(conflict.orderId, order.id);
    const other = await agent().request("/checkout", "POST", payload, 409, key);
    assert.equal(other.orderId, undefined);
  });
  await t.test("simultaneous requests with one key return one order", async () => {
    const parallel = await guestWithItem(), headers = attempt();
    const send = async () => {
      const response = await fetch(origin + "/checkout", { method: "POST", headers: { "Content-Type": "application/json", "X-Store-Request": "1", Cookie: parallel.cookie(), ...headers }, body: JSON.stringify(payload) });
      return { status: response.status, data: await response.json() };
    };
    const results = await Promise.all([send(), send()]);
    assert.deepEqual(results.map((item) => item.status).sort(), [200, 201]);
    assert.equal(results[0].data.order.id, results[1].data.order.id);
    assert.equal(await countOrders(), 2);
  });
  await t.test("distinct concurrent keys cannot consume the same cart twice", async () => {
    const parallel = await guestWithItem();
    const send = async () => {
      const response = await fetch(origin + "/checkout", { method: "POST", headers: { "Content-Type": "application/json", "X-Store-Request": "1", Cookie: parallel.cookie(), ...attempt() }, body: JSON.stringify(payload) });
      return response.status;
    };
    assert.deepEqual((await Promise.all([send(), send()])).sort(), [201, 400]);
    assert.equal(await countOrders(), 3);
  });
  await t.test("database failure rolls back order creation and retains the cart", async () => {
    await pool.query("INSERT INTO products(name, description, price_cents) VALUES('Reject this product','Test',100)");
    const rejected = await guestWithItem(1, 2);
    await pool.query("ALTER TABLE order_items ADD CONSTRAINT test_reject_product CHECK(product_name <> 'Reject this product')");
    try {
      await rejected.request("/checkout", "POST", payload, 500, attempt());
      assert.equal(await countOrders(), 3);
      assert.equal((await rejected.request("/cart")).items[0].quantity, 1);
    } finally { await pool.query("ALTER TABLE order_items DROP CONSTRAINT test_reject_product"); }
  });
  await t.test("guest grant survives login, claims once and belongs only to the owning account", async () => {
    await guest.request("/auth/login", "POST", credentials);
    assert.equal((await guest.request(`/orders/${order.id}`)).order.canClaim, true);
    assert.equal((await guest.request(`/orders/${order.id}/claim`, "POST")).order.canClaim, false);
    await guest.request(`/orders/${order.id}/claim`, "POST");
    assert.ok((await guest.request("/orders")).orders.some((item) => item.id === order.id));
    await guest.request("/auth/logout", "POST");
    await guest.request(`/orders/${order.id}`, "GET", undefined, 404);
    await guest.request("/auth/register", "POST", { email: "other@example.com", password: "another-test-password" }, 201);
    await guest.request(`/orders/${order.id}/claim`, "POST", undefined, 404);
    await guest.request("/checkout", "POST", payload, 409, key);
  });
  await t.test("demo status controls enforce owner, next step and paid timestamp", async () => {
    process.env.DEMO_MODE = "false";
    await owner.request(`/orders/${order.id}/status`, "PATCH", { status: "paid" }, 403);
    process.env.DEMO_MODE = "true";
    await owner.request(`/orders/${order.id}/status`, "PATCH", { status: "delivered" }, 409);
    const paid = (await owner.request(`/orders/${order.id}/status`, "PATCH", { status: "paid" })).order;
    assert.ok(paid.paid_at);
    await guest.request(`/orders/${order.id}/status`, "PATCH", { status: "shipped" }, 404);
    await owner.request(`/orders/${order.id}/status`, "PATCH", { status: "pending" }, 409);
    await owner.request(`/orders/${order.id}/status`, "PATCH", { status: "shipped" });
    await owner.request(`/orders/${order.id}/status`, "PATCH", { status: "delivered" });
    await owner.request(`/orders/${order.id}/status`, "PATCH", { status: "delivered" }, 409);
    await owner.request("/payments/mock", "POST", { orderId: order.id }, 409);
    delete process.env.DEMO_MODE;
  });
  await t.test("an expired guest order cannot be recovered by replaying its checkout key", async () => {
    const expired = await guestWithItem(), headers = attempt();
    const expiredOrder = (await expired.request("/checkout", "POST", payload, 201, headers)).order;
    await pool.query("UPDATE orders SET created_at = NOW() - INTERVAL '8 days' WHERE id = $1", [expiredOrder.id]);
    await expired.request(`/orders/${expiredOrder.id}`, "GET", undefined, 404);
    await expired.request(`/checkout/attempt/${headers["Idempotency-Key"]}`, "GET", undefined, 404);
    await expired.request("/checkout", "POST", payload, 409, headers);
  });

  async function startOAuth(browser, provider = "google", returnTo = "/order/28/confirmation") {
    const location = await browser.redirect(`/auth/${provider}?returnTo=${encodeURIComponent(returnTo)}`);
    assert.equal(location.hostname, provider === "google" ? "accounts.google.com" : "www.facebook.com");
    const state = location.searchParams.get("state");
    assert.match(state, /^[A-Za-z0-9_-]{43}$/);
    return state;
  }
  function profile(id, email, verified = true) {
    return { id, emails: email ? [{ value: email, verified }] : [], name: { givenName: "Test", familyName: "OAuth" } };
  }
  async function expireOAuthAttempts() {
    const sessions = await new Promise((resolve, reject) => sessionStore.all((error, values) => error ? reject(error) : resolve(values)));
    for (const [id, saved] of Object.entries(sessions)) {
      for (const attempt of Object.values(saved.oauthAttempts || {})) attempt.createdAt = Date.now() - 11 * 60 * 1000;
      await new Promise((resolve, reject) => sessionStore.set(id, saved, error => error ? reject(error) : resolve()));
    }
  }
  await t.test("OAuth rejects missing, wrong, cross-browser, expired and replayed state before exchanging a code", async () => {
    const before = providerFixture.exchanges;
    let browser = agent();
    let state = await startOAuth(browser);
    let failed = await agent().redirect(`/auth/google/callback?code=test&state=${state}`);
    assert.equal(failed.searchParams.get("reason"), "session");
    failed = await browser.redirect(`/auth/google/callback?code=test&state=${"x".repeat(43)}`);
    assert.equal(failed.searchParams.get("reason"), "session");
    assert.equal((await browser.redirect(`/auth/google/callback?code=test&state=${state}`)).searchParams.get("reason"), "session");
    state = await startOAuth(browser);
    assert.equal((await browser.redirect("/auth/google/callback?code=test")).searchParams.get("reason"), "session");
    assert.equal((await browser.redirect(`/auth/google/callback?code=test&state=${state}`)).searchParams.get("reason"), "session");
    state = await startOAuth(browser);
    assert.equal((await browser.redirect(`/auth/facebook/callback?code=test&state=${state}`)).searchParams.get("reason"), "session");
    browser = agent(); state = await startOAuth(browser);
    await expireOAuthAttempts();
    assert.equal((await browser.redirect(`/auth/google/callback?code=test&state=${state}`)).searchParams.get("reason"), "session");
    assert.equal(providerFixture.exchanges, before);
    assert.equal((await browser.request("/auth/me")).user, null);
  });
  await t.test("OAuth cancellation and provider failures return safe feedback and preserve the destination", async () => {
    const browser = agent(); let state = await startOAuth(browser);
    let failed = await browser.redirect(`/auth/google/callback?error=access_denied&state=${state}`);
    assert.equal(failed.searchParams.get("reason"), "cancelled");
    assert.equal(failed.searchParams.get("returnTo"), "/order/28/confirmation");
    assert.equal((await browser.redirect(`/auth/google/callback?code=test&state=${state}`)).searchParams.get("reason"), "session");
    state = await startOAuth(browser);
    providerFixture.fail = true;
    failed = await browser.redirect(`/auth/google/callback?code=test&state=${state}`);
    providerFixture.fail = false;
    assert.equal(failed.searchParams.get("reason"), "failed");
    assert.equal(failed.href.includes("Private"), false);
    const clientId = process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_ID;
    failed = await browser.redirect("/auth/google?returnTo=%2Forders");
    process.env.GOOGLE_CLIENT_ID = clientId;
    assert.equal(failed.searchParams.get("reason"), "unavailable");
    assert.equal(failed.searchParams.get("returnTo"), "/orders");
  });
  await t.test("OAuth identity cannot overwrite or sign in to a different account sharing an email", async () => {
    const browser = agent();
    const emailUser = (await pool.query("SELECT id, oauth_provider, oauth_id FROM users WHERE email = $1", [credentials.email])).rows[0];
    providerFixture.profile = profile("cannot-link-password-user", credentials.email);
    let state = await startOAuth(browser);
    let failed = await browser.redirect(`/auth/google/callback?code=test&state=${state}`);
    assert.equal(failed.searchParams.get("reason"), "account_conflict");
    assert.equal((await browser.request("/auth/me")).user, null);
    assert.deepEqual((await pool.query("SELECT id, oauth_provider, oauth_id FROM users WHERE id = $1", [emailUser.id])).rows[0], emailUser);
    providerFixture.profile = profile("new-unverified-google", "unverified@example.com", false);
    state = await startOAuth(browser);
    failed = await browser.redirect(`/auth/google/callback?code=test&state=${state}`);
    assert.equal(failed.searchParams.get("reason"), "unverified_email");
    assert.equal((await pool.query("SELECT count(*) FROM users WHERE oauth_id = 'new-unverified-google'")).rows[0].count, "0");
  });
  await t.test("successful Google OAuth rotates the session, merges once and keeps guest order access", async () => {
    const browser = await guestWithItem();
    const placed = (await browser.request("/checkout", "POST", payload, 201, attempt())).order;
    await browser.request("/cart/items", "POST", { productId: 1, quantity: 2 }, 201);
    const oldCookie = browser.cookie();
    const state = await startOAuth(browser, "google", `/order/${placed.id}/confirmation`);
    providerFixture.profile = profile("stable-google-id", "oauth@example.com");
    const target = await browser.redirect(`/auth/google/callback?code=test&state=${state}`);
    assert.equal(target.href, `http://localhost:5173/order/${placed.id}/confirmation`);
    assert.notEqual(browser.cookie(), oldCookie);
    assert.equal((await agent(oldCookie).request("/auth/me")).user, null);
    const user = (await browser.request("/auth/me")).user;
    assert.equal(user.email, "oauth@example.com");
    assert.equal((await browser.request(`/orders/${placed.id}`)).order.canClaim, true);
    assert.equal((await browser.request("/cart")).items[0].quantity, 2);
    assert.equal((await browser.redirect(`/auth/google/callback?code=test&state=${state}`)).searchParams.get("reason"), "session");
    await browser.request("/auth/logout", "POST");
    const next = await startOAuth(browser, "google", "//example.com");
    providerFixture.profile = profile("stable-google-id", "changed@example.com", false);
    assert.equal((await browser.redirect(`/auth/google/callback?code=test&state=${next}`)).href, "http://localhost:5173/");
    assert.equal((await browser.request("/auth/me")).user.id, user.id);
    assert.equal((await browser.request("/cart")).items[0].quantity, 2);
    providerFixture.profile = profile("different-facebook-id", "oauth@example.com");
    const facebook = agent(); const ownState = await startOAuth(facebook, "facebook");
    assert.equal((await facebook.redirect(`/auth/facebook/callback?code=test&state=${ownState}`)).searchParams.get("reason"), "account_conflict");
    assert.equal((await pool.query("SELECT oauth_provider, oauth_id FROM users WHERE id=$1", [user.id])).rows[0].oauth_provider, "google");
  });
  await t.test("Facebook can sign in without an email and repeated identities are not duplicated", async () => {
    const browser = agent();
    providerFixture.profile = profile("facebook-without-email", null);
    let state = await startOAuth(browser, "facebook");
    await browser.redirect(`/auth/facebook/callback?code=test&state=${state}`);
    const user = (await browser.request("/auth/me")).user;
    assert.ok(user.id); assert.equal(user.email, null);
    await browser.request("/auth/logout", "POST");
    state = await startOAuth(browser, "facebook");
    await browser.redirect(`/auth/facebook/callback?code=test&state=${state}`);
    assert.equal((await browser.request("/auth/me")).user.id, user.id);
    const { findOrCreateOAuthUser } = require("../services/oauthUser");
    const identities = await Promise.all(Array.from({ length: 4 }, () => findOrCreateOAuthUser(pool, { provider: "facebook", providerId: "concurrent-fb-id" })));
    assert.equal(new Set(identities.map(item => item.id)).size, 1);
    assert.equal((await pool.query("SELECT count(*) FROM users WHERE oauth_provider='facebook' AND oauth_id='concurrent-fb-id'")).rows[0].count, "1");
  });

  await t.test("checkout refuses an oversized legacy cart until the user reviews its correction", async () => {
    const browser = await guestWithItem(), cart = await browser.request("/cart"), before = await countOrders();
    await pool.query("UPDATE cart_items SET quantity=198 WHERE cart_id=$1", [cart.cartId]);
    const rejected = await browser.request("/checkout", "POST", payload, 422, attempt());
    assert.equal(rejected.code, "CART_QUANTITY_LIMIT"); assert.equal(await countOrders(), before);
    const corrected = await browser.request("/cart"); assert.equal(corrected.items[0].quantity, 99); assert.ok(corrected.notice);
  });
  await t.test("product detail endpoint handles missing IDs and preserves authored details", async () => {
    const detail = await agent().request("/products/1");
    assert.equal(detail.id, 1); assert.deepEqual(detail.specifications, {});
    await agent().request("/products/9999999", "GET", undefined, 404);
    await agent().request("/products/invalid", "GET", undefined, 400);
    await pool.query("UPDATE products SET details='Authored details', specifications='{\"Custom\":\"Kept\"}' WHERE id=1");
    await migrate(pool);
    assert.equal((await agent().request("/products/1")).details, "Authored details");
  });
  await t.test("additive migration preserves orders from the old schema", async () => {
    const legacySchema = `legacy_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${legacySchema}`);
    const legacy = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${legacySchema}` });
    try {
      await legacy.query("CREATE TABLE orders(id SERIAL PRIMARY KEY, user_id INT, total_cents INT, status TEXT DEFAULT 'created', created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()); INSERT INTO orders(total_cents) VALUES(1234)");
      await migrate(legacy); await migrate(legacy);
      const old = (await legacy.query("SELECT * FROM orders WHERE id = 1")).rows[0];
      assert.equal(old.total_cents, 1234);
      assert.equal(old.status, "created");
      assert.equal(old.checkout_key, null);
      const source = await require("node:fs/promises").readFile(require("node:path").join(__dirname, "../db/migrations/003_catalogue_copy.sql"), "utf8");
      await legacy.query("INSERT INTO products(name,description,price_cents) VALUES('Down Gilet','Old demo',6999),('Custom product','Owner copy',123)");
      await legacy.query("INSERT INTO order_items(order_id,product_id,quantity,price_cents) VALUES(1,1,1,6999)");
      await legacy.query(source);
      assert.equal((await legacy.query("SELECT name FROM products WHERE id = 1")).rows[0].name, "Lightweight Hiking Jacket");
      assert.equal((await legacy.query("SELECT price_cents FROM products WHERE id = 1")).rows[0].price_cents, 6999);
      assert.equal((await legacy.query("SELECT product_name FROM order_items WHERE order_id = 1")).rows[0].product_name, "Down Gilet");
      const { seed } = require("../db/seed");
      await seed(legacy); await seed(legacy);
      assert.equal((await legacy.query("SELECT count(*) FROM products")).rows[0].count, "17");
      assert.equal((await legacy.query("SELECT description FROM products WHERE name = 'Custom product'")).rows[0].description, "Owner copy");
    } finally { await legacy.end(); await admin.query(`DROP SCHEMA ${legacySchema} CASCADE`); }
  });
});
