#!/usr/bin/env bash
set -Eeuo pipefail

mkdir -p backups
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
docker compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > "backups/wallet-${timestamp}.dump"
find backups -type f -name 'wallet-*.dump' -mtime +14 -delete
echo "Backup written: backups/wallet-${timestamp}.dump"
