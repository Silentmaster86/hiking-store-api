const { createHmac } = require("node:crypto");
function rateLimit(pool, { scope, limit, windowMs, secret }) {
  return async (req, res, next) => {
    try {
      const key = createHmac("sha256", secret).update(`${scope}:${req.ip}`).digest("hex");
      const result = await pool.query(`INSERT INTO request_limits(key, hits, expires_at)
        VALUES ($1, 1, NOW() + $2::bigint * INTERVAL '1 millisecond')
        ON CONFLICT (key) DO UPDATE SET
          hits = CASE WHEN request_limits.expires_at <= NOW() THEN 1 ELSE request_limits.hits + 1 END,
          expires_at = CASE WHEN request_limits.expires_at <= NOW() THEN EXCLUDED.expires_at ELSE request_limits.expires_at END
        RETURNING hits, expires_at`, [key, windowMs]);
      const row = result.rows[0];
      if (row.hits > limit) {
        res.set("Retry-After", String(Math.max(1, Math.ceil((new Date(row.expires_at) - Date.now()) / 1000))));
        return res.status(429).json({ error: "Too many attempts. Please wait before trying again.", code: "RATE_LIMITED" });
      }
      next();
    } catch (error) { next(error); }
  };
}
module.exports = { rateLimit };
