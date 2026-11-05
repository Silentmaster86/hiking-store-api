# Checkout and order access

## Deployment

The server now runs versioned migrations before listening, whether launched by
`npm start` or `node index.js`. `npm run db:migrate` is also available for a
pre-deployment check. Review a database snapshot before the paired release.
Migrations are transactional and guarded against concurrent startup. They create
missing tables, add checkout columns/indexes and never drop application data.
An existing database with case-insensitive duplicate emails must be resolved
explicitly before migration; accounts are not automatically combined.

`db:setup` and `setupDatabase.js` now perform non-destructive migration only.
They no longer reset tables or seed products. Existing catalogue data is retained;
a new database starts empty and requires intentional product seeding/import.

Deploy the API before the paired frontend. The API accepts the old `UK` country
value and missing idempotency headers for existing clients, but validates names,
email and the complete delivery address. New clients send `GB` and a UUID
`Idempotency-Key`. Retry a failed checkout with the same key. Validated equivalent
payloads return the original order; changed payloads return a conflict with the
existing order number only to an authorized session/account.

## Guest orders

Guest tokens are kept in the server-side session, not returned in JSON, URLs or
localStorage. An order number alone grants no access. `GET /orders/:id` permits
the owning account or a matching session grant. Grants survive email/OAuth login
and signing out, expire after seven days, and are bounded to 50 recent orders.
Clearing cookies or using another browser loses guest access. There is no email
recovery in this demo. Older guest orders without a server-side grant are not
silently attached by email address.

`POST /orders/:id/claim` atomically assigns a session-authorized guest order to a
signed-in account and clears the guest token. The previous token-body `/claim`
endpoint is replaced by this session-authorized route.

`GET /checkout/attempt/:key` recovers a completed attempt in its originating
guest session or owning account, even if the original response was lost.
Internal token, request fingerprint and checkout ownership columns are never
included in order responses. Saved item names and prices preserve purchase data
when catalogue text changes.

## Validation and status simulation

Checkout requires email, first and last name, address, town/city and a syntactically
valid UK postcode. Supported country: GB (UK accepted for old clients). Postcode
format validation does not verify that a delivery address exists. Registration
requires at least 12 password characters and at most 72 UTF-8 bytes (bcrypt limit).
Existing shorter passwords can still sign in. Account email matching ignores case.

Set `DEMO_MODE=true` to expose owner-only, explicitly labelled simulation controls.
Otherwise status changes and `/payments/mock` are disabled. Simulation permits
only pending → paid → shipped → delivered and sets paid_at at the payment step.
There are no real payments or shipments.

## Verification

`npm test` runs unit tests and a PostgreSQL HTTP integration suite when an isolated
`TEST_DATABASE_URL` is supplied. CI runs PostgreSQL 16, migrates a unique schema
and tests cart regression, request validation, guest access, claims, retries,
concurrent checkouts, rollback, status transitions and migration from an old
orders schema. No production database is used by the tests.
