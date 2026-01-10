const express = require("express");
const pool = require("../db");

const router = express.Router();

router.post("/mock", async (req, res) => {
  const userId = req.session.userId || null;

  const orderIdRaw = req.body?.orderId;
  const guestToken = req.body?.guestToken || req.body?.guest_token || null;

  const orderId = orderIdRaw !== undefined ? Number(orderIdRaw) : null;
  if (orderIdRaw !== undefined && !Number.isInteger(orderId)) {
    return res.status(400).json({ error: "Invalid orderId" });
  }

  try {
    let updated;

    // 1) Logged-in user pays their own pending order
    if (userId && Number.isInteger(orderId)) {
      updated = await pool.query(
        `UPDATE orders
         SET status = 'paid', paid_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status = 'pending'
         RETURNING id, status, total_cents, paid_at`,
        [orderId, userId]
      );
    } else {
      // 2) Guest payment (must have guestToken)
      if (!guestToken) {
        return res.status(400).json({ error: "guestToken is required for guest payment." });
      }

      // if orderId provided - match both, otherwise pay by token only
      if (Number.isInteger(orderId)) {
        updated = await pool.query(
          `UPDATE orders
           SET status = 'paid', paid_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND guest_token = $2 AND user_id IS NULL AND status = 'pending'
           RETURNING id, status, total_cents, paid_at`,
          [orderId, guestToken]
        );
      } else {
        updated = await pool.query(
          `UPDATE orders
           SET status = 'paid', paid_at = NOW(), updated_at = NOW()
           WHERE guest_token = $1 AND user_id IS NULL AND status = 'pending'
           RETURNING id, status, total_cents, paid_at`,
          [guestToken]
        );
      }
    }

    if (!updated.rows.length) {
      return res.status(404).json({ error: "Order not found or not payable." });
    }

    res.json({ order: updated.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
