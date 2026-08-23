# Acesso externo do Agenda

## Endereço permanente

https://agenda.tailbd3b60.ts.net

O Agenda é publicado pelo Tailscale Funnel e protegido pelo
gateway Caddy com autenticação HTTP.

Visitantes não precisam instalar Tailscale.

## Arquitetura

Internet → Tailscale Funnel → Caddy → Agenda

- Tailscale encerra o HTTPS público.
- Caddy exige usuário e senha.
- O serviço Agenda não é publicado diretamente.
- O computador local, Docker e a internet precisam permanecer ativos.

## Operação

Verificar o acesso:

```bash
npm run access:status
```

Reiniciar apenas o acesso externo:

```bash
docker compose restart tailscale gateway
```

Verificar o Funnel:

```bash
docker compose exec -T tailscale tailscale funnel status
```

## Segurança

- A chave de cadastro Tailscale não permanece no .env.
- A identidade está no volume agenda_tailscale_state.
- O arquivo .env nunca deve ser versionado.
- O gateway deve continuar exigindo autenticação.
- A porta do Agenda permanece vinculada ao localhost.

## Recuperação

Se o volume agenda_tailscale_state for perdido:

1. Gere uma nova chave descartável no painel Tailscale.
2. Adicione temporariamente TS_AUTHKEY ao serviço tailscale.
3. Recrie o contêiner e valide o acesso.
4. Remova novamente a chave do Compose e do .env.
5. Revogue a chave no painel Tailscale.
