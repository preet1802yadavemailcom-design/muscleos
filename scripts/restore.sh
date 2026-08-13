#!/usr/bin/env bash
# MuscleOS — restore a database backup produced by scripts/backup.sh
# Usage: ./scripts/restore.sh path/to/muscleos-db-<timestamp>.sql.gz

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <backup-file.sql.gz>" >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Source your .env first." >&2
  exit 1
fi

echo "WARNING: this will overwrite the current database at \$DATABASE_URL."
read -p "Type 'restore' to continue: " CONFIRM
if [ "$CONFIRM" != "restore" ]; then
  echo "Aborted."
  exit 1
fi

echo "==> Restoring from $1"
gunzip -c "$1" | psql "$DATABASE_URL"
echo "==> Restore complete"
