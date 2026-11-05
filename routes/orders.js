const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/requireAuth");
const { guestToken, canRead, publicOrder } = require("../services/orderAccess");
const { advanceStatus } = require("../services/orderStatus");
const { saveSession } = require("../auth/session");
const router = express.Router();
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
const validId = (value) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= 2147483647;
router.get("/", requireAuth, async (req, res) => {
  const orders = await pool.query("SELECT id, status, total_cents, created_at, paid_at FROM orders WHERE user_id = $1 ORDER BY id DESC", [req.session.userId]);
  res.json({ orders: orders.rows });
});
router.get("/:id", async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "Invalid order number." });
  const order = (await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id])).rows[0];
  if (!canRead(req, order)) return res.status(404).json({ error: "This order is unavailable in this session. Sign in to the owning account or use the browser in which you placed it." });
  const items = await pool.query(`SELECT oi.product_id, COALESCE(oi.product_name, p.name, 'Unavailable product') AS name,
    oi.price_cents, oi.quantity, (oi.price_cents * oi.quantity) AS line_total_cents
    FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1 ORDER BY oi.id`, [order.id]);
  res.json({ order: publicOrder(req, order), items: items.rows });
});
router.post("/:id/claim", requireAuth, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "Invalid order number." });
  const id = Number(req.params.id);
  const token = guestToken(req, id);
  const owned = (await pool.query("SELECT * FROM orders WHERE id = $1 AND user_id = $2", [id, req.session.userId])).rows[0];
  if (owned) return res.json({ order: publicOrder(req, owned) });
  if (!token) return res.status(404).json({ error: "This guest order is not available in your browser session." });
  const updated = await pool.query(`UPDATE orders SET user_id = $1, guest_token = NULL, updated_at = NOW()
    WHERE id = $2 AND user_id IS NULL AND guest_token = $3 RETURNING *`, [req.session.userId, id, token]);
  if (!updated.rowCount) return res.status(404).json({ error: "Order not found." });
  delete req.session.guestOrders[id];
  await saveSession(req);
  res.json({ order: publicOrder(req, updated.rows[0]) });
});
router.patch("/:id/status", requireAuth, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "Invalid order number." });
  try { res.json({ order: publicOrder(req, await advanceStatus(pool, req, Number(req.params.id), req.body?.status)) }); }
  catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : "Could not update order.", code: error.code }); }
});
module.exports = router;
