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

        -- Email może być NULL dla OAuth-only userów (FB czasem nie zwraca email)
        email TEXT UNIQUE,

        -- Dla OAuth-only ustawiamy "__OAUTH_ONLY__"
        password_hash TEXT NOT NULL,

        first_name TEXT,
        last_name TEXT,

        -- OAuth
        oauth_provider TEXT,
        oauth_id TEXT,

        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Unikalność pary provider+id (może być NULL dla email/password userów)
      CREATE UNIQUE INDEX users_oauth_provider_id_unique
      ON users (oauth_provider, oauth_id)
      WHERE oauth_provider IS NOT NULL AND oauth_id IS NOT NULL;

      CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price_cents INT NOT NULL CHECK (price_cents >= 0),
        image_url TEXT,
        category_slug TEXT NOT NULL DEFAULT 'accessories',
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
      INSERT INTO products (name, description, price_cents, image_url, category_slug) VALUES
      -- backpacks (4)
      ('Trail Backpack 35L', 'Lightweight 35L backpack with breathable back panel.', 8999, NULL, 'backpacks'),
      ('Daypack 20L', 'Compact daypack with hydration sleeve.', 4999, NULL, 'backpacks'),
      ('Waterproof Pack Cover', 'Rain cover fits 20–45L packs.', 1299, NULL, 'backpacks'),
      ('Backpack Hip Belt Pouch', 'Quick-access pouch for snacks and phone.', 1599, NULL, 'backpacks'),
          
      -- jackets (4)
      ('Waterproof Hiking Jacket', 'Packable waterproof jacket, windproof and breathable.', 12999, NULL, 'jackets'),
      ('Fleece Midlayer', 'Warm fleece for chilly hikes.', 3999, NULL, 'jackets'),
      ('Down Gilet', 'Light insulated vest for layering.', 6999, NULL, 'jackets'),
      ('Rain Poncho', 'Ultralight poncho for sudden rain.', 2499, NULL, 'jackets'),
          
      -- boots (4)
      ('Hiking Boots Mid', 'Supportive mid boots with grippy outsole.', 8999, NULL, 'boots'),
      ('Trail Shoes', 'Light trail shoes for fast hikes.', 7499, NULL, 'boots'),
      ('Merino Hiking Socks', 'Cushioned socks for long walks.', 1299, NULL, 'boots'),
      ('Boot Waterproofing Spray', 'Protects leather and textile footwear.', 999, NULL, 'boots'),
          
      -- accessories (4)
      ('Trekking Poles (Pair)', 'Aluminum trekking poles with quick-lock system.', 4999, NULL, 'accessories'),
      ('Insulated Bottle 750ml', 'Keeps drinks cold 24h / hot 12h.', 2499, NULL, 'accessories'),
      ('Headlamp 300lm', 'Bright headlamp with multiple modes.', 1999, NULL, 'accessories'),
      ('First Aid Mini Kit', 'Compact kit for the trail.', 1499, NULL, 'accessories');
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
