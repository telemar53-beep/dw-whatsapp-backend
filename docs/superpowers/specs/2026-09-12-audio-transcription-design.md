# Transcrição de áudio para a IA — Design

> Estende `docs/superpowers/specs/2026-09-11-openai-integration-design.md`.
> Camada adicional: transforma áudio do cliente em texto e **reaproveita o fluxo
> de IA que já existe**. Nenhuma segunda lógica de atendimento é criada.

## Contexto e objetivo

Hoje a IA ignora áudio de propósito — `ai.service.js:16` barra qualquer mensagem
que não seja texto, para que ela nunca adivinhe conteúdo. O resultado é que um
cliente que manda áudio não recebe nada da IA, e o atendente precisa ouvir para
saber do que se trata.

O objetivo é inserir uma etapa de transcrição antes do fluxo normal:

```
WhatsApp → Baileys → ingestão → fila de transcrição → OpenAI (modelo de transcrição)
                                         ↓
                          transcrição gravada na mensagem + tela
                                         ↓
                        (se autorizado) fila de IA → modelo de chat → tools → SGP
                                         ↓
                                  sugestão ao atendente
```

O modelo de chat **não muda**. A transcrição usa um modelo próprio, configurável.

## Mapa do fluxo de áudio atual

Levantado lendo o código em 2026-09-12. É a base das decisões abaixo.

### Onde o áudio chega

`src/whatsapp-adapters/baileys.manager.js:96-98` — `extractMediaInfo` reconhece
`audioMessage` e devolve `{ type: 'audio', mimeType, caption: null, filename: null }`.

Áudio comum e nota de voz (`ptt`) caem no **mesmo ramo**: o WhatsApp entrega os
dois como `audioMessage`, distinguidos por um campo `ptt` que o código não lê e
que não importa para transcrição. Envelopes (efêmera, ver-uma-vez) já vêm
desembrulhados por `unwrapMessage` antes.

`audioMessage.seconds` traz a duração e está disponível no mesmo objeto, embora
hoje não seja lido.

### Como o arquivo é salvo

`baileys.manager.js:302-306`:

```js
const buffer = await downloadMediaMessage(msg, 'buffer', {});
const mediaPath = await saveMediaFile(buffer, extensionForMimeType(mediaInfo.mimeType));
```

**O arquivo não é temporário.** `saveMediaFile` (`src/media/media-storage.js`)
grava permanentemente em `MEDIA_STORAGE_DIR` com nome UUID, e é dele que o player
do atendente toca. `getMediaFilePath` já resolve o caminho com proteção contra
path traversal.

Consequência de projeto: **não há arquivo temporário para criar nem para apagar.**
A transcrição lê o arquivo já persistido. Criar uma cópia temporária duplicaria
trabalho e arriscaria apagar o áudio do atendente.

### Como a mensagem é persistida

`ingestInboundMessage` → `createMessage`. A tabela `messages` já tem `media_path`,
`media_mime_type`, `media_filename`, `message_type = 'audio'`. **Não há coluna de
duração.**

### Onde a IA decide processar

Um único ponto:

```js
// src/ai/ai.service.js:16
if (!message || message.messageType !== 'text' || !message.content) return;
```

Tudo depois — fila, worker, orquestrador, ferramentas — é **agnóstico ao tipo** e
trabalha com o campo de texto. Mas há dois outros filtros de texto que precisam
mudar junto (ver "Os dois pontos de integração").

### Ferramentas disponíveis no projeto

- `ffmpeg-static` já é dependência.
- `form-data` já é dependência (necessária para upload multipart).
- `src/media/audio-normalizer.js` existe, mas converte **para** OGG/Opus no
  caminho de **saída** (áudio gravado pelo atendente). Não serve para entrada.

## Correções ao briefing original

Quatro pontos do pedido não batem com o sistema e foram ajustados:

1. **Multi-tenant não existe.** As exigências de isolar tenants e "não processar
   áudio de outra empresa" não se aplicam: o sistema é single-tenant, sem
   `tenant_id` em nenhuma migration. O isolamento real é por canal e por
   atendente designado.
2. **`consultar_ip` não existe.** Foi listada como ferramenta atual; não foi
   construída porque nenhum endpoint do SGP fornece IP — apurado por sondagem
   contra a API real.
3. **Não há arquivo temporário.** As exigências de diretório temporário, nome
   único e exclusão após processar já estão atendidas pela infraestrutura de
   mídia existente, que persiste o arquivo de propósito.
