const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

test("account cart survives repeated logout/login without duplication", {
  skip: !process.env.TEST_DATABASE_URL && "Set TEST_DATABASE_URL to a dedicated PostgreSQL test database",
}, async (t) => {
  const { Pool } = require("pg");
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  t.after(async () => {
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  const pool = require("../db");
  await pool.query(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT NOT NULL,
      first_name TEXT, last_name TEXT, created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE products (
      id SERIAL PRIMARY KEY, name TEXT, description TEXT, price_cents INT, image_url TEXT
    );
    CREATE TABLE carts (id SERIAL PRIMARY KEY, user_id INT UNIQUE REFERENCES users(id));
    CREATE TABLE cart_items (
      id SERIAL PRIMARY KEY, cart_id INT REFERENCES carts(id), product_id INT REFERENCES products(id),
      quantity INT NOT NULL CHECK (quantity > 0), updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(cart_id, product_id)
    );
    INSERT INTO products (name, description, price_cents) VALUES ('Test backpack', 'Test only', 1499);
  `);
  const express = require("express");
  const session = require("express-session");
  const passport = require("passport");
  const app = express();
  app.use(express.json());
  app.use(session({ secret: randomUUID(), resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use("/auth", require("../routes/auth"));
  app.use("/cart", require("../routes/cart"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  async function request(path, method = "GET", body) {
    const response = await fetch(origin + path, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const next = response.headers.getSetCookie()[0];
    if (next) cookie = next.split(";")[0];
    const data = await response.json();
    assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
    return data;
  }
  const credentials = { email: "regression@example.com", password: "regression-test-password" };
  await request("/auth/register", "POST", credentials);
  await request("/cart/items", "POST", { productId: 1, quantity: 1 });
  for (let cycle = 0; cycle < 3; cycle++) {
    await request("/auth/logout", "POST");
    assert.equal((await request("/auth/me")).user, null);
    assert.deepEqual((await request("/cart")).items, []);
    await request("/auth/login", "POST", credentials);
    const cart = await request("/cart");
    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].quantity, 1, `Quantity changed in logout/login cycle ${cycle}`);
  }
  await request("/auth/logout", "POST");
  await request("/cart/items", "POST", { productId: 1, quantity: 2 });
  await request("/auth/login", "POST", credentials);
  assert.equal((await request("/cart")).items[0].quantity, 3, "Real guest additions must merge once");
  await request("/auth/login", "POST", credentials);
  assert.equal((await request("/cart")).items[0].quantity, 3, "Repeated login must not merge twice");

  const mergeGuestCart = require("../services/mergeGuestCart");
  const guest = await pool.query("INSERT INTO carts (user_id) VALUES (NULL) RETURNING id");
  await pool.query("INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, 1, 2)", [guest.rows[0].id]);
  const userId = (await request("/auth/me")).user.id;
  await Promise.all([
    mergeGuestCart(pool, userId, guest.rows[0].id),
    mergeGuestCart(pool, userId, guest.rows[0].id),
  ]);
  assert.equal((await request("/cart")).items[0].quantity, 5, "Concurrent guest merges must consume the guest cart once");
});
