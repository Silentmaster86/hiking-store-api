const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const passport = require("passport");

async function mergeGuestCartIntoUserCart(req) {
  const userId = req.session.userId;
  const guestCartId = req.session.cartId;

  if (!userId || !guestCartId) return;

  // create/get user cart
  let userCart = await pool.query(`SELECT id FROM carts WHERE user_id = $1`, [userId]);
  let userCartId;

  if (userCart.rows.length) {
    userCartId = userCart.rows[0].id;
  } else {
    const created = await pool.query(
      `INSERT INTO carts (user_id) VALUES ($1) RETURNING id`,
      [userId]
    );
    userCartId = created.rows[0].id;
  }

  // read guest items
  const guestItems = await pool.query(
    `SELECT product_id, quantity FROM cart_items WHERE cart_id = $1`,
    [guestCartId]
  );

  // move items (upsert quantities)
  for (const item of guestItems.rows) {
    await pool.query(
      `INSERT INTO cart_items (cart_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (cart_id, product_id)
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity,
                    updated_at = NOW()`,
      [userCartId, item.product_id, item.quantity]
    );
  }

  // delete guest cart + items
  await pool.query(`DELETE FROM cart_items WHERE cart_id = $1`, [guestCartId]);
  await pool.query(`DELETE FROM carts WHERE id = $1`, [guestCartId]);

  // clear guest session cart
  delete req.session.cartId;
}

async function createGuestCartFromUserCart(req, userId) {
  // znajdź user cart
  const userCart = await pool.query(`SELECT id FROM carts WHERE user_id = $1`, [userId]);
  if (!userCart.rows.length) return;

  const userCartId = userCart.rows[0].id;

  // utwórz nowy guest cart
  const guestCart = await pool.query(
    `INSERT INTO carts (user_id) VALUES (NULL) RETURNING id`
  );
  const guestCartId = guestCart.rows[0].id;

  // pobierz itemy z koszyka usera
  const items = await pool.query(
    `SELECT product_id, quantity FROM cart_items WHERE cart_id = $1`,
    [userCartId]
  );

  // skopiuj itemy do guest cart
  for (const it of items.rows) {
    await pool.query(
      `INSERT INTO cart_items (cart_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (cart_id, product_id)
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity,
                    updated_at = NOW()`,
      [guestCartId, it.product_id, it.quantity]
    );
  }

  // ustaw guest cart w sesji
  req.session.cartId = guestCartId;
}


const router = express.Router();

function toPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    createdAt: row.created_at,
  };
}

/**
 * POST /auth/register
 * body: { email, password, firstName?, lastName? }
 */
router.post("/register", async (req, res) => {
  const { email, password, firstName = null, lastName = null } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Email is already in use." });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const created = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, first_name, last_name, created_at`,
      [email, passwordHash, firstName, lastName]
    );

    // auto-login po rejestracji
    
    req.session.userId = created.rows[0].id;
    await mergeGuestCartIntoUserCart(req);

    return res.status(201).json({ user: toPublicUser(created.rows[0]) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /auth/login
 * body: { email, password }
 */
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const result = await pool.query(
      `SELECT id, email, password_hash, first_name, last_name, created_at
       FROM users
       WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    req.session.userId = user.id;
    await mergeGuestCartIntoUserCart(req);
    return res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /auth/logout
 */
router.post("/logout", async (req, res) => {
  const userId = req.session.userId;

  // jeśli nie był zalogowany
  if (!userId) return res.json({ ok: true });

  try {
    // usuń login
    delete req.session.userId;

    // utwórz guest cart na bazie user cart (żeby koszyk "został")
    await createGuestCartFromUserCart(req, userId);

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not log out." });
  }
});



/**
 * GET /auth/me
 */
router.get("/me", async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });

  try {
    const result = await pool.query(
      `SELECT id, email, first_name, last_name, created_at
       FROM users
       WHERE id = $1`,
      [req.session.userId]
    );
    if (result.rows.length === 0) return res.status(401).json({ user: null });

    return res.json({ user: toPublicUser(result.rows[0]) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// --- OAUTH: FACEBOOK ---
router.get("/facebook", passport.authenticate("facebook", { scope: ["email"] }));

router.get(
  "/facebook/callback",
  passport.authenticate("facebook", {
    failureRedirect: `${process.env.CORS_ORIGIN}/login?error=facebook`,
  }),
  async (req, res) => {
    req.session.userId = req.user.id;
    await mergeGuestCartIntoUserCart(req);
    return res.redirect(`${process.env.CORS_ORIGIN}/`);
  }
);

// --- OAUTH: GOOGLE ---
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${process.env.CORS_ORIGIN}/login?error=google`,
  }),
  async (req, res) => {
    req.session.userId = req.user.id;
    await mergeGuestCartIntoUserCart(req);
    return res.redirect(`${process.env.CORS_ORIGIN}/`);
  }
);


module.exports = router;
