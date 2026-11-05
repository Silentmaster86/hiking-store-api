require("dotenv").config();
require("./auth/passport");

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const passport = require("passport");
const pool = require("./db");

const productsRouter = require("./routes/products");
const authRouter = require("./routes/auth");
const cartRouter = require("./routes/cart");
const checkoutRouter = require("./routes/checkout");
const ordersRouter = require("./routes/orders");
const paymentsRouter = require("./routes/payments");

const allowed = [
  process.env.CORS_ORIGIN, // np. https://hiking-store-uk.netlify.app
  "http://localhost:5173",
  "https://hiking-store-uk.netlify.app",
  "https://www.hiking-store-uk.netlify.app",
].filter(Boolean);

const secureCookies = !["development", "test"].includes(process.env.NODE_ENV);
const app = express();
app.set("trust proxy", 1);

app.use(express.json());
app.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      return allowed.includes(origin) ? cb(null, true) : cb(new Error("CORS blocked"));
    },
    credentials: true,
  })
);

app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: process.env.SESSION_SAME_SITE || (secureCookies ? "none" : "lax"),
      secure: secureCookies,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/cart", cartRouter);
app.use("/checkout", checkoutRouter);
app.use("/products", productsRouter);
app.use("/orders", ordersRouter);
app.use("/payments", paymentsRouter);
app.use("/auth", authRouter);

app.use((err, _req, res, _next) => {
  console.error("Request failed:", err.code || "internal error");
  res.status(500).json({ error: "The request could not be completed. Please try again." });
});

const port = process.env.PORT || 4000;
const { migrate } = require("./db/migrate");
migrate(pool).then(() => {
  app.listen(port, () => console.log(`API running on port ${port}`));
}).catch(async (error) => {
  console.error("Database migration failed; server was not started:", error.message);
  await pool.end();
  process.exitCode = 1;
});
