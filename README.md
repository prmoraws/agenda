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

O painel participa de duas redes: `agenda-backend`, interna para falar com o
banco, e `agenda-edge`, usada apenas para publicar o painel em `127.0.0.1`.
O PostgreSQL permanece fora da rede de acesso do painel.

### Como usar

1. Cadastre o nome e o JID de um grupo.
2. Autorize conscientemente esse grupo.
3. Escreva a mensagem, escolha data, horário e destinos.
4. Salve como rascunho e revise a prévia.
5. Confirme ou cancele o agendamento.

O painel está limitado ao computador local. A confirmação apenas prepara a
fila; não existe executor de WhatsApp neste bloco.

### Conectar o WhatsApp Business

1. Abra a seção `Conexão WhatsApp Business`.
2. Crie a instância isolada `domo-business-agendamentos`.
3. Solicite o QR Code e leia-o no WhatsApp Business.
4. Importe os grupos reais.
5. Autorize manualmente somente os grupos que poderão receber mensagens.

A integração não declara nem utiliza endpoint de envio. Descobrir um grupo não
o autoriza automaticamente.
