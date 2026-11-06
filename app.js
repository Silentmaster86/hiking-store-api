require("./auth/passport");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const passport = require("passport");
const pool = require("./db");
const { runtime } = require("./config/runtime");
const { requestSecurity } = require("./middleware/requestSecurity");
const { rateLimit } = require("./middleware/rateLimit");

function createApp({ config = runtime(), sessionStore } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(requestSecurity(config.origins));
  app.use(cors({ origin: config.origins, credentials: true,
    allowedHeaders: ["Content-Type", "Idempotency-Key", "X-Store-Request"] }));
  app.use(express.json({ limit: "32kb" }));
  app.use(session({ store: sessionStore || new pgSession({ pool, tableName: "session", createTableIfMissing: true }),
    secret: config.secret, resave: false, saveUninitialized: false, proxy: true,
    cookie: { httpOnly: true, sameSite: config.sameSite, secure: config.secure, maxAge: 7 * 24 * 60 * 60 * 1000 } }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/ready", async (_req, res) => {
    try { await pool.query({ text: "SELECT 1", query_timeout: 2000 }); res.json({ ok: true }); }
    catch { res.status(503).json({ ok: false }); }
  });
  const limiter = (scope, limit, windowMs) => rateLimit(pool, { scope, limit, windowMs, secret: config.secret });
  app.post("/auth/login", limiter("login", config.loginLimit, 15 * 60 * 1000));
  app.post("/auth/register", limiter("register", config.registerLimit, 60 * 60 * 1000));
  app.get(["/auth/google", "/auth/facebook"], limiter("oauth", config.loginLimit, 15 * 60 * 1000));
  app.post("/checkout", limiter("checkout", config.checkoutLimit, 60 * 1000));
  for (const route of ["cart", "checkout", "products", "orders", "payments", "auth"]) app.use(`/${route}`, require(`./routes/${route}`));
  app.use((_req, res) => res.status(404).json({ error: "Not found", code: "NOT_FOUND" }));
  app.use((error, _req, res, _next) => {
    if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON.", code: "INVALID_JSON" });
    if (error.type === "entity.too.large") return res.status(413).json({ error: "This request is too large.", code: "REQUEST_TOO_LARGE" });
    console.error("Request failed:", error.code || "internal error");
    res.status(500).json({ error: "The request could not be completed. Please try again.", code: "SERVER_ERROR" });
  });
  return app;
}
module.exports = { createApp };
