# Web Push de edições

## Integração

O módulo depende da migração de `src/db/push-schema.ts`. Não cria tabelas em runtime. Reexporte `pushSubscriptions` e `pushDeliveries` pelo schema principal e gere/aplique a migração antes de incluir a UI ou chamar o worker.

Contratos da biblioteca (`src/lib/push.ts`):

```ts
queueEditionPush(db: OrbitDB, editionId: number): void;
queuePushTest(db: OrbitDB, endpoint: unknown, editionId: number | null): void;
drainPush(db: OrbitDB, assertActive: () => void, signal?: AbortSignal): Promise<void>;
```

Enfileire **somente uma edição pronta**, na mesma transação que persiste seus dados finais. `queueEditionPush` não abre transação nem checa o lease por conta própria; a transação chamadora já precisa validar a propriedade do worker:

```ts
db.transaction(() => {
  assertActive();
  // Persistir a edição pronta e seus destaques.
  queueEditionPush(db, editionId);
}, { behavior: "immediate" });
```

Não enfileire uma edição indisponível, em processamento ou que foi apenas recuperada do cache. A unicidade impede novos envios da mesma edição para a mesma inscrição. A função valida ID inteiro positivo e seguro, mas não consulta a edição: a integração é responsável por existência/estado. Nenhuma inscrição nova recebe edições retroativas automaticamente.

No laço do worker, faça `await drainPush(db, assertActive, controller.signal)` **sequencialmente**, inclusive sem coleta pendente, após adquirir/renovar o lease. Cada chamada processa no máximo vinte registros; as próximas chamadas continuam a fila. Não use `Promise.all`, timers de reenvio ou recuperação que transforme `attempted` em `queued`. `assertActive` deve lançar ao perder lease/parar; aborte também o signal quando interromper o worker. Cancelamento e perda do lease são propagados sem finalizar a entrega que outro worker poderia observar. Falhas comuns de provedor são registradas sem abortar a próxima entrega.

Componente nomeado (`src/app/push-settings.tsx`):

```tsx
<PushSettings editionId={latestReadyEditionId ?? null} />
```

Props: `{ editionId?: number | null }`. Ativar/desativar e testar funcionam antes da primeira edição. Com `editionId: null` (também o padrão se omitido), o teste abre o arquivo `/briefings`; com um ID positivo seguro, abre essa edição. O componente usa classes existentes (`panel`, `button`, `access-actions`, mensagens e textos auxiliares); não precisa de CSS novo. Renderize-o em uma página autenticada que já chama `await requireSession()`.

Server Actions em `src/app/push-actions.ts` (todas começam com `await requireSession()`):

```ts
getPushConfiguration(endpoint?: string | null): Promise<PushConfiguration>;
subscribePush(serialized: string): Promise<ActionResult>;
unsubscribePush(endpoint: string): Promise<ActionResult>;
testPush(endpoint: string, editionId: number | null): Promise<ActionResult>;

// Tipos; somente estes dados voltam ao navegador.
type PushConfiguration = {
  publicKey: string | null;
  subscribed: boolean;
  message: string;
};
type ActionResult = { message: string; error?: boolean; code?: string };
```

`serialized` é `JSON.stringify(subscription.toJSON())`, limitado a 4 KiB. O endpoint opcional da consulta informa o estado **da inscrição deste aparelho**, sem listar outras inscrições. Os endpoints e chaves já presentes no navegador são enviados apenas às ações autenticadas; o servidor nunca os devolve. As ações de teste só enfileiram, não afirmam entrega. `testPush` e `queuePushTest` aceitam `null` para testar antes da primeira edição, ou ID numérico inteiro positivo seguro para abrir uma edição real fornecida pelo chamador. Entrada explícita `0`, negativa ou inválida é recusada. Somente `null` é convertido em `editionId = 0` interno da outbox, exclusivamente com `kind = 'test'`; não é ID de edição publicada. Não há rota pública nova, exceção de CSRF nem mudança de cookie/proxy. A proteção de origem do Next e a do proxy continuam aplicadas às mesmas requisições POST.

## Configuração do servidor

Defina um contato real em `ORBIT_PUSH_SUBJECT`, por exemplo `mailto:seu-contato@example.com` ou `https://seu-dominio.example/contato`. O exemplo não deve ser usado como contato de produção. HTTP, localhost, IP literal, credenciais e caracteres de controle não são aceitos. A URL de contato não é acessada pelo Orbit.

No Docker, configure a variável no ambiente do contêiner e reinicie os processos. Não a coloque apenas em `/config/orbit.env`: esse arquivo é relido exclusivamente para `AI_*`. Fora do Docker, forneça a variável no ambiente de inicialização (ou no `.env` carregado pelo supervisor). Ela precisa chegar tanto ao Next quanto ao worker. Não precisa de chave de um serviço pago, Firebase SDK, conta de provedor nem nova porta de entrada.

