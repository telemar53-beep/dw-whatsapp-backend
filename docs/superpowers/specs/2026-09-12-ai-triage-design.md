# Triagem com IA — Design

Data: 2026-09-12. Companheiro de `2026-09-11-openai-integration-design.md`
(Fase 1, modo Assistente) e de `2026-09-12-audio-transcription-design.md`.

## Contexto e objetivo

A IA passa a atender a **primeira fase** da conversa — antes de qualquer
atendente — como recepcionista: entende a mensagem (texto ou áudio já
transcrito), identifica o cliente quando possível, faz só as perguntas
indispensáveis, define **setor e motivo**, escreve um resumo e entrega a
conversa na fila. A partir daí o atendimento é humano; o modo Assistente
continua funcionando como hoje depois que o atendente assume.

Duas coisas a triagem **resolve sozinha**, quando a identidade é forte (ver
"Identificação"): segunda via de boleto (PDF) e PIX copia-e-cola. Ainda assim a
conversa vai para a fila, marcada "resolvido pela IA", para o atendente
finalizar em um clique.

Pedido original do usuário (37 seções) resumido nas regras deste documento;
o roteiro dele de etapas 3–7 é o escopo desta spec. Etapas 8 (Base
Comercial), 9 (imagens) e 10 (relatório) ficam para specs próprias.

## O que existe hoje e é reaproveitado

| Peça | Onde | Como entra |
|---|---|---|
| Estado de triagem `triage_state` (`pending`/`completed`) e `triage_attempts` | `conversations` | Mesmo estado: `pending` esconde a conversa dos atendentes (`listWaitingForAgentConversations`); `completeTriage(conversa, setorId)` grava setor e conclui. `triage_attempts` vira contador de perguntas. |
| Menu numérico | `src/triage/triage.service.js` | Continua para canal sem IA. `shouldStartTriage` já devolve `false` em canal com IA. |
| Fila única com setor como rótulo | `listWaitingConversations` + `sector_id` | Decisão do usuário: **mantém**. A IA define o rótulo; o atendente do setor puxa. |
| Vínculo com o SGP por contato | `contacts.sgp_client_id/contract_id/document` | É a "memória": identificado uma vez, todas as conversas seguintes sabem quem é. |
| Turno de IA | `src/ai/ai-orchestrator.js` `runAiTurn` | Ganha um **perfil** (`triagem` vs `assistente`). Mesmo laço, cache, auditoria em `ai_interactions`, `whatsapp-format`. |
| Fila Bull `ai-replies` + "mensagem mais nova ganha" | `src/queue/ai-queue.js`, `ai-worker.js` | Mesma fila; o worker escolhe o perfil pelo estado da conversa. |
| Transcrição de áudio | `transcription-worker` | Já enfileira turno de IA com o texto — a triagem recebe áudio de graça. |
| Motivos | `contact_reasons` + `conversations.suggested_reason_id` | A IA escolhe entre os ativos; o modal de encerramento já pré-seleciona `suggested_reason_id`. |
| Ferramentas | `src/ai/tool-registry.js` + `tool-executor.js` | `buscar_cliente`, `consultar_status_*`, `consultar_faturas_todos_contratos`, `gerar_pix`, `gerar_segunda_via` reaproveitadas com o mesmo executor (validação, dono, timeout). |
| Envio de PDF de boleto | `src/api/sgp-query.routes.js` `boleto-pdf` | `downloadBoletoPdf` + `saveMediaFile` + `enqueueOutboundMessage({messageType:'document'})` viram a ferramenta `enviar_boleto`. |
| Mensagens da IA | `messages.sent_by = 'ai'` | Já existe; o balão ganha um marcador "IA". |
| Finalizar direto da fila | `queue quick close` | É como o atendente encerra o "resolvido pela IA" em um clique. |

**Não existe e não é criado:** fila por setor; `tenant_id` (sistema é
single-tenant por decisão); enum novo de estado — `waiting+pending` =
TRIAGEM_IA, `waiting+completed` = AGUARDANDO_ATENDENTE, `assigned` =
ATENDIMENTO_HUMANO já são distintos no banco.

