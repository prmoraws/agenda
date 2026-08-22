# Bloco de fotos nos agendamentos

## Funcionalidade

- Foto opcional em JPG, PNG ou WEBP, limitada a 5 MB.
- Prévia antes de salvar.
- Texto do recado enviado como legenda da foto.
- Foto exibida na lista e nos detalhes do agendamento.
- Edição, substituição e remoção antes do processamento.
- Arquivos persistidos no volume Docker `agenda_media_data`.
- Agendamentos sem foto continuam usando o envio de texto.

## Instalação segura

Primeiro bloqueie temporariamente o executor:

```bash
cd ~/agenda

if grep -q '^WHATSAPP_SENDING_ENABLED=' .env; then
  sed -i 's/^WHATSAPP_SENDING_ENABLED=.*/WHATSAPP_SENDING_ENABLED=false/' .env
else
  printf '\nWHATSAPP_SENDING_ENABLED=false\n' >> .env
fi
```

Depois de extrair o pacote sobre `~/agenda`, execute:

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

Abra `http://127.0.0.1:3010`, crie um rascunho com foto e confira a prévia.
Os testes e a criação do rascunho não enviam mensagens.

## Reativar os agendamentos

Após conferir a interface:

```bash
cd ~/agenda
sed -i 's/^WHATSAPP_SENDING_ENABLED=.*/WHATSAPP_SENDING_ENABLED=true/' .env
docker compose up -d --force-recreate app
curl -sS http://127.0.0.1:3010/api/worker/status
```

Para validar o envio, crie um novo agendamento futuro para um grupo autorizado,
revise a foto e a legenda e só então confirme.
