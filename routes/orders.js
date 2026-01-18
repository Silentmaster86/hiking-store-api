// routes/orders.js
const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

router.post("/claim", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const guestToken = req.body?.guestToken || req.body?.guest_token;

  if (!guestToken) return res.status(400).json({ error: "guestToken is required." });

  try {
    const updated = await pool.query(
      `UPDATE "orders"
       SET user_id = $1, guest_token = NULL, updated_at = NOW()
       WHERE guest_token = $2 AND user_id IS NULL AND status IN ('pending','paid')
       RETURNING id, status, total_cents, created_at`,
      [userId, guestToken]
    );

    if (!updated.rows.length) return res.status(404).json({ error: "Order not found." });

    res.json({ order: updated.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


router.get("/", requireAuth, async (req, res) => {
  const userId = req.session.userId;

  const result = await pool.query(
    `SELECT id, status, total_cents, created_at, paid_at
     FROM "orders"
     WHERE user_id = $1
     ORDER BY id DESC`,
    [userId]
  );

  res.json({ orders: result.rows });
});

router.get("/:id", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const orderId = Number(req.params.id);
  
  if (!Number.isInteger(orderId)) return res.status(400).json({ error: "Invalid order id" });

  const order = await pool.query(
    `SELECT * FROM "orders" WHERE id = $1 AND user_id = $2`,
    [orderId, userId]
  );
  if (!order.rows.length) return res.status(404).json({ error: "Not found" });

    const items = await pool.query(
      `SELECT 
          oi.product_id,
          COALESCE(p.name, 'Deleted product') AS name,
          oi.price_cents,
          oi.quantity,
          (oi.price_cents * oi.quantity) AS line_total_cents
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1
       ORDER BY oi.id ASC`,
      [orderId]
    );


  res.json({ order: order.rows[0], items: items.rows });
});

// PATCH /orders/:id/status  body: { status }
router.patch("/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};

  const allowed = ["pending", "paid", "shipped", "delivered", "cancelled"];
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });

  try {
    // tylko owner (zalogowany user) może zmieniać status swojego ordera
    if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });

    const result = await pool.query(
      `UPDATE orders
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, status, total_cents, created_at, updated_at`,
      [status, id, req.session.userId]
    );

    if (!result.rows.length) return res.status(404).json({ error: "Order not found" });

    return res.json({ order: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});


module.exports = router;