## Achados por sonda (somente leitura, 2026-09-12)

- `POST /api/ura/clientes/` **existe** na instalação da DW e aceita
  `telefone`. Casa no formato do SGP e em só-dígitos com DDD (10/11 dígitos);
  **não** casa com o `55` na frente. Buscando um telefone zerado voltam 3
  cadastros — logo a regra é **exatamente um resultado**.
- A resposta traz `contratoCentralSenha`, `contratoCentralLogin` e
  `dataNascimento`. O cliente SGP extrai **só** `cpfcnpj` (e o id) e reaproveita
  `lookupClientByCpf`; `dataNascimento` é usado como fator de confirmação.
- Mesma fonte de verdade da API: coleção Postman oficial
  (`documenter.gw.postman.com/api/collections/6682240/2sB34hHg2V`).

## Decisões tomadas no brainstorm

1. **Abordagem A**: triagem como perfil do turno de IA existente (o modelo
   decide perguntar ou concluir), com travas de código: limite de perguntas e
   limiar de confiança configuráveis.
2. **Identificação antes do modelo, não pelo modelo**: o worker resolve quem é
   (memória → telefone → nada) e entrega ao contexto. O modelo só chama
   `buscar_cliente` (CPF) quando isso falhou ou o cliente contestou o nome.
3. **Sempre chamar pelo primeiro nome** quando identificado sem CPF — é a
   confirmação leve do usuário ("a pessoa vai ver que o nome não é dela"). Só o
   primeiro nome: se o telefone estiver com a pessoa errada, ela não vê o nome
   completo de um terceiro. Nome contestado → esquece o vínculo, pede CPF.
4. **Níveis de identificação**, calculados em código:
   - `forte`: telefone bateu no SGP (1 resultado) e o nome não foi contestado;
     ou memória (`contacts.sgp_*`) para o mesmo número; ou CPF digitado **e**
     data de nascimento confirmada.
   - `fraca`: CPF digitado por número desconhecido, sem confirmação.
   - `none`: não identificado.
5. **A triagem não revela dados da conta** (status, fatura, valor, plano,
   endereço) — eles vão só para o resumo. Exceção controlada: as ferramentas de
   entrega (boleto, PIX), que **recusam em código** quando a identidade não é
   forte. Assim, quem digita um CPF alheio recebe "vou te encaminhar" — nunca
   dados. Isso resolve o item 2 das pendências da Fase 1 no escopo da triagem.
6. **Fila única com rótulo** (usuário). Correção do atendente = trocar
   `sector_id`; `ai_triage_sector_id` fica intacto para medir acerto.
7. **Depois de entregar boleto/PIX, a conversa ainda vai para a fila**,
   marcada "resolvido pela IA". Fechar sem humano é o modo automático
   (fora deste escopo).
8. **Sai inerte**: `channels.ai_triage_enabled` nasce `false`.

## Modelo de dados

Migração aditiva, uma só:

```sql
ALTER TABLE channels ADD COLUMN IF NOT EXISTS ai_triage_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE sectors ADD COLUMN IF NOT EXISTS ai_hint TEXT NOT NULL DEFAULT '';

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_triage_sector_id     UUID REFERENCES sectors(id),
  ADD COLUMN IF NOT EXISTS ai_triage_reason_id     UUID REFERENCES contact_reasons(id),
  ADD COLUMN IF NOT EXISTS ai_triage_confidence    NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS ai_triage_summary       TEXT,
  ADD COLUMN IF NOT EXISTS ai_triage_identified_by TEXT
    CHECK (ai_triage_identified_by IS NULL OR ai_triage_identified_by IN ('memory','phone','cpf','cpf_confirmed','none')),
  ADD COLUMN IF NOT EXISTS ai_triage_low_confidence BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_triage_resolved_by_ai BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_triage_completed_at  TIMESTAMPTZ;

ALTER TABLE ai_config
  ADD COLUMN IF NOT EXISTS triage_confidence_threshold NUMERIC(4,3) NOT NULL DEFAULT 0.800,
  ADD COLUMN IF NOT EXISTS triage_max_questions        INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS triage_timeout_minutes      INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS triage_extra_instructions   TEXT NOT NULL DEFAULT '';
```

