const { normalizeEmail } = require("../validation/auth");

function signInError(reason) {
  return Object.assign(new Error("External sign-in could not be completed."), { oauthReason: reason });
}

const columns = "id, email, first_name, last_name, created_at";

async function findOrCreateOAuthUser(pool, { provider, providerId, email, emailVerified, firstName, lastName }) {
  if (!["google", "facebook"].includes(provider) || typeof providerId !== "string"
      || !providerId.trim() || providerId.length > 255) throw signInError("failed");
  const findIdentity = async () => (await pool.query(
    `SELECT ${columns} FROM users WHERE oauth_provider = $1 AND oauth_id = $2 LIMIT 1`,
    [provider, providerId]
  )).rows[0];
  const existing = await findIdentity();
  if (existing) return existing;

  const normalizedEmail = normalizeEmail(email) || null;
  // Existing provider IDs remain valid. New Google identities need a verified
  // address when one is supplied; neither provider may link another account by email.
  if (provider === "google" && normalizedEmail && emailVerified !== true) throw signInError("unverified_email");
  const emailInUse = async () => normalizedEmail && (await pool.query(
    "SELECT id FROM users WHERE lower(btrim(email)) = $1 LIMIT 1", [normalizedEmail]
  )).rows.length > 0;
  if (await emailInUse()) throw signInError("account_conflict");

  try {
    return (await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, oauth_provider, oauth_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${columns}`,
      [normalizedEmail, "__OAUTH_ONLY__", firstName || null, lastName || null, provider, providerId]
    )).rows[0];
  } catch (error) {
    if (error.code !== "23505") throw error;
    // Simultaneous callbacks may create the same provider identity only once.
    const raced = await findIdentity();
    if (raced) return raced;
    if (await emailInUse()) throw signInError("account_conflict");
    throw error;
  }
}

module.exports = { findOrCreateOAuthUser };
