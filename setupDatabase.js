require("dotenv").config();
const pool = require("./db");

async function setup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      DROP TABLE IF EXISTS order_items;
      DROP TABLE IF EXISTS orders;
      DROP TABLE IF EXISTS cart_items;
      DROP TABLE IF EXISTS carts;
      DROP TABLE IF EXISTS products;
      DROP TABLE IF EXISTS users;
    `);

    await client.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price_cents INT NOT NULL CHECK (price_cents >= 0),
        image_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE carts (
        id SERIAL PRIMARY KEY,
        user_id INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE cart_items (
        id SERIAL PRIMARY KEY,
        cart_id INT REFERENCES carts(id) ON DELETE CASCADE,
        product_id INT REFERENCES products(id),
        quantity INT NOT NULL CHECK (quantity > 0),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(cart_id, product_id)
      );

      CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        total_cents INT NOT NULL CHECK (total_cents >= 0),
        status TEXT NOT NULL DEFAULT 'created',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE order_items (
        id SERIAL PRIMARY KEY,
        order_id INT REFERENCES orders(id) ON DELETE CASCADE,
        product_id INT REFERENCES products(id),
        quantity INT NOT NULL CHECK (quantity > 0),
        price_cents INT NOT NULL CHECK (price_cents >= 0),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // seed products
    await client.query(`
      INSERT INTO products (name, description, price_cents, image_url) VALUES
      ('Trail Backpack 35L', 'Lightweight 35L backpack with breathable back panel.', 8999, ''),
      ('Waterproof Hiking Jacket', 'Packable waterproof jacket, windproof and breathable.', 12999, ''),
      ('Trekking Poles (Pair)', 'Aluminum trekking poles with quick-lock system.', 4999, ''),
      ('Insulated Bottle 750ml', 'Keeps drinks cold 24h / hot 12h.', 2499, '');
    `);

    await client.query("COMMIT");
    console.log("✅ Database setup complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Database setup failed:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

setup();
