# Agenda

Agendador local e seguro de mensagens para grupos autorizados do WhatsApp
Business `557191856704`.

Este repositório é independente do `prmoraws/agente-domo`.

## Estado atual

- PostgreSQL próprio, acessível somente pela rede interna do projeto.
- Allowlist e confirmação humana de grupos.
- Agendamentos em `America/Bahia`.
- Entregas idempotentes por grupo.
- Cancelamento, retentativas e eventos sanitizados.
- Painel web local para cadastrar e autorizar grupos.
- Criação, confirmação e cancelamento de agendamentos.
- Evolution API exclusiva na porta local `8081`.
- QR Code e importação automática de grupos pelo painel.
- Executor de entregas com bloqueio operacional por padrão.
- Até três tentativas por destino, com intervalos de 1, 5 e 15 minutos.
- Acompanhamento de cada entrega no detalhe do agendamento.
- Foto opcional em JPG, PNG ou WEBP, com até 5 MB.
- Envio da foto com o texto do recado como legenda.
- Repetição semanal entre 2 e 52 semanas.
- Confirmação única da série e controle individual de cada ocorrência.
- Etiquetas próprias para organizar e selecionar grupos.
- Importação do catálogo de etiquetas disponível na Evolution.
- Dashboard operacional com filas, entregas, grupos e próximos envios.
- Páginas separadas para ativos, enviados e cancelados.

## Início local

```bash
cp .env.example .env
# Defina uma senha forte no .env.
node scripts/validate.mjs
docker compose config --quiet
docker compose up -d --build
```

Abra `http://127.0.0.1:3010`.

O painel participa de duas redes: `agenda-backend`, interna para falar com o
banco, e `agenda-edge`, usada apenas para publicar o painel em `127.0.0.1`.
O PostgreSQL permanece fora da rede de acesso do painel.

### Como usar

1. Cadastre o nome e o JID de um grupo.
2. Autorize conscientemente esse grupo.
3. Escreva a mensagem, escolha data, horário e destinos.
4. Opcionalmente, selecione uma foto e revise a prévia.
5. Salve como rascunho e revise a mensagem completa.
6. Confirme ou cancele o agendamento.

Para repetir o mesmo recado, selecione **Repetir semanalmente** e informe a
quantidade total de semanas. O painel mostra a primeira e a última data antes
de salvar. Cada ocorrência possui entrega, tentativas e auditoria próprias.
É possível cancelar somente uma data ou todas as ocorrências futuras da série.

### Organização do painel

- **Visão geral:** indicadores e próximos envios confirmados.
- **Novo agendamento:** texto, foto, recorrência e seleção por etiqueta.
- **Grupos e etiquetas:** conexão, autorizações e classificação dos destinos.
- **Convites em lote:** cole até 30 links `chat.whatsapp.com`, um por linha, para cadastrar grupos sem terminal.
- **Ciclo de vida dos grupos:** edite nomes, retire autorizações, arquive e restaure sem perder o histórico.
- **Reutilização de recados:** transforme um envio concluído ou cancelado em novo rascunho com outra data.
- **Modelos de mensagem:** salve textos frequentes e aplique-os em novos agendamentos.
- **Agendamentos ativos:** rascunhos, confirmados e processando.
- **Enviados:** concluídos e falhas, preservando os detalhes por grupo.
- **Cancelados:** histórico separado.

A Evolution 2.3.7 permite consultar o catálogo de etiquetas, mas não fornece
associações confiáveis entre etiquetas e conversas. Por isso, o Agenda mantém
suas próprias associações grupo→etiqueta, sem alterar etiquetas no aplicativo
WhatsApp Business.

As fotos ficam no volume Docker `agenda_media_data`. Apagar esse volume remove
os anexos armazenados. O banco guarda apenas os metadados e o caminho interno.

O painel está limitado ao computador local. A confirmação coloca as entregas
na fila. O executor somente envia quando `WHATSAPP_SENDING_ENABLED=true`.

### Conectar o WhatsApp Business

1. Abra a seção `Conexão WhatsApp Business`.
2. Crie a instância isolada `domo-business-agendamentos`.
3. Solicite o QR Code e leia-o no WhatsApp Business.
4. Importe os grupos reais.
5. Autorize manualmente somente os grupos que poderão receber mensagens.

Descobrir um grupo não o autoriza automaticamente.

### Ativar o envio automático

O padrão seguro é `WHATSAPP_SENDING_ENABLED=false`. Antes de alterar essa
variável, revise os agendamentos confirmados e vencidos: ao ativar o executor,
eles serão processados imediatamente.

Depois da revisão, defina no `.env`:

```dotenv
WHATSAPP_SENDING_ENABLED=true
DELIVERY_WORKER_INTERVAL_MS=15000
```

Recrie somente o painel com `docker compose up -d --build app`. O estado pode
ser conferido em `http://127.0.0.1:3010/api/worker/status`.

## Acesso externo gratuito

O painel pode ser acessado externamente por um Quick Tunnel da
Cloudflare, protegido pelo gateway Caddy com autenticação obrigatória.

Iniciar ou recuperar o acesso externo:

```bash
npm run public:start
```

Consultar o endereço atual:

```bash
npm run public:url
```

O endereço `trycloudflare.com` é temporário e pode mudar quando o
contêiner `agenda-cloudflared` for recriado. PostgreSQL, Redis e
Evolution permanecem inacessíveis pela Internet.

## Acesso externo

O painel possui endereço HTTPS permanente e protegido:

- https://agenda.tailbd3b60.ts.net
- operação: `npm run access:status`
- documentação: [Acesso externo pelo Tailscale](docs/ACESSO-EXTERNO-TAILSCALE.md)
