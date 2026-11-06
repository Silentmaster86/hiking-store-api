const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const passport = require("passport");
const mergeGuestCart = require("../services/mergeGuestCart");
const { guestState, regenerateSession, saveSession, logout } = require("../auth/session");

const { beginOAuth, consumeOAuth } = require("../auth/oauthState");
const { safeReturnTo } = require("../auth/returnTo");
const { normalizeEmail, validateRegistration } = require("../validation/auth");
const router = express.Router();
const appOrigin = new URL(process.env.APP_ORIGIN || process.env.CORS_ORIGIN || "http://localhost:5173").origin;

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
  const { password, firstName = null, lastName = null } = req.body || {};
  const parsed = validateRegistration(req.body);
  if (!parsed.valid) return res.status(422).json({ error: "Please check the highlighted fields.", code: "VALIDATION_ERROR", fieldErrors: parsed.fieldErrors });
  const email = parsed.email;

  try {
    const existing = await pool.query(`SELECT id FROM users WHERE lower(btrim(email)) = $1`, [email]);
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
    if (err.code === "23505") return res.status(409).json({ error: "Email is already in use." });
    console.error(err.code);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  try {
    const result = await pool.query(
      `SELECT id, email, password_hash, first_name, last_name, created_at
       FROM users
       WHERE lower(btrim(email)) = $1`,
      [email]
    );
    if (!result.rows.length) return res.status(401).json({ error: "Invalid credentials." });

    const user = result.rows[0];
    const ok = typeof password === "string" && user.password_hash !== "__OAUTH_ONLY__" && await bcrypt.compare(password, user.password_hash);
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

function oauthFailure(res, provider, reason, returnTo = "/") {
  const target = new URL("/login", appOrigin);
  target.searchParams.set("error", provider);
  target.searchParams.set("reason", reason);
  target.searchParams.set("returnTo", returnTo);
  return res.redirect(target.href);
}

function providerConfigured(provider) {
  return provider === "google"
    ? process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    : process.env.FB_APP_ID && process.env.FB_APP_SECRET;
}

for (const provider of ["google", "facebook"]) {
  router.get(`/${provider}`, async (req, res, next) => {
    if (!providerConfigured(provider)) return oauthFailure(res, provider, "unavailable", safeReturnTo(req.query.returnTo, appOrigin));
    try {
      const state = beginOAuth(req.session, provider, req.query.returnTo, appOrigin);
      // Persist before leaving the site; a callback must use this exact session.
      await saveSession(req);
      passport.authenticate(provider, { state,
        ...(provider === "google" ? { scope: ["profile", "email"] } : {}) })(req, res, next);
    } catch (error) { next(error); }
  });

  router.get(`/${provider}/callback`, async (req, res, next) => {
    try {
      // Validate and consume BEFORE Passport handles codes or provider errors.
      const attempt = consumeOAuth(req.session, provider, req.query.state, appOrigin);
      await saveSession(req);
      if (!attempt) return oauthFailure(res, provider, "session");
      if (!providerConfigured(provider)) return oauthFailure(res, provider, "unavailable", attempt.returnTo);
      if (req.query.error) return oauthFailure(res, provider,
        req.query.error === "access_denied" ? "cancelled" : "failed", attempt.returnTo);
      if (typeof req.query.code !== "string" || !req.query.code) return oauthFailure(res, provider, "failed", attempt.returnTo);

      // Use the same explicit session rotation/cart merge as email login.
      // State is validated above, independently of Passport's optional store.
      passport.authenticate(provider, { session: false }, (error, user) => {
        if (error || !user) {
          const reason = ["account_conflict", "unverified_email"].includes(error?.oauthReason)
            ? error.oauthReason : "failed";
          return oauthFailure(res, provider, reason, attempt.returnTo);
        }
        finishLogin(req, user.id).then(() => res.redirect(`${appOrigin}${attempt.returnTo}`))
          .catch(next);
      })(req, res, next);
    } catch (error) { next(error); }
  });
}

module.exports = router;
