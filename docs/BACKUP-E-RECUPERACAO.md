# Backup e recuperação local

## Conteúdo

O comando `npm run backup` cria:

- `database.dump`: PostgreSQL em formato custom;
- `media.tar.gz`: imagens e anexos;
- `project-config.tar.gz`: código operacional sem o arquivo .env;
- `SHA256SUMS`: verificação de integridade;
- `LEIA-ME.txt`: identificação do backup.

## Local padrão

```text
~/agenda-backups/AAAAMMDD-HHMMSS
```

Para escolher outro local:

```bash
AGENDA_BACKUP_ROOT=/outro/local npm run backup
```

## Verificar um backup

```bash
cd ~/agenda-backups/AAAAMMDD-HHMMSS
sha256sum -c SHA256SUMS
```

Todos os arquivos devem retornar `OK`.

## Recuperação

A restauração é deliberadamente manual porque substitui dados.

Antes de restaurar:

1. pare o serviço `app`;
2. preserve um backup do estado atual;
3. confirme o diretório exato do backup;
4. restaure primeiro o banco;
5. restaure depois as mídias;
6. inicie o Agenda e execute os testes de saúde.

O arquivo `.env` não faz parte do backup e deve ser protegido
separadamente.
