# Agenda

Agendador local e seguro de mensagens para grupos autorizados do WhatsApp
Business `557191856704`.

Este repositório é independente do `prmoraws/agente-domo`.

## Estado atual

- PostgreSQL próprio na porta local `5434`.
- Allowlist e confirmação humana de grupos.
- Agendamentos em `America/Bahia`.
- Entregas idempotentes por grupo.
- Cancelamento, retentativas e eventos sanitizados.
- Painel web local para cadastrar e autorizar grupos.
- Criação, confirmação e cancelamento de agendamentos.
- Nenhum envio real ou conexão por QR Code nesta etapa.

## Início local

```bash
cp .env.example .env
# Defina uma senha forte no .env.
node scripts/validate.mjs
docker compose config --quiet
docker compose up -d --build
```

Abra `http://127.0.0.1:3010`.

### Como usar

1. Cadastre o nome e o JID de um grupo.
2. Autorize conscientemente esse grupo.
3. Escreva a mensagem, escolha data, horário e destinos.
4. Salve como rascunho e revise a prévia.
5. Confirme ou cancele o agendamento.

O painel está limitado ao computador local. A confirmação apenas prepara a
fila; não existe executor de WhatsApp neste bloco.
