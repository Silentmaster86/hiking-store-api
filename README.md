# Hiking Store API

Express + PostgreSQL backend for the Hiking Store portfolio demo.

Frontend: https://hiking-store-uk.netlify.app/
Client source: https://github.com/Silentmaster86/hiking-store-client

No real payments or shipments are processed. Authentication, carts and demo
orders are saved in PostgreSQL. Guest sessions refer to database-backed carts;
items are not stored directly in the cookie.

## Local development (Node.js 24)

1. Create a PostgreSQL database.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and `SESSION_SECRET`.
3. Install dependencies and prepare the optional demo catalogue:

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

`npm start` and `node index.js` apply pending migrations before listening. Setup
and migrations do not reset tables. Seeding is explicit and repeatable; custom
products and existing matches are preserved. See [CATALOGUE.md](CATALOGUE.md).

## Routes

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /health | Liveness after migrations |
| GET | /products, /products/:id | Catalogue |
| GET | /cart | Current session/account cart |
| POST | /cart/items | Add a product |
| PATCH | /cart/items/:id | Update quantity |
| DELETE | /cart/items/:id | Remove a cart item |
| POST | /auth/register, /auth/login, /auth/logout | Email authentication |
| GET | /auth/me | Current account |
| GET | /auth/google, /auth/facebook | Optional external sign-in |
| POST | /checkout | Validate and create/replay an order |
| GET | /checkout/attempt/:key | Recover an authorized completed attempt |
| GET | /orders | Account order history |
| GET | /orders/:id | Account or session-authorized guest order |
| POST | /orders/:id/claim | Save an authorized guest order to an account |
| PATCH | /orders/:id/status | Owner-only demo transition when enabled |

## Sessions, orders and deployment

Account carts remain with the account on sign-out. Real guest additions merge once
on sign-in. Guest order access lasts up to seven days in the same browser and can
be saved to an account; there is no cross-device email recovery.

Checkout uses a UUID `Idempotency-Key` header and transactional cart locking. Retry
with the same key. Set `DEMO_MODE=true` to enable explicit status simulation. OAuth
credentials are optional for local email sign-in. Production cookie/proxy rollout
and provider callbacks require matching configuration.
External sign-in now checks a single-use state with a ten-minute limit. Accounts
are identified by provider ID and are not automatically linked by email. Read
[OAUTH.md](OAUTH.md) for behaviour, tests and the matching proxy/callback settings.

Read [STABILIZATION.md](STABILIZATION.md) and [ORDER-FLOWS.md](ORDER-FLOWS.md) before
changing hosting configuration or deploying migrations to an existing database.

## Tests

```sh
npm test
```

Unit tests run without a database. Supply `TEST_DATABASE_URL` for the isolated
PostgreSQL HTTP integration suite; a missing value is reported as a skip. GitHub
Actions uses PostgreSQL 16 and runs the real integration suite. Tests create their
own schemas and never use a production database.

## Scope

There is no real payment provider, fulfilment, inventory management, password-reset
email service or admin UI. Data-deletion requests are handled by the project owner.

Author: Przemysław Pietkun — https://github.com/Silentmaster86
