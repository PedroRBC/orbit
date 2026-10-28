# Changelog

## 0.2.2 — 2026-10-28

- Corrigido o bloqueio de `AI_BASE_URL` por HTTP fora de localhost: CliProxyApi e outros endpoints configurados no servidor aceitam IP da LAN, hostname e nome de serviço Docker, nos dois protocolos, para classificação e briefings. Nenhuma flag adicional é necessária.
- Credenciais, query e fragmento na URL continuam recusados; redirecionamentos não são seguidos. Login, companion, RSS públicos e Web Push mantêm suas proteções atuais.
- HTTP transporta chave e textos sem criptografia; use somente em rede confiável e prefira HTTPS fora dela.
- Versão, lockfile, Compose e guia alinhados em `0.2.2`. A tag estável `v0.2.2` publica `0.2.2`, `sha-<commit>` e `latest` no GHCR privado existente, sem merge na main ou alteração no NAS.
- Teste de release atualizado para a política vigente: main e tags estáveis promovem `latest`; candidatos nunca. Sem migração de banco ou alteração da extensão nesta versão.

## 0.2.1 — 2026-10-28

### Adicionado

- Interface editorial com navegação principal Hoje, Briefings e Temas, layout móvel e estados acessíveis.
- Catálogo fechado de oito temas com IDs estáveis, aliases e consolidação local transacional/idempotente. Rótulos e pesos anteriores ficam auditados; pesos equivalentes são combinados pela média.
- Briefings gerais com fechamentos às 08h e 16h no fuso configurado, coleta de RSS públicos no servidor e arquivo autenticado. A edição da tarde prioriza novidades desde a manhã.
- Web Push por aparelho, com consentimento explícito, teste antes da primeira edição, desativação, mensagem discreta e abertura da edição correta.
- Documentação de configuração, backup/migração, HTTPS, instalação Android/iOS e roteiro de teste físico.

### Corrigido

- A classificação de IA e a persistência não aceitam novos temas livres.
- Datas `updated` do Atom não são tratadas como publicação. Registros legados aguardam comprovação por nova coleta, sem sobrescrever datas históricas.
- Edições gerais não consomem a cota nem cancelam coletas pessoais no mesmo horário.
- Publicação da edição e fila push são atômicas; unicidade e claim persistido evitam novas tentativas após resultados ambíguos.
- Tags semver não promovem `latest` automaticamente fora da main. A publicação de `v0.2.1` mantém main e `latest` intactos.

### Atualização e limites

- Faça backup online verificado antes de atualizar: há novas migrações e consolidação de temas.
- Configure RSS públicos, `AI_BRIEFING_MODEL`, fuso e `ORBIT_PUSH_SUBJECT`. Nenhuma fonte, preferência ou notícia é presumida.
- Endpoint/protocolo/modelos de IA existentes continuam sob controle do usuário. RSS externos não entram no briefing ou nas recomendações pessoais.
- Push depende dos serviços do navegador/SO. A entrega não é pontual nem garantida; tentativa única pode perder avisos em quedas.
- Validação da implementação: 253 testes, typecheck, build e 15 e2e passaram, sem API paga. A preparação da versão acrescenta dois testes de integridade de release.
- Sem teste em celular/NAS físico, envio real de push ou implantação no TrueNAS. A CI da tag deve concluir antes de considerar a imagem privada disponível.

## 0.2.0 — 2026-10-28

- Serviço Docker self-hosted, login por senha/TOTP, API companion, PWA e publicação privada no GHCR.
