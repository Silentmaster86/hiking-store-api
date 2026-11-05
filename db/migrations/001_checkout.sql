CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT NOT NULL,
  first_name TEXT, last_name TEXT, oauth_provider TEXT, oauth_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_provider_id_unique ON users (oauth_provider, oauth_id)
  WHERE oauth_provider IS NOT NULL AND oauth_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
  price_cents INT NOT NULL CHECK (price_cents >= 0), image_url TEXT,
  category_slug TEXT NOT NULL DEFAULT 'accessories',
  created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS carts (
  id SERIAL PRIMARY KEY, user_id INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS cart_items (
  id SERIAL PRIMARY KEY, cart_id INT REFERENCES carts(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id), quantity INT NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(cart_id, product_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id) ON DELETE SET NULL,
  total_cents INT NOT NULL CHECK (total_cents >= 0), status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address1 TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address2 TEXT,
  ADD COLUMN IF NOT EXISTS shipping_city TEXT,
  ADD COLUMN IF NOT EXISTS shipping_postcode TEXT,
  ADD COLUMN IF NOT EXISTS shipping_country TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'GBP',
  ADD COLUMN IF NOT EXISTS subtotal_cents INT,
  ADD COLUMN IF NOT EXISTS shipping_cents INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guest_token TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS checkout_key UUID,
  ADD COLUMN IF NOT EXISTS checkout_owner TEXT,
  ADD COLUMN IF NOT EXISTS checkout_hash TEXT;
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_key_unique ON orders(checkout_key) WHERE checkout_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY, order_id INT REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id), quantity INT NOT NULL CHECK (quantity > 0),
  price_cents INT NOT NULL CHECK (price_cents >= 0),
  created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name TEXT;
