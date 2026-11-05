const { timingSafeEqual } = require("node:crypto");
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
function guestToken(req, id) {
  const grant = req.session.guestOrders?.[id];
  return grant && grant.expiresAt > Date.now() && typeof grant.token === "string" ? grant.token : null;
}
function sameToken(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function canRead(req, order) {
  return !!order && ((!!req.session.userId && order.user_id === req.session.userId)
    || (order.user_id == null && sameToken(guestToken(req, order.id), order.guest_token)));
}
function grantOrder(req, order) {
  if (order.user_id != null || !order.guest_token) return;
  const grants = Object.entries(req.session.guestOrders || {}).filter(([, grant]) => grant.expiresAt > Date.now());
  req.session.guestOrders = Object.fromEntries(grants.slice(-49));
  req.session.guestOrders[order.id] = { token: order.guest_token, expiresAt: Date.now() + SEVEN_DAYS };
}
function publicOrder(req, row) {
  const names = ["id", "email", "first_name", "last_name", "shipping_address1", "shipping_address2", "shipping_city", "shipping_postcode", "shipping_country", "status", "currency", "subtotal_cents", "shipping_cents", "total_cents", "created_at", "paid_at"];
  const result = Object.fromEntries(names.map((name) => [name, row[name]]));
  result.canClaim = row.user_id == null && canRead(req, row);
  result.canSimulate = process.env.DEMO_MODE === "true" && !!req.session.userId && row.user_id === req.session.userId;
  return result;
}
module.exports = { guestToken, canRead, grantOrder, publicOrder };
