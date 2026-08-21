#!/bin/sh
set -eu

docker compose exec -T postgres sh -lc \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < infrastructure/postgres/migrations/002-group-community-metadata.sql

docker compose exec -T postgres sh -lc \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < infrastructure/postgres/migrations/003-legacy-group-jid.sql

docker compose exec -T postgres sh -lc \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < infrastructure/postgres/migrations/004-message-lifecycle.sql

echo "Migrações locais aplicadas com sucesso."
