#!/bin/sh
set -eu

PROJECT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

docker compose up -d gateway cloudflared

echo "Aguardando endereço externo..."

attempt=1
while [ "$attempt" -le 30 ]; do
  URL="$(
    docker compose logs cloudflared --no-color 2>/dev/null |
      grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' |
      tail -1 || true
  )"

  if [ -n "$URL" ]; then
    HTTP_STATUS="$(
      curl -sS -o /dev/null -w '%{http_code}' "$URL/" ||
        true
    )"

    echo
    echo "Agenda externa: $URL"
    echo "Proteção sem credenciais: HTTP $HTTP_STATUS"
    echo "Usuário: agenda-admin"

    if [ "$HTTP_STATUS" = "401" ]; then
      echo "Acesso externo protegido e operacional."
      exit 0
    fi
  fi

  attempt=$((attempt + 1))
  sleep 2
done

echo "Não foi possível validar o endereço externo."
docker compose logs gateway cloudflared --tail=80
exit 1
