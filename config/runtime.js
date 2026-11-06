function positive(value, fallback, name) {
  if (value == null || value === "") return fallback;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 1000000) throw new Error(`Invalid ${name}`);
  return result;
}
function runtime(env = process.env) {
  const development = ["development", "test"].includes(env.NODE_ENV);
  const appOrigin = new URL(env.APP_ORIGIN || env.CORS_ORIGIN || (development ? "http://localhost:5173" : "https://hiking-store-uk.netlify.app")).origin;
  const origins = [...new Set([appOrigin, env.CORS_ORIGIN, ...(development ? ["http://localhost:5173", "http://127.0.0.1:5173"] : [])].filter(Boolean).map(value => new URL(value).origin))];
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is required");
  const sameSite = env.SESSION_SAME_SITE || (development ? "lax" : "none");
  if (!["lax", "strict", "none"].includes(sameSite)) throw new Error("Invalid SESSION_SAME_SITE");
  return { appOrigin, origins, secure: !development, sameSite, secret: env.SESSION_SECRET,
    trustProxy: positive(env.TRUST_PROXY_HOPS, 1, "TRUST_PROXY_HOPS"),
    loginLimit: positive(env.AUTH_RATE_LIMIT, 60, "AUTH_RATE_LIMIT"),
    registerLimit: positive(env.REGISTER_RATE_LIMIT, 20, "REGISTER_RATE_LIMIT"),
    checkoutLimit: positive(env.CHECKOUT_RATE_LIMIT, 60, "CHECKOUT_RATE_LIMIT") };
}
module.exports = { runtime };
