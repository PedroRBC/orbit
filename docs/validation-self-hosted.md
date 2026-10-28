# Validação do Orbit self-hosted

Data: 28/10/2026. [PR #2](https://github.com/PedroRBC/orbit/pull/2).

## Promoção para a versão oficial

Após validar o candidato, o usuário autorizou integrar na `main` e publicar `0.2.0`, `latest` e `sha-<commit curto>`. As referências padrão do Compose e do guia passam a `0.2.0`. A [publicação da main](https://github.com/PedroRBC/orbit/actions/workflows/ci.yml?query=branch%3Amain) verifica as três tags, o digest e a privacidade do pacote antes de a entrega ser declarada publicada.

Os resultados e o digest da seção de publicação abaixo pertencem ao candidato anterior `rc.2`, não à versão oficial. NAS e celular reais continuam pendentes do usuário.

## Escopo e ambiente

- Serviço único: Docker, SQLite persistente, senha + TOTP, extensão pela API e PWA.
- TrueNAS identificado por consulta somente leitura: 25.10.7, amd64. Nenhuma configuração do NAS foi alterada.
- Desenvolvimento numa worktree separada; o checkout com o servidor pessoal ficou na `main`. O `next-env.d.ts` já modificado do usuário foi preservado.
- Sem API paga, sem `.env` real, sem banco pessoal e sem sessões reais das plataformas. Dados de teste só em bancos temporários.

## Executado

| Verificação | Resultado |
| --- | --- |
| `npm test` | 123 testes, 22 arquivos, passaram |
| `npm run typecheck` | Passou |
| `npm run build` | Passou; inclui bundle da extensão |
| `E2E_PRODUCTION=1 npm run test:e2e` | 14 passaram |
| CI no commit do candidato (`f56c736d`) | [Aprovado](https://github.com/PedroRBC/orbit/actions/runs/40696509976) |
| Imagem local do candidato | Build e start passaram; UID 568:568, raiz somente leitura, sem capabilities |
| Saúde do app e worker | `/api/health` retornou 200 com `ok: true`, `worker: true` |
| Guarda de sessão na imagem | Cookie inventado em pedido RSC recebeu 307, sem conteúdo pessoal |
| Encerramento | SIGTERM encerrou com código 0 e liberou o lease |
| Persistência | Recriação preservou fontes, interesses, sessões e pareamento |
| Recuperação | Execução órfã retomada sem criar outra execução geral; queda do worker provocou reinício do contêiner |
| Migrações | Banco legado da fase 1 atualizado sem perder fontes e interesses; tabela de sessões coberta pela suíte |
| Volume sem permissão | Processo recusou iniciar com mensagem de caminho e UID |
| Backup | Cópia online do WAL em arquivo único, `integrity_check = ok`; script também executado dentro da imagem |
| HTTPS local com Caddy | Login, cookie Secure/HttpOnly/Strict, Server Action, pareamento e consulta do companion passaram; outra origem recebeu 403 |
| Extensão real em Chromium isolado | Pareou pela API, coletou fixtures pelo worker, preservou abas preexistentes e limpou regras temporárias |
| PWA | Manifest, ícones e SW acessíveis sem sessão; offline guardou só `/offline.html`; sem reenvio de ações |
| Celular emulado | Leitura, filtros, feedback, perfil, status e alvos de toque mínimos de 24 px testados a 390 px |
| Gates de publicação | Privado + tags corretas passa; público, tag SHA ausente ou digest divergente falham |

## Revisão de segurança

Correções de `4ce91eff`, com regressões:

- Sessão validada no proxy e no início de cada página, ação e rota protegida. O layout sozinho não impedia o vazamento de payload RSC com cookie inventado.
- Destino pós-login recusa caracteres de controle e redirecionamentos externos.
- Bloqueio por cliente, sem bloqueio global que permitiria trancar o dono fora; comando `auth unlock`.
- Corpo do companion limitado antes da leitura; HTTP remoto, token inválido e origem de página comum recusados.
- Código TOTP usado no setup não pode ser reutilizado; códigos de recuperação com 80 bits.

O proxy reverso é a fronteira HTTPS: a porta HTTP do contêiner deve ser acessível só a ele. Não basta confiar num cabeçalho enviado por um cliente direto. Isso está documentado no guia de implantação.

## Publicação

Candidato: `ghcr.io/pedrorbc/orbit:0.2.0-rc.2`, código de `f56c736dbfc12d53c14ab7adfe66566fa0d32bd9`.

Execução: https://github.com/PedroRBC/orbit/actions/runs/40696551059.

Execução aprovada, incluindo os passos `Check private publication destination` e `Verify private package and published tags`. A API retornou `private`, e a API de pacotes e o registry confirmaram as duas tags no mesmo digest:

```text
ghcr.io/pedrorbc/orbit:0.2.0-rc.2
ghcr.io/pedrorbc/orbit:sha-f56c736
sha256:247766a60bf7b000e1fae051680cdc3c69ea449190ce24e38d9ed05fcb332c0c
```

O candidato é de teste, não uma versão estável. O token local não tem `read:packages`; por isso, a conferência do pacote privado foi feita dentro do workflow com o `GITHUB_TOKEN`, sem novo segredo nem mudança de visibilidade.

## Pendente do usuário

- Instalar o Custom App no TrueNAS, conferir ACL/UID 568, configurar `orbit.env` e credencial de leitura do GHCR diretamente no NAS.
- Configurar o proxy/domínio ou VPN escolhido, certificado válido, Host permitido e isolamento da porta HTTP.
- Criar e testar o cron de backup e uma restauração em dataset separado.
- Instalar/recarregar a extensão no perfil real do Helium e permitir o host HTTPS do Orbit.
- Instalar o PWA num Android/iPhone real; testar fora de casa, expiração de sessão e desconexão.

Tailscale Serve e Nginx Proxy Manager não foram testados de ponta a ponta. Testes sintéticos não garantem o layout atual dos feeds em cada conta nem a compatibilidade de cada aparelho.
