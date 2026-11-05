const express = require("express");
const pool = require("../db");
const { getOrCreateCartId, lockCart } = require("../services/cartAccess");
const router = express.Router();
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.get("/", async (req, res) => {
  try {
    const cartId = await getOrCreateCartId(req, pool);
    const items = await pool.query(`SELECT ci.id AS cart_item_id, ci.quantity, p.id AS product_id,
      p.name, p.description, p.price_cents, p.image_url FROM cart_items ci
      JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = $1 ORDER BY ci.id DESC`, [cartId]);
    res.json({ cartId, items: items.rows });
  } catch (error) { console.error(error.code); res.status(500).json({ error: "Could not load your cart." }); }
});
async function write(req, res, operation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cartId = await getOrCreateCartId(req, client);
    await lockCart(client, cartId);
    const result = await operation(client, cartId);
    await client.query("COMMIT");
    return res.status(req.method === "POST" ? 201 : 200).json(result);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23503") return res.status(404).json({ error: "Product not found." });
    return res.status(error.status || 500).json({ error: error.status ? error.message : "Could not update your cart." });
  } finally { client.release(); }
}
function notFound() { throw Object.assign(new Error("Cart item not found."), { status: 404 }); }
router.post("/items", async (req, res) => {
  const pid = Number(req.body?.productId), qty = Number(req.body?.quantity ?? 1);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(qty) || qty <= 0 || qty > 99) return res.status(400).json({ error: "Use a valid product and a quantity between 1 and 99." });
  return write(req, res, async (db, cartId) => {
    const existing = await db.query("SELECT quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2", [cartId, pid]);
    if ((existing.rows[0]?.quantity || 0) + qty > 99) throw Object.assign(new Error("Use at most 99 items of one product."), { status: 422 });
    const item = await db.query(`INSERT INTO cart_items(cart_id, product_id, quantity) VALUES ($1,$2,$3)
      ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = NOW() RETURNING *`, [cartId, pid, qty]);
    return { item: item.rows[0] };
  });
});
router.patch("/items/:id", async (req, res) => {
  const id = Number(req.params.id), qty = Number(req.body?.quantity);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(qty) || qty <= 0 || qty > 99) return res.status(400).json({ error: "Use a quantity between 1 and 99." });
  return write(req, res, async (db, cartId) => {
    const item = await db.query("UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2 AND cart_id = $3 RETURNING *", [qty, id, cartId]);
    if (!item.rowCount) notFound();
    return { item: item.rows[0] };
  });
});
router.delete("/items/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid cart item." });
  return write(req, res, async (db, cartId) => {
    const item = await db.query("DELETE FROM cart_items WHERE id = $1 AND cart_id = $2 RETURNING id", [id, cartId]);
    if (!item.rowCount) notFound();
    return { ok: true };
  });
});
module.exports = router;
