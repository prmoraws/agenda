#!/bin/sh
set -eu

URL="${AGENDA_PUBLIC_URL:-https://agenda.tailbd3b60.ts.net}"

echo "=== CONTÊINERES ==="
docker compose ps tailscale gateway app

echo
echo "=== FUNNEL ==="
docker compose exec -T tailscale tailscale funnel status

echo
echo "=== ACESSO PÚBLICO PROTEGIDO ==="
HTTP_STATUS="$(
  curl -sS     --max-time 30     -o /dev/null     -w "%{http_code}"     "$URL/health" ||
  true
)"

echo "URL: $URL"
echo "HTTP: $HTTP_STATUS"

if [ "$HTTP_STATUS" != "401" ]; then
  echo "ERRO: autenticação externa não confirmada."
  exit 1
fi

echo "Agenda pública, acessível e protegida."
