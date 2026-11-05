# Working on this API

- Use the existing Express, PostgreSQL and session architecture.
- Use Node.js 24 and keep package-lock.json when dependencies change.
- Run npm test. Integration coverage requires a dedicated TEST_DATABASE_URL;
  report explicit skips honestly and check the PostgreSQL CI run.
- Add versioned migrations for schema/data changes. Do not rewrite an already
  deployed migration or introduce table resets. Preserve order price/name snapshots.
- Verify ownership/session grants for order data and mutations. An order number
  alone is not authorization. Do not expose guest tokens or checkout ownership.
- Treat all purchases and status transitions as demo behaviour.
- Keep credentials out of source; document public variable names in .env.example.
