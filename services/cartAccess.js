const { randomUUID } = require("node:crypto");
async function getOrCreateCartId(req, db) {
  req.session.checkoutOwner ||= randomUUID();
  const userId = req.session.userId;
  if (userId) {
    const cart = await db.query(`INSERT INTO carts(user_id) VALUES ($1)
      ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING id`, [userId]);
    return cart.rows[0].id;
  }
  if (req.session.cartId) {
    const cart = await db.query("SELECT id FROM carts WHERE id = $1 AND user_id IS NULL", [req.session.cartId]);
    if (cart.rowCount) return cart.rows[0].id;
  }
  const cart = await db.query("INSERT INTO carts(user_id) VALUES (NULL) RETURNING id");
  req.session.cartId = cart.rows[0].id;
  return req.session.cartId;
}
async function lockCart(db, cartId) {
  await db.query("SELECT id FROM carts WHERE id = $1 FOR UPDATE", [cartId]);
}
module.exports = { getOrCreateCartId, lockCart };
