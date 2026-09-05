#!/usr/bin/env bash
# MuscleOS — automated PostgreSQL backup with retention cleanup.
# Intended to run via cron / GitHub Actions schedule on the production host.
#
# Usage: ./scripts/backup.sh
# Env vars (see .env): DATABASE_URL, BACKUP_DIR, BACKUP_RETENTION_DAYS

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
FILENAME="muscleos-db-${TIMESTAMP}.sql.gz"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Source your .env first." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "==> Dumping database to ${BACKUP_DIR}/${FILENAME}"
pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip > "${BACKUP_DIR}/${FILENAME}"

echo "==> Verifying backup integrity"
gzip -t "${BACKUP_DIR}/${FILENAME}"

echo "==> Pruning backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -name "muscleos-db-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

echo "==> Backup complete: ${BACKUP_DIR}/${FILENAME} ($(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1))"

# Optional: sync to S3-compatible storage if configured.
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  echo "==> Uploading to s3://${BACKUP_S3_BUCKET}/"
  aws s3 cp "${BACKUP_DIR}/${FILENAME}" "s3://${BACKUP_S3_BUCKET}/${FILENAME}"
fi
