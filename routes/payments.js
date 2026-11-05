const express = require("express");
const pool = require("../db");
const { advanceStatus } = require("../services/orderStatus");
const { publicOrder } = require("../services/orderAccess");
const router = express.Router();
router.post("/mock", async (req, res) => {
  const id = Number(req.body?.orderId);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "A valid order number is required." });
  try { res.json({ order: publicOrder(req, await advanceStatus(pool, req, id, "paid")) }); }
  catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : "Could not simulate payment.", code: error.code }); }
});
module.exports = router;
