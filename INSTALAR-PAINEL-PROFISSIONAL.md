# Agenda 0.7.0 — modelos reutilizáveis de mensagem

## Entregas

- Dashboard operacional.
- Navegação por páginas.
- Etiquetas internas e catálogo da Evolution.
- Filtro e seleção de destinos por etiqueta.
- Agendamentos ativos separados dos enviados e cancelados.
- Pesquisa no histórico de enviados.
- Cadastro em lote de grupos ou subgrupos colando até 30 links de convite.
- Edição do nome exibido, retirada de autorização, arquivamento e restauração.
- Proteção contra arquivamento de grupos com entregas futuras ativas.
- Botão `Usar novamente` em enviados, falhas e cancelados.
- Novo rascunho com texto, foto e grupos ainda autorizados.
- Modelos de texto com criação, aplicação, atualização por nome e exclusão segura.

## Atualização

```bash
cd ~/agenda
docker compose stop app
```

O navegador normalmente salva o pacote em `~/Downloads`. Extraia com:

```bash
tar -xzf ~/Downloads/agenda-painel-profissional-v0.7.0.tar.gz -C ~/agenda
```

Depois:

```bash
cd ~/agenda
chmod +x scripts/apply-migrations.sh
./scripts/apply-migrations.sh

node --check src/server.mjs
npm test
node scripts/validate.mjs
docker compose config --quiet

docker compose up -d --build --force-recreate evolution app
curl -sS http://127.0.0.1:3010/health
curl -sS http://127.0.0.1:3010/api/dashboard
```

O pacote não contém `.env`; o valor atual de
`WHATSAPP_SENDING_ENABLED=true` permanece configurado.

Abra `http://127.0.0.1:3010` e pressione `Ctrl + F5`.

## Adicionar grupo pelo link

1. Abra `Grupos e etiquetas`.
2. Cole um ou vários links, um por linha, em `Adicionar por links de convite`.
3. Clique em `Localizar e adicionar`.
4. Confira o nome e o JID retornados.
5. Clique em `Autorizar conscientemente` antes de usar o grupo.

O backend usa a chave da Evolution internamente. Ela não é enviada ao navegador.

## Etiquetas

1. Abra `Grupos e etiquetas`.
2. Crie uma etiqueta própria ou importe o catálogo do WhatsApp.
3. Em cada grupo, clique em `Gerenciar etiquetas`.
4. No novo agendamento, filtre os destinos pela etiqueta.
5. Use `Selecionar exibidos` para selecionar todos os grupos filtrados.

As associações são mantidas no Agenda porque a Evolution 2.3.7 não garante a
sincronização das etiquetas com o aplicativo WhatsApp Business.
