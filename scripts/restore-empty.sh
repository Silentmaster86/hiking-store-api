#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to a new empty database}"
: "${1:?Provide the source dump file}"
PGDATABASE="$RESTORE_DATABASE_URL"
export PGDATABASE
count=$(psql --no-psqlrc --tuples-only --no-align --command="SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")
if [[ "$count" != "0" ]]; then echo "Restore refused: destination must be empty." >&2; exit 1; fi
pg_restore --dbname="" --exit-on-error --single-transaction --no-owner --no-privileges "$1"
echo "Restore completed in the empty destination."