As chaves VAPID são geradas uma vez pelo `web-push` e persistidas como `settings["push_vapid"]`, contendo chave pública e privada. A criação é transacional. Só a pública sai nas ações. Se o contato estiver ausente/inválido, a configuração mostra a pendência e o worker não envia. Chaves danificadas, ou ausentes enquanto ainda há inscrições, não são substituídas silenciosamente: restaure o banco/backup original. Preserve SQLite e backups como segredos; apagar as chaves exige reconectar os aparelhos.

O servidor precisa de DNS e saída HTTPS/443 para o provedor do navegador. Browser/dispositivo precisa ter conexão com esse provedor. O aviso não é um polling da página nem depende da extensão de coleta.

## Consentimento e uso por aparelho

1. Abra o Orbit por HTTPS (localhost serve para desenvolvimento), entre e vá ao painel de notificações.
2. Clique **Ativar neste aparelho**. Só esse clique pede permissão e faz `PushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`. Montar/renderizar o painel não solicita permissão nem inscreve automaticamente.
3. Clique **Testar notificação**, mesmo antes da primeira edição. O worker envia o teste; é possível fechar as janelas do Orbit enquanto ele está na fila. Sem edição, o clique no aviso abre `/briefings`; com edição, abre `/briefings/<id>`. Não é necessário esperar o horário de geração nem fazer uma chamada de IA para testar o setup.
4. **Desativar neste aparelho** remove a inscrição no servidor e cancela sua fila ainda não enviada; depois remove a inscrição no navegador. Se a remoção local falhar, o painel informa que o servidor já foi desativado e orienta corrigir a permissão do site. Um envio já em trânsito não pode ser recolhido.

No iPhone/iPad, Web Push exige iOS/iPadOS 16.4 ou posterior, instalação na Tela de Início e abertura pelo ícone instalado. Em outros sistemas, app/site pode estar fechado, mas a infraestrutura de push do navegador/sistema precisa continuar permitida. Encerrar o navegador à força, economia de bateria, restrições de notificações, indisponibilidade do provedor ou modo foco podem impedir/adiar a entrega. Não prometemos entrega garantida ou imediata. Servidor e worker precisam permanecer ligados.

O limite é dez inscrições. Inscrição local existente que não está mais no servidor pode ser reativada pelo clique. Permissão negada não é repedida automaticamente; mude-a no navegador e recarregue a página. Ao desativar, a permissão do site pode continuar concedida: isso não significa que o Orbit continue inscrito. Logout/expiração da sessão não revoga o opt-in de push; o aviso permanece genérico e o clique exige login se necessário.

## Privacidade, rede e limites

- Payload de edição contém apenas `{ url: "/briefings/<id>", test: false }`; o teste usa `test: true` e, se não houver edição, a URL fixa `/briefings`. Não inclui manchete, resumo, fatos, temas, autores ou tokens de sessão. Conteúdo é criptografado com `aes128gcm` pela biblioteca. Título exibido é `Orbit`; corpo é uma frase fixa de edição disponível ou de teste. Os provedores ainda observam endpoint, IP, momento e tamanho do tráfego; Web Push não é inteiramente local.
- O SW valida o destino tanto ao receber quanto ao clicar. Edições continuam restritas ao caminho numérico canônico `/briefings/<id>`, com inteiro positivo seguro. O arquivo `/briefings` é aceito **somente** com `test === true`; a flag booleana é persistida em `notification.data` e revalidada no clique. Nenhum dos fluxos aceita URL absoluta, query, fragmento, zero, número inseguro ou destino arbitrário. Ambos os caminhos pertencem à própria origem. O SW foca uma janela já no destino ou abre uma nova; funciona sem janela do Orbit aberta. A página de destino permanece protegida pelo login.
- Endpoints aceitos: `https://fcm.googleapis.com/fcm/send/<token>`, `https://fcm.googleapis.com/wp/<token>`, `https://updates.push.services.mozilla.com/wpush/v2/<token>` e `https://web.push.apple.com/<token>`. Ambos os formatos FCM usam o mesmo hostname estrito. Não há wildcard, subdomínio arbitrário, URL com credenciais/porta especial/query/fragmento ou redirecionamento. Provedores legados e WNS não estão incluídos: ampliar a lista exige validar e testar o novo formato, não permitir hosts arbitrários.
- Antes do socket, DNS é resolvido e todos os IPs precisam ser públicos. O IP validado é pinado no HTTPS com Host/SNI e validação TLS do provedor original, sem segunda consulta DNS, proxy herdado ou redirecionamento. `web-push.generateRequestDetails` fornece criptografia e VAPID; o transporte usa `node:https` sem autenticação do agente.
- Endpoint limitado a 2 KiB; JSON de inscrição a 4 KiB; `p256dh` canônico de 65 bytes na curva P-256; `auth` canônico de 16 bytes. Não aceitamos campos extras ou inscrição com expiração conhecida já vencida. Payload plaintext limitado a 512 bytes e corpo criptografado a 4 KiB. Resposta do provedor não é lida/guardada: só o status; endpoint/chaves/corpo de erro nunca entram em logs ou mensagens.
- TTL e idade máxima da fila: uma hora. Envio usa o TTL restante, nunca mais de 3.600 segundos; o tempo total de DNS/HTTPS é limitado a dez segundos por tentativa. Jobs vencidos não viram avisos antigos. Testes: um por minuto e cinco por hora, somando todos os aparelhos; timestamps persistidos em `settings["push_test_times"]`, inclusive após remover/reinscrever o aparelho.
- O SW continua cacheando **somente** `/offline.html`. Não faz cache de edições, dados pessoais, sessão, payload, POST ou Server Actions; não reenvia ações offline.

