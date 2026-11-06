# Development and operations

Use Node 24 (`nvm use`) and `npm ci`. `npm run verify` checks JavaScript syntax and
runs unit/HTTP integration tests. Missing TEST_DATABASE_URL explicitly skips the
PostgreSQL suite; CI supplies PostgreSQL 16. This syntax check is not ESLint.

For local PostgreSQL, `docker compose up -d db` starts a persistent, localhost-only
service matching .env.example. The postgres/postgres credentials are for local
use only. Create an isolated test database once:

```sh
docker compose exec db createdb -U postgres hiking_store_test
```

Set TEST_DATABASE_URL to that database to run the integration suite. Migration
and seed are explicit, repeatable commands. Do not use `docker compose down -v`
for a database whose contents you need. No container is started automatically.

## Backups

`bash scripts/backup.sh private.dump` uses an explicitly supplied
BACKUP_DATABASE_URL and refuses to overwrite an existing file. Dumps can contain
personal data: store them outside Git with restricted access. Restore only into
a newly created, empty database using RESTORE_DATABASE_URL and
`bash scripts/restore-empty.sh private.dump`. The script checks for existing
tables and uses a single transaction with exit-on-error. It does not clear tables.

`npm run test:backup` uses TEST_DATABASE_URL only to create two uniquely named
scratch databases, dump the source, restore into the empty destination and verify
the catalogue and a historical order. It removes only databases it created.
Install matching PostgreSQL client tools and use a test user with CREATEDB.
CI runs this round-trip; it is not proof of a backup of the hosted database.

Before release, check the actual hosting plan's backup schedule, retention,
restore permissions and the date of the latest successful backup. Record these
without credentials. Hosting-dashboard access is required to verify them.

## Health and release

Use /health for liveness and /ready for database readiness, via the frontend proxy
where appropriate. Configure external monitoring against those URLs in the hosting
or monitoring service. Keep logs free of passwords, tokens and delivery details.
Verify secure cookies and the OAuth host/callback configuration in OAUTH.md.
REQUEST-SECURITY.md describes the client-first header rollout and proxy-rate limits.

## Remaining main rollout

Merge and deploy client PR #8 first, then API PR #8. Both target main directly.
They bring the previously reviewed security/catalogue/release work from the
intermediate branches into the production branch. A merged PR whose base was a
working branch did not deploy that work to main. Do not re-merge the closed PRs
or retarget anything to an intermediate branch.

The client must be deployed first because API writes require the new request
header. Review Checks and verify the target says main before merging.
Production environment values override source defaults. The client's
DEPLOYMENT-SETTINGS.md describes the separate hosting/OAuth cookie-host cutover.
