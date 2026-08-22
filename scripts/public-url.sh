#!/bin/sh
set -eu

PROJECT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

URL="$(
  docker compose logs cloudflared --no-color 2>/dev/null |
    grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' |
    tail -1 || true
)"

if [ -z "$URL" ]; then
  echo "Endereço externo não encontrado."
  echo "Execute: npm run public:start"
  exit 1
fi

HTTP_STATUS="$(
  curl -sS -o /dev/null -w '%{http_code}' "$URL/" ||
    true
)"

echo "Agenda externa: $URL"
echo "Proteção: HTTP $HTTP_STATUS"
echo "Usuário: agenda-admin"

if [ "$HTTP_STATUS" != "401" ]; then
  echo "ATENÇÃO: autenticação externa não foi confirmada."
  exit 1
fi