4. **Nome do modelo de transcrição não é fixado em código.** O briefing sugere
   `gpt-transcribe`; nenhum nome é assumido. O modelo é configurável e escolhido
   de uma lista obtida da própria conta — mesma disciplina adotada para o modelo
   de chat, depois de um modelo inválido ter custado uma sessão de depuração.

## Decisões tomadas no brainstorm

1. **A transcrição vive na própria mensagem de áudio**, em colunas novas. A
   mensagem original permanece intacta e a tela distingue o que o cliente falou
   do que a máquina ouviu.
2. **Só transcreve em canais com IA ligada.** Transcrição nasce como parte da IA
   e usa a mesma chave de liga/desliga por canal, para o gasto ser controlado no
   mesmo lugar.
3. **Fila própria, disparada na chegada do áudio** — não dentro do job de IA. No
   modo Assistente a IA só roda em conversa atribuída; se a transcrição
   dependesse dela, um áudio na fila nunca seria transcrito, e o atendente
   pegaria a conversa sem saber do que se trata.
4. **O interruptor "mostrar transcrição para atendente" foi cortado.** Sem caso
   de uso real (o atendente pode ouvir o áudio de qualquer forma) e exigiria uma
   rota nova só para expor a preferência a não-admins.

## Modelo de dados

Migração aditiva, defaults nulos, segura em base viva.

```sql
ALTER TABLE messages
  ADD COLUMN transcription          TEXT,
  ADD COLUMN transcription_status   TEXT,
  ADD COLUMN transcription_detail   TEXT,
  ADD COLUMN transcription_model    TEXT,
  ADD COLUMN transcription_ms       INTEGER,
  ADD COLUMN audio_duration_seconds INTEGER;

ALTER TABLE messages ADD CONSTRAINT messages_transcription_status_check
  CHECK (transcription_status IS NULL OR transcription_status IN
    ('pending', 'processing', 'completed', 'failed', 'skipped'));

ALTER TABLE ai_config
  ADD COLUMN transcription_enabled     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN transcription_model       TEXT    NOT NULL DEFAULT '',
  ADD COLUMN transcription_max_seconds INTEGER NOT NULL DEFAULT 300,
  ADD COLUMN transcription_max_bytes   INTEGER NOT NULL DEFAULT 26214400,
  ADD COLUMN transcription_prompt      TEXT    NOT NULL DEFAULT '',
  ADD COLUMN transcription_feed_ai     BOOLEAN NOT NULL DEFAULT true;
```

`failed` e `skipped` são deliberadamente distintos: áudio longo demais não é
falha, é decisão. No painel viram métricas diferentes — "falhas" (investigar) e
"pulados" (talvez aumentar o limite). Misturar esconde qual é qual.

**Não há tabela de auditoria de transcrição.** Todas as métricas pedidas
(transcritos hoje/mês, falhas, tempo médio, minutos processados, custo) saem
dessas colunas. Uma tabela separada exigiria um join para a tela mostrar o texto
ao lado do player, sem ganho.

**A duração vem de `audioMessage.seconds`**, metadado que já chega com a
mensagem. Quando ausente, o limite de tamanho ainda protege.

### A armadilha das colunas enumeradas

`src/conversations/message.repository.js` **não usa `SELECT *`**. As seis colunas
novas precisam entrar em três lugares:

- a constante `MESSAGE_COLUMNS` (cobre a maioria das consultas de uma vez);
- as **duas** consultas que enumeram colunas inline, ambas com `JOIN` para
  citação de mensagem respondida — `listMessagesByConversation` e
  `listRecentMessagesByConversation`;
- o mapper `toMessage`.

Sem as três, a transcrição chega `undefined` na tela mesmo estando gravada. Esse
defeito apareceu cinco vezes no trabalho anterior desta integração.

## Backend

### `openai-client.js` — função nova

```js
async function transcribeAudio({ apiKey, model, filePath, mimeType, prompt })
// POST /v1/audio/transcriptions, multipart via form-data (já é dependência)
// -> { texto }
```

Devolve **apenas o texto**. A resposta da API pode trazer mais campos conforme o
modelo e o formato pedido; nada além do texto é lido, para o módulo não depender
de um formato que varia entre modelos. A duração continua vindo do metadado do
Baileys, que é confiável e gratuito.

