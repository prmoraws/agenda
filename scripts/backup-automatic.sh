#!/bin/sh
set -eu

PROJECT_DIR="/home/moraws/agenda"
BACKUP_ROOT="${AGENDA_BACKUP_ROOT:-/home/moraws/agenda-backups}"
LOG_FILE="$BACKUP_ROOT/automatic-backup.log"
LOCK_FILE="/tmp/agenda-automatic-backup.lock"
RETENTION_DAYS="${AGENDA_BACKUP_RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_ROOT"

exec >> "$LOG_FILE" 2>&1

echo
echo "=================================================="
echo "Início: $(date --iso-8601=seconds)"

cd "$PROJECT_DIR"

attempt=1
while [ "$attempt" -le 30 ]; do
  if docker info >/dev/null 2>&1; then
    echo "Docker disponível."
    break
  fi

  echo "Aguardando Docker: tentativa $attempt/30"
  attempt=$((attempt + 1))
  sleep 10
done

if ! docker info >/dev/null 2>&1; then
  echo "ERRO: Docker indisponível após cinco minutos."
  exit 1
fi

if ! flock -n "$LOCK_FILE" sh scripts/backup-local.sh; then
  echo "Backup ignorado: outra execução está ativa."
  exit 0
fi

echo "Removendo backups com mais de $RETENTION_DAYS dias."

find "$BACKUP_ROOT"   -mindepth 1   -maxdepth 1   -type d   -mtime "+$RETENTION_DAYS"   -print   -exec rm -rf -- {} +

echo "Fim: $(date --iso-8601=seconds)"
echo "Backup automático concluído."
