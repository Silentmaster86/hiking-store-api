#!/usr/bin/env bash
set -euo pipefail
: "${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL explicitly}"
: "${1:?Provide the destination dump file}"
umask 077
if [[ -e "$1" ]]; then echo "Destination already exists; choose a new file." >&2; exit 1; fi
PGDATABASE="$BACKUP_DATABASE_URL" pg_dump --format=custom --no-owner --no-privileges --file="$1"
echo "Backup written. Keep the dump private."
