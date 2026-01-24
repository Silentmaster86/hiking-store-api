const passport = require("passport");
const FacebookStrategy = require("passport-facebook").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const pool = require("../db");

async function findOrCreateOAuthUser({ provider, providerId, email, firstName, lastName }) {
  
  const byOauth = await pool.query(
    `SELECT id, email, first_name, last_name, created_at
     FROM users
     WHERE oauth_provider = $1 AND oauth_id = $2
     LIMIT 1`,
    [provider, providerId]
  );
  if (byOauth.rows.length) return byOauth.rows[0];

  
  if (email) {
    const byEmail = await pool.query(
      `SELECT id, email, first_name, last_name, created_at
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [email]
    );

    if (byEmail.rows.length) {
      const updated = await pool.query(
        `UPDATE users
         SET oauth_provider=$1, oauth_id=$2, updated_at=NOW()
         WHERE id=$3
         RETURNING id, email, first_name, last_name, created_at`,
        [provider, providerId, byEmail.rows[0].id]
      );
      return updated.rows[0];
    }
  }

  const created = await pool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, oauth_provider, oauth_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, first_name, last_name, created_at`,
    [
      email || `${providerId}@${provider}.oauth`, // fallback
      "__OAUTH_ONLY__",
      firstName || null,
      lastName || null,
      provider,
      providerId,
    ]
  );

  return created.rows[0];
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query(
      `SELECT id, email, first_name, last_name, created_at
       FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );
    done(null, result.rows[0] || null);
  } catch (e) {
    done(e);
  }
});

// FACEBOOK
const FB_VER = process.env.FB_GRAPH_VER || "v23.0";

passport.use(
  new FacebookStrategy(
    {
      clientID: process.env.FB_APP_ID,
      clientSecret: process.env.FB_APP_SECRET,
      callbackURL: process.env.FB_CALLBACK_URL,

      // ✅ wymuszamy nową wersję Graph API (zamiast starego v3.2)
      authorizationURL: `https://www.facebook.com/${FB_VER}/dialog/oauth`,
      tokenURL: `https://graph.facebook.com/${FB_VER}/oauth/access_token`,
      profileURL: `https://graph.facebook.com/${FB_VER}/me`,

      profileFields: ["id", "displayName", "emails", "name"],
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value || null;
        const firstName = profile.name?.givenName || null;
        const lastName = profile.name?.familyName || null;

        const user = await findOrCreateOAuthUser({
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


// GOOGLE
passport.use(
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

        const user = await findOrCreateOAuthUser({
          provider: "google",
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