## Entrega at-most-once

`push_deliveries` tem unicidade parcial `(subscriptionId, editionId)` para `kind = 'edition'`. Testes são registros separados, limitados por taxa. O ID da inscrição é SHA-256 do endpoint, estável após remover/reinscrever o mesmo endpoint. Não há FK de inscrição/edição na outbox, para evitar dependência circular e preservar os marcadores de deduplicação após remover uma inscrição.

O worker marca `attempted` **e confirma a transação antes de DNS/rede**. Verifica lease/signal dentro das transações, antes de enviar e novamente após DNS. Ao concluir, valida lease/signal dentro da transação final. HTTP 2xx vira `sent` (aceito pelo provedor, não prova que o aparelho mostrou); erros/3xx/429/5xx viram `failed`. HTTP 404/410 remove endpoint/chaves e cancela filas pendentes da inscrição correspondente. Uma inscrição renovada enquanto a resposta estava em trânsito não é removida por uma resposta antiga com chaves diferentes.

**Não há retry**, mesmo para 429, timeout, erro de rede, DNS ou interrupção entre claim/envio/resposta. Uma queda pode deixar `attempted` para sempre, e pode haver perda de aviso até antes do socket. Isso é intencional: não é possível garantir exatamente uma entrega ao usuário sem suporte de deduplicação do provedor. Nenhum resultado ambíguo é reenviado após reiniciar. Deduplicação é de tentativas do Orbit; um provedor ou sistema operacional ainda pode duplicar sua própria entrega. Não apague a outbox ou rearme estados antigos em recuperação automática. Os marcadores retêm somente hash de inscrição, ID de edição, tipo, status e tempos, não endpoint/chaves/conteúdo.

## Verificação e teste físico pendente

Teste isolado, sem push/API reais:

```sh
npm test -- tests/push.test.ts tests/session-guard.test.ts tests/proxy.test.ts
npx tsc --noEmit --incremental false
```

`tests/push.test.ts` usa SQLite isolado e um fixture `CREATE TABLE IF NOT EXISTS` equivalente ao schema quando a migração ainda não foi integrada. DNS/HTTPS são mocks; a criptografia usa chaves sintéticas geradas no teste. O SW roda em sandbox com APIs de notificação/janelas mockadas, incluindo ausência de janela, destinos maliciosos e cache offline estático. Não valida serviço do SO ou entrega por provedor real.

Após integrar migração, UI e worker, testar manualmente em navegador/aparelho real:

- Ausência de `ORBIT_PUSH_SUBJECT` aparece no painel e não envia. Configurar contato real e reiniciar, sem expor chaves/endpoints em capturas ou logs.
- Antes da primeira edição, carregar o painel não abre prompt. Ativar no clique, confirmar permissão e testar sem aguardar o horário agendado; fechar o Orbit antes do worker escoar a fila. O clique deve abrir o arquivo `/briefings` mesmo vazio, passando pelo login se a sessão expirou. Com uma edição pronta, repetir após o intervalo de taxa e confirmar que o teste abre `/briefings/<id>`.
- Publicar uma edição pronta uma vez; confirmar um aviso por aparelho. Reiniciar worker e repetir o fechamento da mesma edição não deve gerar nova tentativa. Encerrar o worker depois do claim pode perder o aviso, nunca deve reenviá-lo.
- Desativar, gerar outra edição e confirmar ausência de novo envio. Revogar permissão/expirar uma inscrição e confirmar sua remoção ao receber 404/410. Confirmar limites de teste e permissão negada sem loops de prompt.
- Verificar no DevTools que Cache Storage contém somente `/offline.html`; nenhuma edição funciona como cache pessoal offline.

Não foram feitos deploy, publicação, teste em NAS/celular nem envio a provedores reais nesta implementação.
