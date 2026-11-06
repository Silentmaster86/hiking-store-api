const { randomBytes, timingSafeEqual } = require("node:crypto");
const { safeReturnTo } = require("./returnTo");

const MAX_AGE_MS = 10 * 60 * 1000;
const providers = new Set(["google", "facebook"]);

function beginOAuth(session, provider, returnTo, origin, now = Date.now()) {
  if (!providers.has(provider)) throw new Error("Unsupported OAuth provider");
  const state = randomBytes(32).toString("base64url");
  session.oauthAttempts = { ...session.oauthAttempts,
    [provider]: { state, createdAt: now, returnTo: safeReturnTo(returnTo, origin) } };
  return state;
}

function consumeOAuth(session, provider, supplied, origin, now = Date.now()) {
  if (!providers.has(provider)) return null;
  const attempt = session.oauthAttempts?.[provider];
  if (session.oauthAttempts) {
    delete session.oauthAttempts[provider];
    if (!Object.keys(session.oauthAttempts).length) delete session.oauthAttempts;
  }
  // Consume even an invalid callback: the next attempt must start at sign-in.
  if (!attempt || typeof supplied !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(supplied)
      || typeof attempt.state !== "string" || attempt.state.length !== 43
      || !Number.isFinite(attempt.createdAt) || now < attempt.createdAt
      || now - attempt.createdAt >= MAX_AGE_MS) return null;
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(attempt.state))) return null;
  return { returnTo: safeReturnTo(attempt.returnTo, origin) };
}

module.exports = { beginOAuth, consumeOAuth, MAX_AGE_MS };
