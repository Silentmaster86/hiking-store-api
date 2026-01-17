require("dotenv").config();
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const pool = require("./db");

const productsRouter = require("./routes/products");
const authRouter = require("./routes/auth");
const cartRouter = require("./routes/cart");
const checkoutRouter = require("./routes/checkout");
const ordersRouter = require("./routes/orders");
const paymentsRouter = require("./routes/payments");
const allowed = [
  process.env.CORS_ORIGIN,
  "http://localhost:5173",
  "https://hiking-store-uk.netlify.app",
  "https://www.hiking-store-uk.netlify.app",
].filter(Boolean);


const app = express();

app.use(express.json());

app.set("trust proxy", 1); // ✅ MUSI być przed session

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    return allowed.includes(origin) ? cb(null, true) : cb(new Error("CORS blocked"));
  },
  credentials: true,
}));

app.use(session({
  store: new pgSession({
    pool,
    tableName: "session",
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true, // ✅ ważne na Render
  cookie: {
    httpOnly: true,
    sameSite: "none",
    secure: true, // ✅ MUST (SameSite=None)
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
}));


app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/auth", authRouter);
app.use("/cart", cartRouter);
app.use("/checkout", checkoutRouter);
app.use("/products", productsRouter);
app.use("/orders", ordersRouter);
app.use("/payments", paymentsRouter);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`✅ API running on http://localhost:${port}`));
