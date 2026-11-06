# Request protection and rollout

Deploy the companion client request-header change before this API change. The old
API accepts the new header; this API deliberately rejects writes from older clients.
A reload obtains the current client bundle. Both PRs depend on cart-and-recovery.

All POST/PUT/PATCH/DELETE requests require X-Store-Request: 1. Browser writes also
must come from the exact configured Origin allowlist. Cross-site requests without
an Origin are rejected when Fetch Metadata identifies them. JSON bodies are
required for POST/PUT/PATCH and limited to 32 KB. CORS preflights allow only the
listed headers and origins. A custom header causes a browser preflight that an
untrusted origin cannot pass; the value is public and does not authenticate a user.
Session ownership checks remain required on every protected operation. OAuth GET
callbacks instead use their single-use session-bound state.

Login, registration, OAuth starts and checkout use atomic PostgreSQL counters,
shared across processes. Keys are HMACs of scope/IP using SESSION_SECRET. Defaults:
60 login/OAuth starts per 15 minutes, 20 registrations per hour, 60 checkouts per
minute. HTTP 429 includes Retry-After. Expired counters are deleted hourly while
the server runs. Restarting does not reset live counters. Database failure fails
closed for these writes, with a generic error. AUTH_RATE_LIMIT,
REGISTER_RATE_LIMIT and CHECKOUT_RATE_LIMIT override counts.

TRUST_PROXY_HOPS defaults to 1, matching the existing Render trust configuration.
Validate the actual proxy chain before changing it. Netlify proxy egress may group
visitors under one address: verify observed limits under the deployed topology.
Do not trust arbitrary forwarded client-IP headers or set trust proxy to true.
APP_ORIGIN/CORS_ORIGIN define exact origins; localhost is allowed only in development
or test. Keep SESSION_SECRET private and use a long random production value.

/health is liveness. /ready checks the database with a short timeout and responds
503 when unavailable. No response reveals connection details. Startup migrates
before listening. SIGTERM/SIGINT stop new connections, allow requests to finish,
then close PostgreSQL; lingering HTTP connections are stopped after ten seconds.

Tests use createApp(), the same middleware factory as production. They cover
origin/header checks, preflights, body errors, rate-limit concurrency and expiry,
as well as existing authentication/cart/order flows.
