const express = require("express");
const pool = require("../db");
const crypto = require("crypto");

const router = express.Router();

async function getOrCreateCartId(req) {
  const userId = req.session.userId || null;

  if (userId) {
    const existing = await pool.query(`SELECT id FROM carts WHERE user_id = $1`, [userId]);
    if (existing.rows.length) return existing.rows[0].id;

    const created = await pool.query(
      `INSERT INTO carts (user_id) VALUES ($1) RETURNING id`,
      [userId]
    );
    return created.rows[0].id;
  }

  if (req.session.cartId) {
    const existing = await pool.query(
      `SELECT id FROM carts WHERE id = $1 AND user_id IS NULL`,
      [req.session.cartId]
    );
    if (existing.rows.length) return existing.rows[0].id;
  }

  const created = await pool.query(`INSERT INTO carts (user_id) VALUES (NULL) RETURNING id`);
  req.session.cartId = created.rows[0].id;
  return created.rows[0].id;
}

/**
 * POST /checkout
 */
router.post("/", async (req, res) => {
  const userId = req.session.userId || null;
  const guestToken = userId ? null : crypto.randomUUID();

  const { email = null, firstName = null, lastName = null, shipping = {} } = req.body || {};
  const { address1 = null, address2 = null, city = null, postcode = null, country = "UK" } = shipping || {};

  // guest musi mieć email
  if (!userId && !email) {
    return res.status(400).json({ error: "Email is required for guest checkout." });
  }

  try {
    const cartId = await getOrCreateCartId(req);

    const cartItems = await pool.query(
      `SELECT
         ci.product_id,
         ci.quantity,
         p.name,
         p.price_cents
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = $1
       ORDER BY ci.id ASC`,
      [cartId]
    );

    if (!cartItems.rows.length) {
      return res.status(400).json({ error: "Cart is empty." });
    }

    let subtotal = 0;
    for (const row of cartItems.rows) {
      subtotal += row.price_cents * row.quantity;
    }
    const shippingCents = 0;
    const total = subtotal + shippingCents;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const orderResult = await client.query(
        `INSERT INTO orders (
           user_id, email, first_name, last_name,
           shipping_address1, shipping_address2, shipping_city, shipping_postcode, shipping_country,
           status, currency,
           subtotal_cents, shipping_cents, total_cents,
           guest_token
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending','GBP',$10,$11,$12,$13)
         RETURNING id, total_cents, status, created_at, guest_token`,
        [
          userId,
          email,
          firstName,
          lastName,
          address1,
          address2,
          city,
          postcode,
          country,
          subtotal,
          shippingCents,
          total,
          guestToken,
        ]
      );

      const order = orderResult.rows[0];

      for (const item of cartItems.rows) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, price_cents)
           VALUES ($1, $2, $3, $4)`,
          [order.id, item.product_id, item.quantity, item.price_cents]
        );
      }

      await client.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);

      await client.query("COMMIT");

      return res.status(201).json({
        order: {
          id: order.id,
          total_cents: order.total_cents,
          subtotal_cents: subtotal,
          shipping_cents: shippingCents,
          status: order.status,
          created_at: order.created_at,
          guestToken: order.guest_token || null,
        },
      });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