A chave vive só no cabeçalho. A tradução de erro segue `traduzErro`: causa
saneada (`{status, message}`), nunca o erro bruto — o objeto de axios carrega o
corpo da requisição, e essa foi a origem de um vazamento já corrigido.

### `src/ai/transcription.service.js` (novo)

Concentra toda a lógica, sem chamadas de transcrição espalhadas:

```js
async function transcribeMessage(messageId)
```

1. carrega a mensagem e valida que é áudio com `media_path`;
2. valida tamanho do arquivo e duração contra a configuração;
3. marca `processing`;
4. chama `transcribeAudio` com o vocabulário da operação como `prompt`;
5. grava `transcription`, `completed`, modelo e tempo decorrido;
6. emite o evento de socket;
7. devolve o resultado para o worker decidir se enfileira o turno de IA.

Falha grava `failed` com o motivo técnico. Limite excedido grava `skipped` com o
motivo. Em nenhum dos dois casos a IA é acionada.

### `src/queue/transcription-queue.js` + `transcription-worker.js` (novos)

Fila Bull `'audio-transcriptions'`, irmã das três existentes.

**Fila separada da IA de propósito:** transcrição é mais lenta e falha mais que
uma chamada de chat, e o Bull roda com concorrência 1. Compartilhar faria um
áudio longo segurar as respostas de texto de todas as outras conversas.

O worker, após uma transcrição bem-sucedida, enfileira o turno de IA **se**
`transcription_feed_ai` estiver ligado e os portões da IA permitirem.

### Gancho na ingestão

Em `ingestInboundMessage`, ao lado do gancho de IA já existente, no mesmo estilo
try/catch que só loga:

```js
if (message.messageType === 'audio' && await shouldTranscribe(channelId)) {
  await enqueueTranscription({ conversationId, messageId: message.id });
}
```

`shouldTranscribe` exige **três coisas**: canal com `ai_enabled`,
`ai_config.transcription_enabled`, e um `transcription_model` preenchido —
mesma disciplina de `shouldRunAi`, que não roda com integração pela metade.
Faltando qualquer uma, áudio segue o caminho de hoje.

Ao enfileirar, a mensagem é marcada `pending` na mesma operação, para a tela
mostrar *Transcrevendo…* de imediato em vez de ficar sem sinal até o worker
pegar o job.

O job usa `attempts: 1`, `removeOnComplete` e `removeOnFail` — sem repetição
automática, e sem job retido ocupando a fila. Uma transcrição que falhou fica
registrada na mensagem, que é onde o atendente e o painel a procuram.

### Os dois pontos de integração

Ambos são consequência de decisões corretas tomadas antes, e ambos falhariam em
silêncio se só o serviço fosse acrescentado.

