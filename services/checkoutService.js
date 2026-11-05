const { randomUUID } = require("node:crypto");
const { getOrCreateCartId, lockCart } = require("./cartAccess");
const { guestAccessExpires } = require("./orderAccess");
const { fingerprint } = require("../validation/checkout");
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });
function ownsAttempt(req, order) {
  if (!order) return false;
  return order.user_id != null ? order.user_id === req.session.userId
    : !!req.session.checkoutOwner && guestAccessExpires(order) > Date.now() && order.checkout_owner === `guest:${req.session.checkoutOwner}`;
}
async function createOrder(pool, req, value, key) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`checkout:${key}`]);
    const existing = (await client.query("SELECT * FROM orders WHERE checkout_key = $1", [key])).rows[0];
    if (existing) {
      if (!ownsAttempt(req, existing)) throw failure(409, "CHECKOUT_KEY_IN_USE", "Start a new checkout attempt for this account.");
      await client.query("COMMIT");
      return { order: existing, replay: true, conflict: existing.checkout_hash !== fingerprint(value) };
    }
    const cartId = await getOrCreateCartId(req, client);
    await lockCart(client, cartId);
    const items = (await client.query(`SELECT ci.product_id, ci.quantity, p.price_cents, p.name
      FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = $1 ORDER BY ci.id`, [cartId])).rows;
    if (!items.length) throw failure(400, "CART_EMPTY", "Your cart is empty.");
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price_cents, 0);
    if (!Number.isSafeInteger(subtotal) || subtotal > 2147483647) throw failure(422, "CART_TOTAL_TOO_LARGE", "Reduce the quantity of items in your cart.");
    const userId = req.session.userId || null;
    const shipping = value.shipping;
    const order = (await client.query(`INSERT INTO orders (
      user_id, email, first_name, last_name, shipping_address1, shipping_address2, shipping_city, shipping_postcode,
      shipping_country, status, currency, subtotal_cents, shipping_cents, total_cents, guest_token,
      checkout_key, checkout_owner, checkout_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending','GBP',$10,0,$10,$11,$12,$13,$14) RETURNING *`,
    [userId, value.email, value.firstName, value.lastName, shipping.address1, shipping.address2 || null,
      shipping.city, shipping.postcode, shipping.country, subtotal, userId ? null : randomUUID(), key,
      userId ? `user:${userId}` : `guest:${req.session.checkoutOwner}`, fingerprint(value)])).rows[0];
    for (const item of items) await client.query(`INSERT INTO order_items(order_id, product_id, quantity, price_cents, product_name)
      VALUES ($1,$2,$3,$4,$5)`, [order.id, item.product_id, item.quantity, item.price_cents, item.name]);
    await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cartId]);
    await client.query("COMMIT");
    return { order, replay: false, conflict: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
module.exports = { createOrder, failure, ownsAttempt };
