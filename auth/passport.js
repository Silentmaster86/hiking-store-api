const passport = require("passport");
const FacebookStrategy = require("passport-facebook").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const pool = require("../db");
const { findOrCreateOAuthUser } = require("../services/oauthUser");

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query(
      `SELECT id, email, first_name, last_name, created_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    done(null, result.rows[0] || null);
  } catch (e) {
    done(e);
  }
});

// Facebook may return no email; the provider ID is the login identity.
if (process.env.FB_APP_ID && process.env.FB_APP_SECRET) passport.use(
  new FacebookStrategy(
    {
      clientID: process.env.FB_APP_ID,
      clientSecret: process.env.FB_APP_SECRET,
      callbackURL: process.env.FB_CALLBACK_URL,
      profileFields: ["id", "displayName", "emails", "name"],
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value || null;
        const firstName = profile.name?.givenName || null;
        const lastName = profile.name?.familyName || null;

        const user = await findOrCreateOAuthUser(pool, {
          provider: "facebook",
          providerId: profile.id,
          email,
          firstName,
          lastName,
        });

        done(null, user);
      } catch (e) {
        done(e);
      }
    }
  )
);

// Google email verification is checked before creating a new identity.
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value || null;
        const firstName = profile.name?.givenName || null;
        const lastName = profile.name?.familyName || null;

        const user = await findOrCreateOAuthUser(pool, {
          provider: "google",
          emailVerified: profile.emails?.[0]?.verified === true || profile._json?.email_verified === true,
          providerId: profile.id,
          email,
          firstName,
          lastName,
        });

        done(null, user);
      } catch (e) {
        done(e);
      }
    }
  )
);

module.exports = passport;