**1. `findLatestInboundMessageId` filtra `message_type = 'text'.'** Esse filtro
existe para impedir que uma foto enviada após um texto faça a IA desistir de
responder. Com áudio gerando turno de IA, o id do áudio **nunca casaria** com "a
última mensagem de texto", e todo turno disparado por áudio desistiria antes de
chamar a OpenAI — sem log nenhum.

A regra passa a ser "a última mensagem inbound que a IA consegue usar": texto,
**ou** áudio com `transcription_status = 'completed'`. Foto e documento continuam
de fora, que era a intenção original.

**2. O histórico do orquestrador filtra `messageType === 'text' && content`.**
Numa conversa onde o cliente fala por áudio, o modelo veria uma conversa vazia e
responderia sem contexto — parecendo funcionar. O histórico passa a mapear áudio
transcrito para o texto da transcrição.

Este é o mais traiçoeiro dos dois: não quebra nada visivelmente, só deixa a IA
pior sem ninguém saber por quê.

### Rotas

A configuração de transcrição entra nas rotas admin de IA já existentes
(`/api/admin/ai/config`), estendendo o mesmo `GET`/`PUT` — não uma rota nova. A
validação segue o padrão: tipos conferidos antes de qualquer escrita, erros em
inglês no formato `{ error }`.

## Frontend

### Na conversa

`MessageAttachment.jsx`, no ramo de áudio: **o player fica intocado**. Abaixo
dele, quando houver `transcriptionStatus`:

| Estado | O que aparece |
|---|---|
| `pending` / `processing` | *Transcrevendo…* |
| `completed` | **Transcrição por IA** + o texto |
| `failed` | *Não foi possível transcrever este áudio.* |
| `skipped` | *Áudio longo demais para transcrição automática.* |

O rótulo **Transcrição por IA** é fixo e sempre visível: o atendente nunca deve
confundir o que a máquina ouviu com o que o cliente escreveu.

Um evento de socket novo (`message:transcription`) atualiza o cartão quando a
transcrição conclui, para o texto aparecer sem recarregar a conversa.

### Cartão de configuração

`AudioTranscriptionConfigCard.jsx`, novo, ao lado do cartão da OpenAI em
Integrações — em vez de engordar aquele, que já está grande.

Campos: liga/desliga, modelo (lista obtida da conta pelo botão **Buscar
modelos**, que reusa a rota de teste de conexão), duração máxima em minutos,
tamanho máximo em MB, liga/desliga "Enviar transcrição para a IA", e o campo de
vocabulário da operação.

O vocabulário (`DW Telecom`, `SGP`, `PPPoE`, `ONU`, `ONT`, `OLT`, `boleto`,
`PIX`, `segunda via`, `fibra`, `Mbps`…) vai como contexto à transcrição e é o que
evita "PPPoE" virar "pepo e". Editável sem deploy, como o prompt do sistema.

## Segurança e privacidade

| Exigência | Como é atendida |
|---|---|
| Chave da OpenAI protegida | vive só no cabeçalho HTTP, como no chat |
| Não expor caminhos internos | `getMediaFilePath` já bloqueia path traversal; caminhos nunca vão para a tela nem para o modelo |
| Validar MIME e tamanho | antes de qualquer chamada, no serviço |
| Não registrar áudio bruto | só metadados são logados: duração, bytes, status, tempo |
| Não registrar credenciais | erro saneado para `{status, message}`; nunca o objeto |
| Enviar só o necessário | a requisição leva o arquivo e o vocabulário — nenhum dado de cliente, CPF ou token |

**Nada além do áudio e do vocabulário é enviado à OpenAI na transcrição.** O
contexto do cliente só entra depois, na etapa de chat, já normalizado.

## Tratamento de erro

| Situação | Comportamento |
|---|---|
| Falha da API de transcrição | `failed` + motivo; áudio preservado; IA **não** acionada |
| Áudio acima do limite | `skipped` + motivo; áudio preservado; IA não acionada |
| Arquivo ausente ou corrompido | `failed`; nunca texto inventado |
| Transcrição desligada | nada roda; áudio segue como hoje |
| Timeout | `failed`; o job não é repetido automaticamente |

Princípio herdado da IA: **falha de transcrição nunca degrada o atendimento**. O
áudio continua tocável e a conversa segue disponível para um humano.

## Testes

- **`transcription.service`** — OpenAI mockada: sucesso, falha da API, tamanho
  excedido, duração excedida, arquivo inexistente.
- **`transcribeAudio`** — axios mockado, incluindo teste com `AxiosError`
  realista provando que a chave não aparece no que é logado nem no que é lançado.
- **Os dois pontos de integração, com teste escrito para falhar se revertido:**
  áudio transcrito conta como "mensagem mais recente utilizável" e foto **não**;
  o histórico enviado ao modelo contém o texto do áudio transcrito (contra a
  implementação atual, a conversa chegaria vazia).
- **Fila e worker** — encadeamento até o turno de IA, e a ausência dele quando
  `transcription_feed_ai` está desligado.
- **Rotas e cartão de configuração** — padrão da casa.
- **Frontend** — os quatro estados de transcrição, e o player intocado em todos.

**Manuais** (os 16 cenários do briefing): exigem áudio real. Os que mais importam
são os termos técnicos, que medem se o vocabulário está ajudando, e o áudio
corrompido, que mede se a falha degrada bem.

## Fora de escopo

- **Tela de dashboard de transcrição.** Os dados são gravados desde já; a tela
  entra junto com o dashboard de IA, na mesma fase.
- **Conversão de formato.** O arquivo é enviado como o WhatsApp entregou. Se a
  API recusar algum formato, a conversão com `ffmpeg-static` entra depois, guiada
  por erro real em vez de suposição.
- **Transcrição de áudio enviado pelo atendente.** Só áudio de entrada.
- **Transcrição sob demanda** (botão "transcrever"). Decidido no brainstorm:
  quebraria o fluxo automático da IA.
- **Reprocessar transcrição que falhou.** Sem repetição automática nesta fase.
- **Multiempresa.** O sistema é single-tenant e continua assim.
