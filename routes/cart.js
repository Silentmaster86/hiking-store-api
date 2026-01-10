const express = require("express");
const pool = require("../db");

const router = express.Router();

/**
 * Get or create cart for:
 * - logged user (user_id)
 * - guest (session.cartId)
 */
async function getOrCreateCartId(req) {
  const userId = req.session.userId || null;

    console.log("SESSION:", {
        userId: req.session.userId,
        cartId: req.session.cartId
    });

    
// 1) Logged user
  if (userId) {
    const existing = await pool.query(
      `SELECT id FROM carts WHERE user_id = $1`,
      [userId]
    );

    if (existing.rows.length) {
      console.log("CART: using existing user cart");
      return existing.rows[0].id;
    }

    console.log("CART: creating new user cart");
    const created = await pool.query(
      `INSERT INTO carts (user_id) VALUES ($1) RETURNING id`,
      [userId]
    );
    return created.rows[0].id;
  }

  // 2) Guest: cart stored in session
  if (req.session.cartId) {
    const existing = await pool.query(
      `SELECT id FROM carts WHERE id = $1 AND user_id IS NULL`,
      [req.session.cartId]
    );

    if (existing.rows.length) {
      console.log("CART: using existing guest cart");
      return existing.rows[0].id;
    }
  }


// 3) Create new guest cart
  const created = await pool.query(
    `INSERT INTO carts (user_id) VALUES (NULL) RETURNING id`
  );

  req.session.cartId = created.rows[0].id;
  console.log("CART: created new guest cart", created.rows[0].id);

  return created.rows[0].id;
}

/**
 * GET /cart
 */
router.get("/", async (req, res) => {
  try {
    const cartId = await getOrCreateCartId(req);

    const items = await pool.query(
      `SELECT
         ci.id as cart_item_id,
         ci.quantity,
         p.id as product_id,
         p.name,
         p.description,
         p.price_cents,
         p.image_url
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = $1
       ORDER BY ci.id DESC`,
      [cartId]
    );

    res.json({ cartId, items: items.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /cart/items
 */
router.post("/items", async (req, res) => {
  const { productId, quantity = 1 } = req.body || {};
  const pid = Number(productId);
  const qty = Number(quantity);

  if (!Number.isInteger(pid) || pid <= 0)
    return res.status(400).json({ error: "Invalid productId" });
  if (!Number.isInteger(qty) || qty <= 0)
    return res.status(400).json({ error: "Invalid quantity" });

  try {
    const cartId = await getOrCreateCartId(req);

    const result = await pool.query(
      `INSERT INTO cart_items (cart_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (cart_id, product_id)
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity,
                    updated_at = NOW()
       RETURNING id, cart_id, product_id, quantity`,
      [cartId, pid, qty]
    );

    res.status(201).json({ item: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /cart/items/:id
 */
router.patch("/items/:id", async (req, res) => {
  const itemId = Number(req.params.id);
  const qty = Number(req.body?.quantity);

  if (!Number.isInteger(itemId))
    return res.status(400).json({ error: "Invalid id" });
  if (!Number.isInteger(qty) || qty <= 0)
    return res.status(400).json({ error: "Invalid quantity" });

  try {
    const cartId = await getOrCreateCartId(req);

    const updated = await pool.query(
      `UPDATE cart_items
       SET quantity = $1, updated_at = NOW()
       WHERE id = $2 AND cart_id = $3
       RETURNING id, product_id, quantity`,
      [qty, itemId, cartId]
    );

    if (!updated.rows.length)
      return res.status(404).json({ error: "Not found" });

    res.json({ item: updated.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * DELETE /cart/items/:id
 */
router.delete("/items/:id", async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId))
    return res.status(400).json({ error: "Invalid id" });

  try {
    const cartId = await getOrCreateCartId(req);

    const deleted = await pool.query(
      `DELETE FROM cart_items
       WHERE id = $1 AND cart_id = $2
       RETURNING id`,
      [itemId, cartId]
    );

    if (!deleted.rows.length)
      return res.status(404).json({ error: "Not found" });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
