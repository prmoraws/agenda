# Instalação do executor de entregas

## 1. Atualizar sem ativar envios

Copie o conteúdo deste pacote sobre `~/agenda` e execute:

```bash
cd ~/agenda
node --check src/server.mjs
node --test src/*.test.mjs
node scripts/validate.mjs
docker compose config --quiet
docker compose up -d --build app
curl -sS http://127.0.0.1:3010/api/worker/status
```

O padrão permanece `enabled: false`.

## 2. Revisar o que será enviado

```bash
docker compose exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT m.id, m.scheduled_at, m.status,
       g.display_name, g.group_jid,
       d.status AS delivery_status, d.attempt_count
FROM business_deliveries d
JOIN business_messages m ON m.id = d.message_id
JOIN business_groups g ON g.id = d.group_id
WHERE m.status IN ('confirmed','processing')
  AND m.scheduled_at <= NOW()
  AND d.status IN ('pending','failed')
ORDER BY m.scheduled_at, m.id, g.display_name;
SQL
```

## 3. Ativar conscientemente

Só execute depois de confirmar que todos os destinos vencidos estão corretos:

```bash
cd ~/agenda
if grep -q '^WHATSAPP_SENDING_ENABLED=' .env; then
  sed -i 's/^WHATSAPP_SENDING_ENABLED=.*/WHATSAPP_SENDING_ENABLED=true/' .env
else
  printf '\nWHATSAPP_SENDING_ENABLED=true\n' >> .env
fi
docker compose up -d --force-recreate app
curl -sS http://127.0.0.1:3010/api/worker/status
```

Ao iniciar, o executor processa imediatamente mensagens confirmadas cujo
horário já passou. Depois, verifica a fila a cada 15 segundos.

## 4. Conferir o resultado

Atualize o painel ou abra **Ver detalhes**. Cada grupo mostrará `Enviado`,
`Falhou`, o número de tentativas e, quando aplicável, a próxima tentativa.

Para bloquear novos envios, altere a variável para `false` e recrie o serviço
`app` novamente.
