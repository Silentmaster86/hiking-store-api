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

## Release status and later changes

The direct-to-main PR #8 rollout in both repositories is complete. API PR #15 and
client PR #25 are merged. The client's [audit status](https://github.com/Silentmaster86/hiking-store-client/blob/main/AUDIT-STATUS.md)
records the 7 November main checks, observed production routing and owner reports.

New pull requests target main. When changing a request contract, deploy a
compatible client before enforcing it in the API. Production environment values
override source defaults. The client's [release checklist](https://github.com/Silentmaster86/hiking-store-client/blob/main/RELEASE-CHECKLIST.md)
and [deployment settings](https://github.com/Silentmaster86/hiking-store-client/blob/main/DEPLOYMENT-SETTINGS.md)
describe later releases and the matching same-origin hosting/OAuth configuration.

Hosted backup schedule, retention, latest successful backup and restoration of
an authorized hosted copy remain to verify with owner access. The scratch-database
round-trip above verifies the scripts, not the hosted backup service.

## Dependency security checks

`Dependency audit` runs on pull requests, main pushes, weekly and on demand.
`Production dependency audit` fails on high/critical production advisories or
an audit service error (`npm audit --omit=dev --audit-level=high`). The full
`npm audit --json` report is retained as the `dependency-audit` artifact for
14 days; review moderate/low and development advisories separately.

Before a release, run `npm ci`, the production audit and the full audit.
Require `Production dependency audit` in the main branch protection/ruleset;
adding the workflow alone does not prevent merging. Recheck weekly reports
and Dependabot updates, and rerun functional tests after dependency changes.

On 2026-11-12, minimatch GHSA-g3hv-75wg-m249 still affects development tools
(nodemon in API; ESLint in client). The compatible dependency ranges retain
minimatch 10; npm proposes tool downgrades rather than a compatible patch.
Do not apply `npm audit fix --force` or override the major version without
checking tool compatibility. Track the upstream fix separately.
