# Orbit editorial, temas e edições gerais

> Nota de substituição (28/10/2026): a [especificação de notificações, briefings e temas](2026-10-28-briefings-push-themes-design.md) substitui o catálogo fechado de oito temas por oito sementes e temas automáticos (três itens pessoais distintos, teto de 40), e permite até três notícias RSS externas identificadas como complemento do briefing pessoal. Acrescenta também configuração reconhecida, contato Push no arquivo e briefings sob demanda. As recomendações pessoais continuam sem RSS. Este documento preserva o desenho histórico; essas mudanças estão em desenvolvimento, sem nova versão ou publicação nesta etapa.

## Autorização e limites

Implementação autorizada pelo objetivo desta sessão em 28/10/2026: interface profissional, taxonomia controlada, edições gerais às 08h/16h e Web Push. Continuar o serviço privado de uma pessoa, com login, PWA e Docker existentes. Não fazer commit, push, publicação, merge ou alterações no TrueNAS. Alterações locais do checkout principal permanecem intocadas; trabalho em worktree `orbit-editorial`.

## Direção

A leitura vem antes da operação: panorama geral e arquivo de edições, recomendações pessoais, temas e salvos; fontes, perfil e configuração permanecem acessíveis em navegação secundária. Preservar identidade escura/lavanda, fontes locais e Lucide. Melhorar ritmo tipográfico, títulos editoriais, limites de leitura, navegação móvel, foco, estados vazio/erro/carregando. Não adicionar decoração raster, métricas inventadas, controles sem função ou serviço de fontes externas.

## Taxonomia

A classificação atual aceita qualquer texto como `theme`; o levantamento somente leitura encontrou dezenas de rótulos por pessoa/acontecimento. A contagem verificada depois na cópia temporária foi de 54 rótulos para 57 itens classificados. Adotar catálogo pequeno com IDs fixos, incluindo exatamente Política interna (Brasil), Política externa (relações internacionais) e Tecnologia ampla. As demais categorias abrangem os dados atuais, sem transformar entidades em categorias. A IA recebe catálogo e só pode devolver IDs dele.

Consolidar localmente em transação idempotente, sem reclassificação paga. Preservar conteúdo, vínculos, feedback, interesses livres e clusters/histórico dos briefings. Guardar auditoria dos temas e pesos anteriores. Aliases de pesos convergem pela média aritmética, nunca pela soma; novos sinais continuam reversíveis. Desconhecidos vão para Outros com rastreabilidade, sem inferir fatos ausentes. Validar gravações futuras, ajustes de peso e filtros na fronteira compartilhada.

## Edições gerais

Reutilizar `collector_runs` como fila durável, com tipo de execução e vínculo a uma edição. Worker único sob lease executa sequencialmente coletas pessoais e edições. Scheduler da edição considera apenas o horário mais recente vencido, com janela de atraso de duas horas; não recupera dias perdidos. Chave única por fuso, data local e 08h/16h. Falhas não criam novas edições nem ciclos de retentativa; retomadas por reinício têm limite persistido.

Usar fuso explicitamente configurado na agenda ou `COLLECTOR_TIMEZONE`. Sem ambos, propor `America/Sao_Paulo` na interface e exigir confirmação para ativar a agenda geral. Separar ativação da agenda geral da coleta pessoal.

Cada edição coleta exclusivamente RSS públicos habilitados via coletor seguro existente, sem extensão. O fechamento de cobertura é o horário programado, mostrado junto ao horário real de geração. Manhã cobre as 24 horas anteriores. Tarde cobre desde 08h, exclui IDs usados de manhã e recebe o contexto da edição matinal sem tratá-lo como novidade. Ignorar itens sem data ou fora da cobertura; mostrar ausência/insuficiência de fontes em vez de inventar notícias. Ausência de fontes ou IA produz edição indisponível com orientação, não conteúdo falso.

Gerar destaques com resumo, contexto, relevância e IDs de fontes validados. URLs e autores vêm do banco, não da IA. Usar o protocolo/modelo de briefing configurado e a reserva de orçamento existente. Persistir todas as edições e seus estados para consulta autenticada no site/PWA. RSS externos continuam excluídos de recomendações e briefing pessoais.

## Web Push

Web Push real com biblioteca mantida para criptografia/VAPID. Permissão somente após clique; ativação, desativação, teste e estado por aparelho. VAPID privada persistida no banco do servidor; só chave pública chega ao navegador. Contato `ORBIT_PUSH_SUBJECT` explícito. Inscrições são segredos, validadas e limitadas; endpoints HTTPS dos provedores conhecidos evitam SSRF. Usar Server Actions autenticadas com proteção de origem existente.

Publicação da edição e inserção da outbox ocorrem na mesma transação. Uma entrega por edição/inscrição. Claim antes da rede, lease na escrita e na fronteira de envio. Remover inscrições 404/410. Não repetir resultado ambíguo após queda: preferir possível perda a duplicação, documentando limite. Mensagem genérica na tela bloqueada; clique abre somente `/briefings/<id>` da própria origem. SW continua guardando apenas a página offline estática.

## Validação

Testes sintéticos/in-memory e serviços locais, sem API paga, sem fontes presumidas, sem chaves reais. Cobrir consolidação/rollback/idempotência, pesos, fusos/DST/atrasos/reinícios, seleção e validação de fontes, orçamento, push/expiração/duplicação/CSRF e links do SW. Rodar suíte completa, typecheck, build e e2e desktop/móvel relevantes. Documentar evidência e limitações; teste físico no celular/NAS fica explicitamente pendente, com roteiro.
