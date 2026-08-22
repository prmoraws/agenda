# Repetição semanal — Agenda 0.4.0

## O que muda

- Opção `Não repetir` ou `Repetir semanalmente`.
- De 2 a 52 envios, contando o primeiro.
- Prévia da primeira e da última data.
- Uma confirmação humana para toda a série.
- Cada semana mantém situação, tentativas e horário próprios.
- Cancelamento de uma ocorrência ou de toda a série futura.
- Texto, foto e grupos são repetidos igualmente na criação da série.

## Atualização local

Por segurança, pare somente o painel/executor antes de atualizar:

```bash
cd ~/agenda
docker compose stop app
```

Depois de extrair o pacote sobre `~/agenda`:

```bash
cd ~/agenda
chmod +x scripts/apply-migrations.sh
./scripts/apply-migrations.sh

node --check src/server.mjs
npm test
node scripts/validate.mjs
docker compose config --quiet
docker compose up -d --build app

curl -sS http://127.0.0.1:3010/health
```

O `.env` não é incluído no pacote. Portanto, o estado atual de
`WHATSAPP_SENDING_ENABLED` será preservado.

## Como usar

1. Escreva a mensagem e, opcionalmente, escolha uma foto.
2. Defina a data e o horário do primeiro envio.
3. Em `Repetição`, escolha `Repetir semanalmente`.
4. Informe a quantidade total de semanas.
5. Confira a primeira e a última data apresentadas pelo painel.
6. Escolha os grupos e salve a série como rascunho.
7. Revise as ocorrências e clique em `Confirmar série semanal`.

Confirmar a série não envia antecipadamente: cada ocorrência permanece na fila
até sua própria data programada.