`contacts` não muda: o vínculo (`sgp_*`) continua sendo gravado por
`setContactSgpLink`, agora também quando a identificação por telefone tem
1 resultado (assim a memória passa a valer na conversa seguinte).

### A armadilha das colunas enumeradas

`conversation.repository.js` enumera colunas em ~22 consultas e
`toConversation`/`toConversationSummary` mapeiam por nome. As oito colunas
novas de `conversations` precisam entrar em **cada consulta que alimenta os
cartões da fila e a conversa aberta** — no mínimo `listWaitingConversations`,
`listWaitingForAgentConversations`, `getConversationWithContact`,
`claimConversation`, `completeTriage`, `setConversationSector` e o `RETURNING`
de qualquer UPDATE que devolva a conversa. O plano deve contar com `grep` e
ter um teste que grava por `concluirTriagem` e relê por **cada** listagem.
`channels` e `sectors` seguem o mesmo padrão (11 e 3 consultas).

## Backend

### `src/ai/identity-resolver.js` (novo, puro + uma chamada SGP)

```js
async function resolverIdentidade({ contact, phoneNumber, sgpClient })
// → { nivel: 'forte'|'none', origem: 'memory'|'phone'|'none',
//     primeiroNome, contracts, sgpDocument, sgpClientId }
```

Ordem: (1) `contact.sgpDocument` preenchido → `lookupClientByCpf` → `memory`;
(2) telefone: tira `55`, tenta 11 dígitos; se 0 resultados e o número tem 9º
dígito, tenta sem ele; **exatamente 1** cliente → `lookupClientByCpf(cpf)` →
`phone`, e grava `setContactSgpLink`; (3) senão `none`. Erros do SGP viram
`none` com log saneado — a triagem continua sem identificação.

`primeiroNome`: primeiro token de `client.name`, capitalizado. Nunca o nome
completo no contexto do cliente.

### `sgp-client.js` — `findClientByPhone(digits)`

`POST /api/ura/clientes/` com `telefone`, `omitir_titulos=1`,
`omitir_contatos=1`, `limit=2`. Devolve `{ total, cliente: { id, cpfcnpj,
dataNascimento } | null }` — **allowlist**: nada de `contratos`, `endereco`,
`contratoCentralSenha`. Teste com resposta envenenada. `dataNascimento`
fica no servidor (contexto interno), nunca vai ao modelo nem ao cliente:
o modelo pede a data e chama `confirmar_nascimento(data)`; a comparação é
em código.

### Perfil de triagem no orquestrador

`runAiTurn({ conversation, contact, perfil: 'triagem', identidade })`.

**Contexto do sistema (montado em código):**
- `systemPrompt` da config + `triage_extra_instructions`.
- Papel: recepcionista; objetivo: entender → identificar (se preciso) →
  classificar → coletar o mínimo → resumir → encaminhar. Uma pergunta por vez.
  A mensagem mais recente manda quando o assunto muda.
