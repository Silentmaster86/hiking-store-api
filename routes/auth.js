const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const passport = require("passport");
const mergeGuestCart = require("../services/mergeGuestCart");
const { guestState, regenerateSession, saveSession, logout } = require("../auth/session");

const router = express.Router();
const appOrigin = process.env.APP_ORIGIN || process.env.CORS_ORIGIN || "http://localhost:5173";
function requireProvider(provider) {
  return (_req, res, next) => {
    const available = provider === "google"
      ? process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      : process.env.FB_APP_ID && process.env.FB_APP_SECRET;
    if (!available) return res.status(503).json({ error: "This sign-in provider is not configured." });
    next();
  };
}

function toPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    createdAt: row.created_at,
  };
}

async function finishLogin(req, userId) {
  const cartId = req.session.cartId;
  const state = guestState(req.session);
  await mergeGuestCart(pool, userId, cartId);
  await regenerateSession(req, { ...state, userId });
  await saveSession(req);
}

// ----- EMAIL/PASSWORD
router.post("/register", async (req, res) => {
  const { email, password, firstName = null, lastName = null } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  try {
    const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (existing.rows.length) return res.status(409).json({ error: "Email is already in use." });

    const passwordHash = await bcrypt.hash(password, 10);

    const created = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, first_name, last_name, created_at`,
      [email, passwordHash, firstName, lastName]
    );

    await finishLogin(req, created.rows[0].id);
    return res.status(201).json({ user: toPublicUser(created.rows[0]) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  try {
    const result = await pool.query(
      `SELECT id, email, password_hash, first_name, last_name, created_at
       FROM users
       WHERE email = $1`,
      [email]
    );
    if (!result.rows.length) return res.status(401).json({ error: "Invalid credentials." });

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials." });

    await finishLogin(req, user.id);
    return res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/logout", async (req, res) => {
  try {
    await logout(req);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not log out." });
  }
});

// ✅ ważne: nie cache’uj me, bo widziałeś 304
router.get("/me", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");               

  if (!req.session.userId) return res.json({ user: null });

  try {
    const result = await pool.query(
      `SELECT id, email, first_name, last_name, created_at
       FROM users
       WHERE id = $1`,
      [req.session.userId]
    );
    if (!result.rows.length) return res.status(401).json({ user: null });

    return res.json({ user: toPublicUser(result.rows[0]) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

function captureGuestState(req, _res, next) {
  req.guestState = { ...guestState(req.session), cartId: req.session.cartId };
  next();
}

async function finishOAuth(req, res, next) {
  try {
    Object.assign(req.session, req.guestState);
    const userId = req.user.id;
    await mergeGuestCart(pool, userId, req.session.cartId);
    delete req.session.cartId;
    req.session.userId = userId;
    await saveSession(req);
    res.redirect(`${appOrigin}/`);
  } catch (err) {
    next(err);
  }
}

// ----- OAUTH FACEBOOK
router.get("/facebook", requireProvider("facebook"), passport.authenticate("facebook"));

router.get(
  "/facebook/callback",
  requireProvider("facebook"),
  captureGuestState,
  passport.authenticate("facebook", {
    failureRedirect: `${appOrigin}/login?error=facebook`,
  }),
  finishOAuth
);

// ----- OAUTH GOOGLE
router.get("/google", requireProvider("google"), passport.authenticate("google", { scope: ["profile", "email"] }));

router.get(
  "/google/callback",
  requireProvider("google"),
  captureGuestState,
  passport.authenticate("google", {
    failureRedirect: `${appOrigin}/login?error=google`,
  }),
  finishOAuth
);

module.exports = router;
