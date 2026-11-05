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
      await client.query(
        `INSERT INTO cart_items (cart_id, product_id, quantity)
         SELECT $1, product_id, quantity FROM cart_items WHERE cart_id = $2
         ON CONFLICT (cart_id, product_id)
         DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity,
                       updated_at = NOW()`,
        [cart.rows[0].id, guestCartId]
      );
      await client.query("DELETE FROM cart_items WHERE cart_id = $1", [guestCartId]);
      await client.query("DELETE FROM carts WHERE id = $1 AND user_id IS NULL", [guestCartId]);
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
