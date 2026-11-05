# Session and cart stabilization

Account carts remain attached to their accounts when signing out. A guest starts
with an empty cart after an account signs out. Actual guest additions are merged
once, inside a transaction, on registration, email login, or OAuth login.
Both the local user ID and Passport state are removed on sign-out. A successful
email login rotates the session ID. Session-store errors are not ignored.

## Verification (Node.js 24)

```sh
npm ci
npm test
```

Four session unit tests run without a database. The HTTP/PostgreSQL regression
requires `TEST_DATABASE_URL` and otherwise reports an explicit skip. It creates a
uniquely named schema and removes that schema afterward; it does not reset the
application database. Use a dedicated test database and a user allowed to create
schemas. The test covers three sign-out/sign-in cycles, real guest additions,
repeated login and concurrent merges of the same guest cart.

GitHub Actions supplies an isolated PostgreSQL 16 service and runs the regression.
A green local unit result without `TEST_DATABASE_URL` is not an integration result.

## Configuration and rollout

Copy `.env.example` to `.env` locally; keep real values out of Git. Local HTTP
requires `NODE_ENV=development`; production defaults to secure cookies and
preserves the existing cross-site SameSite=None configuration. OAuth credentials
are optional for local email authentication; disabled providers return HTTP 503.

For the companion client's same-origin proxy rollout:

1. Deploy and verify this backend branch on a non-production environment.
2. Configure the client proxy and set `VITE_API_URL=/api` for that environment.
3. Confirm Set-Cookie reaches the browser on the frontend host and the cookie is
   sent back for `/api/cart` with third-party cookies blocked.
4. Point Google/Facebook callback URLs at the frontend host under
   `/api/auth/<provider>/callback`, in both provider settings and backend env.
5. Use `SESSION_SAME_SITE=lax` after all session and OAuth traffic uses the proxy.
6. Verify email login, OAuth login, sign-out, reload and cart persistence before
   deploying the paired release to production.

This branch does not implement guest order claiming, address validation,
checkout idempotency, data migrations or real payments. Those are later stages.
