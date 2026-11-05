const express = require("express");
const { randomUUID } = require("node:crypto");
const pool = require("../db");
const { validateCheckout } = require("../validation/checkout");
const { createOrder, ownsAttempt } = require("../services/checkoutService");
const { grantOrder, publicOrder } = require("../services/orderAccess");
const { saveSession } = require("../auth/session");
const router = express.Router();
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.get("/attempt/:key", async (req, res) => {
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(req.params.key)) return res.status(400).json({ error: "Invalid checkout attempt." });
  const order = (await pool.query("SELECT * FROM orders WHERE checkout_key = $1", [req.params.key])).rows[0];
  if (!ownsAttempt(req, order)) return res.status(404).json({ error: "No completed order was found for this attempt in this session." });
  grantOrder(req, order);
  await saveSession(req);
  res.json({ order: publicOrder(req, order) });
});
router.post("/", async (req, res) => {
  const parsed = validateCheckout(req.body);
  if (!parsed.valid) return res.status(422).json({ error: "Please check the highlighted fields.", code: "VALIDATION_ERROR", fieldErrors: parsed.fieldErrors });
  const key = (req.get("Idempotency-Key") || randomUUID()).toLowerCase();
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(key)) return res.status(422).json({ error: "Invalid checkout attempt.", code: "INVALID_CHECKOUT_KEY" });
  try {
    if (!req.session.checkoutOwner) {
      req.session.checkoutOwner = randomUUID();
      await saveSession(req);
    }
    const result = await createOrder(pool, req, parsed.value, key);
    grantOrder(req, result.order);
    await saveSession(req);
    if (result.conflict) return res.status(409).json({ error: "This attempt already placed an order with different details. Review that order before starting another.", code: "IDEMPOTENCY_CONFLICT", orderId: result.order.id });
    return res.status(result.replay ? 200 : 201).json({ order: publicOrder(req, result.order), replay: result.replay });
  } catch (error) {
    if (!error.status) console.error("Checkout failed:", error.code || "internal error");
    return res.status(error.status || 500).json({ error: error.status ? error.message : "We couldn’t complete checkout. Retry with the same checkout attempt.", code: error.code || "CHECKOUT_FAILED" });
  }
});
module.exports = router;
