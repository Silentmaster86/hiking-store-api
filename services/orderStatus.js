const { failure } = require("./checkoutService");
const flow = ["pending", "paid", "shipped", "delivered"];
async function advanceStatus(pool, req, id, target) {
  if (process.env.DEMO_MODE !== "true") throw failure(403, "DEMO_DISABLED", "Order simulation is disabled.");
  if (!req.session.userId) throw failure(401, "UNAUTHORIZED", "Please sign in.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = (await client.query("SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, req.session.userId])).rows[0];
    if (!order) throw failure(404, "NOT_FOUND", "Order not found.");
    const index = flow.indexOf(order.status);
    if (index < 0 || index === flow.length - 1 || target !== flow[index + 1]) throw failure(409, "INVALID_TRANSITION", "This order cannot move to that status.");
    const updated = await client.query(`UPDATE orders SET status = $1, updated_at = NOW(),
      paid_at = CASE WHEN $1 = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END WHERE id = $2 RETURNING *`, [target, id]);
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
module.exports = { advanceStatus };
