# Validação assistida no perfil Default do T3 Code

Registro histórico do fluxo anterior. Após este teste, o usuário aprovou a substituição dos perfis separados por uma extensão local no Helium. Consulte README.md e docs/superpowers/plans/2026-10-28-browser-extension-login.md para o fluxo atual.

Teste solicitado pelo usuário em 27/10/2026, usando as sessões existentes do navegador T3. Nenhum cookie, senha, token ou localStorage foi lido/exportado. Nenhuma ação social ou chamada paga de IA foi executada.

## Resultado observado

- Instagram: acesso autenticado, dois posts com legenda. O DOM real não tinha header/h1/data-testid de legenda; o seletor foi corrigido para o autor e a legenda associada, sem incluir comentários. O avatar deixou de ser considerado imagem principal.
- Valete+: GET autenticado /api/post?filter=all retornou 200 application/json com 15 posts. Três posts com permalinks reais foram selecionados para o smoke test, normalizados e persistidos.
- YouTube: sessão autenticada reconhecida no bootstrap da home, mas sem cartões renderizados no DOM. Acrescentado fallback dos metadados de lockupViewModel em ytInitialData; três recomendações foram normalizadas e persistidas.
- X: o perfil Default abriu tela de login. Nenhum post foi coletado e não houve tentativa de preencher credenciais.

## Escopo da evidência

A leitura ao vivo aconteceu pelo driver do T3 com o perfil Default. Os leitores/normalizadores de produção foram aplicados aos resultados capturados; o HTML do Valete foi convertido em texto inerte em contexto local com rede bloqueada. A persistência usou saveRawItems, fontes e collector_runs do banco real do Orbit.

O painel /status mostrou oito itens reais aguardando análise e o histórico identificado como coleta assistida. Preferências pessoais não foram inventadas ou alteradas. As fontes de teste foram deixadas desativadas para não gerar requisições autônomas não configuradas.

**Não foi validada a execução autônoma de collectBrowser com o perfil Default.** O T3 gerencia esse perfil por seu próprio driver, sem um endpoint CDP público detectado para o worker. O worker continua usando os perfis exclusivos em data/browser-profiles. Não é correto afirmar que ele herdou cookies do T3.

A configuração de IA e o perfil de interesses estavam pendentes; ranking/briefing reais não foram executados. Capturas intermediárias, sem credenciais, foram removidas após a importação. O banco preserva somente os metadados permitidos.
