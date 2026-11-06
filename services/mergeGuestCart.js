const { MAX_CART_QUANTITY } = require("./cartPolicy");
// Lock and consume the guest cart once, including when login requests overlap.
async function mergeGuestCart(pool, userId, guestCartId) {
  if (!guestCartId) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const guest = await client.query(
      "SELECT id FROM carts WHERE id = $1 AND user_id IS NULL FOR UPDATE",
      [guestCartId]
    );
    if (guest.rows.length) {
      const cart = await client.query(
        `INSERT INTO carts (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
         RETURNING id`,
        [userId]
      );
      const adjusted = (await client.query(`SELECT 1 FROM cart_items guest
        LEFT JOIN cart_items account ON account.cart_id = $1 AND account.product_id = guest.product_id
        WHERE guest.cart_id = $2 AND guest.quantity::bigint + COALESCE(account.quantity, 0)::bigint > $3 LIMIT 1`,
      [cart.rows[0].id, guestCartId, MAX_CART_QUANTITY])).rowCount > 0;
      await client.query(
        `INSERT INTO cart_items (cart_id, product_id, quantity)
         SELECT $1, product_id, LEAST(quantity, $3) FROM cart_items WHERE cart_id = $2
         ON CONFLICT (cart_id, product_id)
         DO UPDATE SET quantity = LEAST($3::bigint, cart_items.quantity::bigint + EXCLUDED.quantity),
                       updated_at = NOW()`,
        [cart.rows[0].id, guestCartId, MAX_CART_QUANTITY]
      );
      await client.query("DELETE FROM cart_items WHERE cart_id = $1", [guestCartId]);
      await client.query("DELETE FROM carts WHERE id = $1 AND user_id IS NULL", [guestCartId]);
      await client.query("COMMIT");
      return { adjusted };
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = mergeGuestCart;
