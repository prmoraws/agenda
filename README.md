# Agenda

Agendador local e seguro de mensagens para grupos autorizados do WhatsApp
Business `557191856704`.

Este repositório é independente do `prmoraws/agente-domo`.

## Primeiro bloco

- PostgreSQL próprio na porta local `5434`.
- Allowlist e confirmação humana de grupos.
- Agendamentos em `America/Bahia`.
- Entregas idempotentes por grupo.
- Cancelamento, retentativas e eventos sanitizados.
- Nenhum envio real ou conexão por QR Code nesta etapa.

## Início local

```bash
cp .env.example .env
# Defina uma senha forte no .env.
node scripts/validate.mjs
docker compose config --quiet
docker compose up -d postgres
```
