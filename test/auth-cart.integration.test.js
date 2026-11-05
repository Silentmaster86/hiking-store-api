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
  const express = require("express"), session = require("express-session"), passport = require("passport");
  const app = express();
  app.use(express.json());
  app.use(session({ secret: randomUUID(), resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  for (const route of ["auth", "cart", "checkout", "orders", "payments"]) app.use(`/${route}`, require(`../routes/${route}`));
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
    return { cookie: () => cookie, async request(path, method = "GET", body, expected = 200, headers = {}) {
      const response = await fetch(origin + path, { method,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers },
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
  await t.test("migration can be applied twice without losing products", async () => {
    await migrate(pool);
    assert.equal((await pool.query("SELECT count(*) FROM schema_migrations")).rows[0].count, "3");
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
      const response = await fetch(origin + "/checkout", { method: "POST", headers: { "Content-Type": "application/json", Cookie: parallel.cookie(), ...headers }, body: JSON.stringify(payload) });
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
      const response = await fetch(origin + "/checkout", { method: "POST", headers: { "Content-Type": "application/json", Cookie: parallel.cookie(), ...attempt() }, body: JSON.stringify(payload) });
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