- **Setores** com id, nome e `ai_hint` (regras de "o que vai para cá" e "o que
  coletar", escritas pelo admin). **Motivos** ativos com id.
- **Identidade**: `forte`: "Cliente identificado (telefone/memória):
  primeiro nome João; contratos: endereço — plano — status. Cumprimente pelo
  primeiro nome na primeira resposta. Se ele disser que não é ele, chame
  `esquecer_identificacao` e peça o CPF." `none`: "Não identificado. Peça CPF só
  se o setor exigir (Financeiro, Suporte, Reativação). Comercial de cliente
  novo nunca exige." `fraca`: "Identificado por CPF sem confirmação. Para
  entregar boleto/PIX, peça a data de nascimento e chame
  `confirmar_nascimento`."
- **Nunca dizer ao cliente**: status do contrato, fatura, valor, plano,
  endereço; "pagamento confirmado"; prazos ou "técnico vai aí"; preço ou
  cobertura (é "vou encaminhar ao Comercial").
- Vários contratos: perguntar qual ponto **só** quando a resposta depende dele
  (Suporte, boleto com fatura aberta em mais de um). Nunca pedir número de
  contrato; identificar por endereço e plano.
- Formatação WhatsApp (já existe).

**Histórico**: como hoje (texto + áudio transcrito). Imagem/documento entram
como `[cliente enviou uma imagem]` / `[cliente enviou um documento]` — sem
leitura do conteúdo — para o modelo poder perguntar "é um comprovante?" e
classificar Financeiro / Comprovante.

**Ferramentas do perfil — lista fixa em código, independente do cartão de
permissões** (que governa só o assistente):

| Ferramenta | Uso na triagem |
|---|---|
| `buscar_cliente` (existe) | CPF quando `none`, ou após `esquecer_identificacao`. Resultado eleva para `fraca`. |
| `confirmar_nascimento(data)` (nova) | Compara com `dataNascimento` do servidor (aceita `DD/MM/AAAA` e variações). Acerto → `forte`; erro → segue `fraca`, uma tentativa só. |
| `esquecer_identificacao()` (nova) | Nome contestado: zera identidade do turno e o vínculo do contato (`setContactSgpLink(null)`). |
| `consultar_status_contrato`, `consultar_status_conexao`, `consultar_faturas_todos_contratos` (existem) | Só para o resumo. |
| `gerar_pix`, `gerar_segunda_via` (existem) + `enviar_boleto(contratoId)` (nova: PDF via `downloadBoletoPdf` + `enqueueOutboundMessage`) | **Recusam em código se `identidade !== 'forte'`** (`contexto.identidade.nivel`, checado no executor por marcação `exigeIdentidadeForte: true`). Marcam `ai_triage_resolved_by_ai`. |
| `concluir_triagem(setorId, motivoId, resumo, confianca)` (nova) | Ver abaixo. |

Sem ferramentas de ação além das de entrega: nada de desbloqueio, transferir,
motivo isolado.

**Como o executor libera a lista fixa.** Hoje `executeTool` recusa
`tool_disabled` consultando `ai_tool_permissions`. No perfil de triagem o
orquestrador passa `contexto.ferramentasPermitidas` (a lista fixa acima) e o
executor usa essa lista **em vez** da tabela quando ela está presente; sem ela,
comportamento de hoje. Teste: ferramenta fora da lista fixa é recusada mesmo
que esteja ligada no cartão, e vice-versa.

### `concluir_triagem`

Validação: `setorId` existe; `motivoId` ativo ou `null`; `confianca` número
0–1; `resumo` não vazio. Regra:
- `confianca < threshold` **e** `triage_attempts < max` → recusa com
  `{ ok:false, motivo:'baixa_confianca', instrucao:'Faça UMA pergunta de esclarecimento.' }`.
- Senão conclui: grava `ai_triage_*` (inclusive `low_confidence` quando abaixo
  do limiar), `completeTriage(conversa, setorId)` (setor final = o da IA),
  `setSuggestedReason(motivoId)`, `broadcast('queue:new', …)` e
  `broadcastToDashboard`. Devolve `{ concluido:true, setor:'Financeiro' }` e
  instrui o modelo a responder **uma frase** (nome, setor, "um atendente
  continua daqui").

O resumo gravado é o do modelo, prefixado pelo código com o que ele sabe:
setor, motivo, cliente (primeiro nome + id SGP), contrato(s), identificação
(`phone`/`memory`/`cpf`/`cpf_confirmed`/`none`), origem da mensagem
(texto/áudio), ferramentas consultadas, "resolvido pela IA: boleto enviado"
quando for o caso.

### Worker (`ai-worker.js`) — portão de perfil

```
conversa fechada/silenciosa → sai
triage_state === 'pending' && status === 'waiting' && !assigned_agent_id
  && canal.ai_triage_enabled → PERFIL TRIAGEM
assigned → perfil assistente (regras de hoje)
senão → sai
```

No perfil de triagem, **antes de enviar** a resposta, o worker relê a conversa:
se um atendente assumiu ou a triagem já foi concluída durante o turno, descarta
sem enviar (nunca IA e humano falando). Resposta do modelo →
`enqueueOutboundMessage({ content, sentBy:'ai' })`. Turno que termina sem
`concluir_triagem` incrementa `triage_attempts` (`incrementTriageAttempts`
existe). Quando `triage_attempts >= max` e o modelo ainda não concluiu, o
worker roda **um** turno final com `tool_choice` forçado em
`concluir_triagem` (`createChatCompletion` ganha o parâmetro opcional
`toolChoice`, repassado como `tool_choice: { type:'function', function:{ name } }`);
se mesmo assim não concluir, o código conclui com setor `null` e resumo
"triagem inconclusiva" — igual ao menu numérico hoje.

A identidade é resolvida **uma vez por turno** (`resolverIdentidade`) e vai em
`contexto.identidade`; `buscar_cliente`/`confirmar_nascimento`/`esquecer_identificacao`
a atualizam dentro do turno.

### Gancho na ingestão (`inbound-message.service.js`)

Onde hoje está `sendTriageQuestion` (conversa nova) e `processTriageReply`
(resposta ao menu): se `canal.ai_enabled && canal.ai_triage_enabled` →
`createConversation(..., triageState:'pending')` e `enqueueAiReply` em vez do
menu; mensagem seguinte com `pending` → `enqueueAiReply` em vez de
`processTriageReply`. Sem a flag, comportamento idêntico ao de hoje. O aviso de
horário comercial continua saindo como hoje, antes da triagem.

`scheduleAiReply` (assistente) passa a aceitar áudio transcrito e **imagem/
documento** somente no perfil de triagem (placeholder). Texto continua igual.

### Rotas

- `PUT /api/admin/ai/triage` — `{ triageConfidenceThreshold, triageMaxQuestions, triageExtraInstructions }`, admin, validação estrita como a de transcrição.
- `PUT /api/admin/channels/:id/ai-triage` — `{ enabled }`, admin; 400 se o canal não tem `ai_enabled`.
- `PUT /api/admin/sectors/:id` passa a aceitar `aiHint`.
- `PUT /api/conversations/:id/sector` — `{ sectorId }`, atendente da conversa ou admin; grava `sector_id`, não toca `ai_triage_sector_id`; emite `queue:updated`/`conversation:updated`.
- `GET` das conversas/fila devolvem os campos `aiTriage*` (serializadores das rotas incluídos — sexto lugar da armadilha).

## Frontend

- **Canais**: toggle "Triagem com IA", habilitável só com "Usar IA".
- **Integrações**: cartão "Triagem com IA" (limiar em %, máximo de perguntas, instruções adicionais).
- **Setores**: campo "Orientação para a IA" (textarea) por setor.
- **Fila**: linha "Triagem IA · {motivo}" no cartão; selo "confiança baixa" quando `aiTriageLowConfidence`; selo "resolvido pela IA" quando `aiTriageResolvedByAi`.
- **Conversa**: balão outbound com `sentBy === 'ai'` ganha marcador "IA".
- **Painel lateral**: bloco "Triagem por IA" (setor, motivo, identificação, confiança, resumo) e seletor de setor (a correção).

## Segurança e privacidade

| Exigência | Como |
|---|---|
| Nunca dado da conta ao cliente sem identidade forte | Regra no contexto **e** recusa em código nas ferramentas de entrega (`exigeIdentidadeForte`). |
| CPF alheio não rende nada | `fraca` só permite classificar; entrega exige nascimento correto (1 tentativa). |
| Nome completo de terceiro | Só o primeiro nome vai ao contexto do cliente. |
| Segredos do SGP | `findClientByPhone` allowlist; `dataNascimento` fica no servidor, comparado em código, nunca no prompt nem em log. |
| Argumentos do modelo | Mesmo executor: validação, dono do contrato, timeout. Ferramentas novas declaram `chaveProprietario` ou isenção justificada. |
| IA e humano ao mesmo tempo | Releitura da conversa antes de enviar; perfil de triagem exige `!assigned_agent_id`. |
| Logs | `ai_interactions` com `mode='triage'`; CPF mascarado (já existe); telefone só nos últimos 4 dígitos. |
| Tenant | Não existe; nada a fazer. |

## Tratamento de erro

| Situação | Comportamento |
|---|---|
| SGP fora na identificação | `none`; triagem segue e pede CPF se o setor exigir; resumo anota "SGP indisponível". |
| OpenAI fora | Turno falha, `ai_interactions.error`; conversa fica `pending` **por no máximo N minutos** (`ai_config.triage_timeout_minutes`, padrão 3): ao abrir a triagem o gancho enfileira um job atrasado `ai-triage-timeout` (mesma fila Bull, `delay = N min`, sem jobId fixo) que, ao rodar, conclui com setor `null` e resumo "IA indisponível" **se** a conversa ainda estiver `pending`; se já concluiu, não faz nada. O cliente nunca fica invisível na fila. |
| Modelo não conclui após o limite | Turno final com `tool_choice` forçado; senão conclusão em código com setor `null`. |
| Atendente assume no meio | Turno descartado; mensagem não enviada. |
| Entrega de boleto falha (SGP/PDF) | Ferramenta devolve erro; a IA diz que o Financeiro envia; triagem conclui sem `resolved_by_ai`. |

## Testes

- `identity-resolver`: memória → telefone → nada; tira o 55; 9º dígito; exatamente 1; erro SGP → `none`; grava o vínculo no acerto por telefone.
- `findClientByPhone`: parâmetros; allowlist com resposta envenenada (`contratoCentralSenha`, `dataNascimento` não saem para fora do resolvedor).
- `confirmar_nascimento`: formatos aceitos; uma tentativa; eleva nível.
- `concluir_triagem`: validação; recusa por confiança com pergunta sobrando; aceita e marca baixa confiança sem pergunta; grava colunas; `completeTriage`; motivo sugerido; `queue:new`.
- Ferramentas de entrega recusam com identidade `fraca`/`none` (executor).
- Perfil no orquestrador: só as ferramentas fixas; faturas fora do contexto; primeiro nome; placeholder de imagem; `tool_choice` forçado no turno final.
- Worker: os quatro caminhos do portão; descarte quando assumido no meio; incremento de perguntas; conclusão em código no limite.
- Repositório: teste que grava por `concluirTriagem` e relê por **cada** listagem da fila e por `getConversationWithContact`.
- Rotas e cartões: padrão da casa.
- **Manuais**: os 8 casos do briefing (item 29), mudança de assunto, nome contestado, confiança baixa → uma pergunta, atendente assume no meio, boleto pedido por cliente identificado pelo telefone (recebe PDF), CPF digitado → nascimento → PIX, nascimento errado → só encaminha.

## Ordem de entrega (um plano)

1. Migração + repositórios (`conversations`, `channels`, `sectors`, `ai_config`) — com a varredura das consultas.
2. `findClientByPhone` + `identity-resolver`.
3. Ferramentas novas (`concluir_triagem`, `confirmar_nascimento`, `esquecer_identificacao`, `enviar_boleto`) + marcação `exigeIdentidadeForte` no executor.
4. Perfil de triagem no orquestrador.
5. Portão do worker + gancho na ingestão + job de segurança (task delicada: caminho quente).
6. Rotas admin/atendente + cartões (canal, integrações, setores).
7. Fila, balão "IA", painel lateral, seletor de setor.
8. Verificação manual.

## Fora de escopo (specs próprias)

- Base Comercial (planos, promoções, cobertura, documentos, FAQ) e a ferramenta `consultar_viabilidade`.
- Leitura de imagem/comprovante (visão).
- Tela de relatório da triagem — os dados (`ai_triage_*` vs `sector_id`, `identified_by`, `low_confidence`, `resolved_by_ai`, `ai_interactions`) já ficam gravados.
- Modo automático noturno (fechar sem humano, abrir chamado, desbloqueio na triagem).
- Fila por setor de verdade.
