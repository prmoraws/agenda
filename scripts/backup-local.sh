#!/bin/sh
set -eu

BACKUP_ROOT="${AGENDA_BACKUP_ROOT:-$HOME/agenda-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DESTINATION="$BACKUP_ROOT/$STAMP"

mkdir -p "$DESTINATION"

echo "Backup: $DESTINATION"

echo "1/4 PostgreSQL"
docker compose exec -T postgres sh -lc '
  pg_dump     -U "$POSTGRES_USER"     -d "$POSTGRES_DB"     --format=custom     --no-owner     --no-privileges
' > "$DESTINATION/database.dump"

test -s "$DESTINATION/database.dump"

echo "2/4 Fotos e anexos"
docker run --rm   -v agenda_media_data:/source:ro   -v "$DESTINATION:/backup"   alpine:3.22   tar -C /source -czf /backup/media.tar.gz .

echo "3/4 Configuração sem segredos"
tar -czf "$DESTINATION/project-config.tar.gz"   compose.yaml   Caddyfile   infrastructure   docs   README.md   package.json   package-lock.json   scripts

echo "4/4 Integridade"
(
  cd "$DESTINATION"
  sha256sum     database.dump     media.tar.gz     project-config.tar.gz     > SHA256SUMS

  sha256sum -c SHA256SUMS
)

printf '%s
'   "Agenda Business"   "Criado em: $(date --iso-8601=seconds)"   "Banco: database.dump"   "Mídia: media.tar.gz"   "Configuração: project-config.tar.gz"   "Segredos do .env: não incluídos"   > "$DESTINATION/LEIA-ME.txt"

echo
echo "Backup concluído: $DESTINATION"
du -sh "$DESTINATION"
