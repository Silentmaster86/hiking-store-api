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

const app = express();

app.use(express.json());

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
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
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // na Render ustawimy true + proxy
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dni
    },
  })
);

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/auth", authRouter);
app.use("/cart", cartRouter);
app.use("/checkout", checkoutRouter);
app.use("/products", productsRouter);
app.use("/orders", ordersRouter);
app.use("/payments", paymentsRouter);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`✅ API running on http://localhost:${port}`));
