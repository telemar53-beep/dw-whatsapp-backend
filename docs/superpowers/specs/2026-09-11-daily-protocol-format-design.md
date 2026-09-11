# Formato de protocolo diário (AAAAMMDD-XXXX)

**Status:** Aprovado (aguardando revisão final do usuário antes do plano de implementação)
**Data:** 2026-09-11

## 1. Problema e objetivo

Hoje o número de protocolo (`conversations.protocol_number`) é um inteiro puro, gerado
por uma `sequence` do Postgres (`assignment_protocol_seq`) que nunca reinicia — o
primeiro atendimento depois de meses de uso já mostra um número de 4+ dígitos sem
nenhum significado pro cliente ou pro atendente. O usuário pesquisou o padrão de mercado
e pediu o formato `AAAAMMDD-XXXX` (ano-mês-dia + sequencial de 4 dígitos que reinicia
todo dia), ex: `20260911-0001` pro primeiro atendimento do dia 11/09/2026.

Afeta só `[[project_assignment_message]]`'s `claimProtocolNumber`, já que o protocolo só
é gerado quando a automação de mensagem de atribuição está ativa e configurada pro
agente/canal — se estiver desligada, a conversa nunca ganha protocolo, hoje ou depois
desta mudança.

Decisões confirmadas pelo usuário durante o brainstorming:

1. **Protocolos antigos (inteiro puro) ficam como estão para sempre** — não são
   reescritos no formato novo. Só atendimentos abertos a partir do deploy desta mudança
   ganham o formato `AAAAMMDD-XXXX`. A coluna vira texto para os dois formatos
   conviverem indefinidamente.
2. **Contador atômico via tabela dedicada** (`protocol_counters`), não sequence +
   job de reset — evita depender de um cron rodar exatamente à meia-noite e evita
   corrida na virada do dia.
3. **Fuso fixo em América/São_Paulo** para decidir "qual dia é hoje" — mesmo padrão já
   usado em `[[project_business_hours_auto_reply]]`, independente de o servidor (Render)
   rodar em UTC.
4. **Sem limite de 4 dígitos** — se um dia tiver mais de 9999 atendimentos reivindicados
   (extremamente improvável), o sequencial cresce naturalmente (`-10000`, `-10001`...)
   em vez de falhar ou travar a reivindicação do atendimento.

## 2. Modelo de dados

Migração nova (idempotente, mesmo padrão desta sessão):

```sql
CREATE TABLE IF NOT EXISTS protocol_counters (
  day DATE PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE conversations ALTER COLUMN protocol_number TYPE TEXT USING protocol_number::TEXT;
```

Notas de design:

- `protocol_counters.day` é a data civil em América/São_Paulo (não a data UTC do
  servidor) — ver seção 3. Uma linha por dia que já teve pelo menos um protocolo
  reivindicado; dias sem atendimento simplesmente não geram linha.
- `ALTER COLUMN ... TYPE TEXT USING protocol_number::TEXT` preserva os valores já
  gravados (`1042` → `'1042'`), sem tocar em nenhuma linha — só muda o tipo da coluna.
  Não há `ORDER BY`/`MAX()`/comparação numérica em `protocol_number` em nenhum lugar do
  código (só igualdade exata em `findConversationByProtocolNumber` e exibição como
  texto), então o retype não quebra nada existente.
- `assignment_protocol_seq` (a sequence antiga) **não é dropada** — fica órfã no banco,
  sem custo, evita qualquer risco de remover algo que outro processo ainda referencie.
  Pode ser limpa numa faxina futura, fora de escopo aqui.

## 3. Geração do número (fuso fixo, sem nova dependência)

Mesmo princípio de `[[project_business_hours_auto_reply]]`'s `getSaoPauloParts` — usa
`Intl.DateTimeFormat` nativo do Node fixado em `America/Sao_Paulo`, sem adicionar
`date-fns`/`luxon`/`dayjs`.

**Nova função em `src/assignment-messages/assignment-message.repository.js`:**

```js
const PROTOCOL_TIMEZONE = 'America/Sao_Paulo';

function todaySaoPauloDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: PROTOCOL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA formats as YYYY-MM-DD; strip the dashes for the AAAAMMDD segment.
  return formatter.format(date).replace(/-/g, '');
}

async function nextProtocolSequenceForToday() {
  const day = todaySaoPauloDateString();
  const result = await getPool().query(
    `INSERT INTO protocol_counters (day, last_seq) VALUES ($1, 1)
     ON CONFLICT (day) DO UPDATE SET last_seq = protocol_counters.last_seq + 1
     RETURNING last_seq`,
    [day]
  );
  return `${day}-${String(result.rows[0].last_seq).padStart(4, '0')}`;
}
```

`claimProtocolNumber` passa a gerar o valor em JS antes do `UPDATE`, em vez de
`nextval()` dentro do próprio SQL (o valor agora é uma string formatada, não algo que o
Postgres possa produzir sozinho num único `DEFAULT`/`nextval`):

```js
async function claimProtocolNumber(conversationId) {
  const candidate = await nextProtocolSequenceForToday();
  const result = await getPool().query(
    `UPDATE conversations
     SET protocol_number = COALESCE(protocol_number, $2)
     WHERE id = $1
     RETURNING protocol_number`,
    [conversationId, candidate]
  );
  return result.rows[0].protocol_number;
}
```

Notas de design:

- `INSERT ... ON CONFLICT (day) DO UPDATE ... RETURNING last_seq` é atômico por linha —
  duas reivindicações simultâneas no mesmo dia nunca recebem o mesmo `last_seq`, sem
  precisar de transação explícita ou `SELECT ... FOR UPDATE`.
- O `COALESCE` no `UPDATE` mantém a proteção idempotente que já existe hoje (uma
  segunda chamada de `claimProtocolNumber` na mesma conversa não sobrescreve o protocolo
  já salvo) — só que agora, se isso acontecer, o `candidate` gerado é descartado sem uso
  (um "buraco" no contador daquele dia, exatamente como já acontecia com a sequence
  antiga; não é um problema novo).
- `%04d` vem de `padStart(4, '0')` sobre um inteiro sem limite superior — `9999` → 4
  dígitos, `10000` → 5 dígitos, nunca lança erro nem duplica.
- `todaySaoPauloDateString` aceita `date` como parâmetro (default `new Date()`) só para
  permitir teste determinístico; não precisa disso em `nextProtocolSequenceForToday`
  porque cada reivindicação de fato acontece "agora".

## 4. Ajuste na busca por protocolo (admin)

`src/api/admin-dashboard.routes.js` — a rota `GET /conversations/by-protocol/:protocolNumber`
precisa aceitar os dois formatos (antigo: só dígitos; novo: `AAAAMMDD-XXXX` ou mais
dígitos) e não fazer mais `Number(...)` antes de buscar, já que a coluna agora é texto:

```js
const PROTOCOL_NUMBER_PATTERN = /^(\d+|\d{8}-\d{4,})$/;

router.get('/conversations/by-protocol/:protocolNumber', requireAuth, requireRole('admin'), async (req, res) => {
  if (!PROTOCOL_NUMBER_PATTERN.test(req.params.protocolNumber)) {
    return res.status(400).json({ error: 'protocolNumber must be a valid protocol number' });
  }
  const conversation = await findConversationByProtocolNumber(req.params.protocolNumber);
  ...
});
```

`findConversationByProtocolNumber` em `conversation.repository.js` não muda — já faz
`WHERE c.protocol_number = $1` com um parâmetro, que agora simplesmente recebe uma
string em vez de um número; o Postgres compara texto com texto sem cast nenhum.

## 5. Frontend

- **`frontend/src/pages/AttendanceDashboardPage.jsx`** — o campo de busca por protocolo
  tem hoje `inputMode="numeric"` (força teclado numérico no celular), o que impediria
  digitar o hífen do formato novo. Muda para `inputMode="text"` (ou remove o atributo,
  caindo no teclado padrão). Nenhuma outra mudança nesse arquivo — `getDashboardConversationByProtocol`
  já envia a string digitada sem conversão para número.
- **`frontend/src/components/ConversationInfoPanel.jsx`** — nenhuma mudança. Já exibe
  `conversation.protocolNumber` como texto puro (`{conversation.protocolNumber}`), então
  mostra `"1042"` ou `"20260911-0001"` igualmente bem.
- Mensagem de atribuição (`@chat_protocolo`) — nenhuma mudança em
  `message-placeholders.js`: `String(protocolNumber)` já funciona para os dois formatos.

## 6. Testes

Backend (Jest):

- `assignment-message.repository.test.js` (arquivo existente):
  - `todaySaoPauloDateString` retorna `AAAAMMDD` a partir de uma data fixa injetada
    (incluindo um caso perto da virada de fuso, ex: `2026-09-11T02:30:00.000Z` ≈
    23h30 de 10/09 em São Paulo, pra confirmar que usa o dia de Brasília, não o de UTC).
  - `claimProtocolNumber` agora retorna uma string no formato `AAAAMMDD-XXXX` (troca a
    asserção antiga `expect(typeof protocolNumber).toBe('number')`).
  - Duas chamadas de `claimProtocolNumber` em conversas diferentes no mesmo dia
    retornam sequenciais consecutivos (`-0001`, `-0002`).
  - Uma segunda chamada de `claimProtocolNumber` na mesma conversa retorna o valor já
    salvo, sem gerar um novo (protege a idempotência existente).
  - `clearProtocolNumber` continua limpando o campo (sem mudança de comportamento, só
    confirma que ainda funciona com o tipo texto).
- `admin-dashboard.routes.test.js` (arquivo existente) — casos novos/atualizados pra
  `GET /conversations/by-protocol/:protocolNumber`: aceita formato antigo (`"1042"`),
  aceita formato novo (`"20260911-0001"`), 400 pra formato inválido (`"not-a-number"`,
  string vazia).
- `conversation.repository.test.js` (arquivo existente) — os testes que hoje fazem
  `UPDATE conversations SET protocol_number = 1042` (inteiro literal em SQL raw) passam
  a usar uma string (`'1042'` ou `'20260911-0001'`), já que a coluna virou `TEXT`.

Migração:

- Rodar a migração localmente contra o banco de dev e confirmar com
  `\d conversations` que `protocol_number` virou `text`, e que linhas existentes
  mantiveram o valor (`SELECT protocol_number FROM conversations WHERE protocol_number
  IS NOT NULL LIMIT 5`).

Frontend (Vitest):

- `AttendanceDashboardPage.test.jsx` (arquivo existente) — teste novo ou ajustado
  confirmando que buscar por `"20260911-0001"` (com hífen) funciona normalmente.

## 7. Deploy

Migração precisa rodar **antes** do deploy do backend novo (mesmo padrão já estabelecido
nesta sessão pra mudanças de schema que o código novo depende: boas-vindas, aviso de
cidade, `Meu perfil`) — o `ALTER COLUMN ... TYPE TEXT` e a tabela `protocol_counters`
precisam existir antes que `claimProtocolNumber` tente gravar uma string ou fazer o
`INSERT ... ON CONFLICT` na tabela nova. No Render isso já é automático
(`[[project_render_migration_automated]]`), sem passo manual.

## 8. Fora de escopo (YAGNI)

- Reescrever protocolos antigos no formato novo — decisão confirmada de deixá-los como
  estão.
- Configurar o fuso horário — fixo em América/São_Paulo, mesmo padrão do resto do
  projeto.
- Qualquer limite rígido de 9999 por dia — o formato cresce além de 4 dígitos em vez de
  falhar.
- Dropar `assignment_protocol_seq` — fica órfã, sem custo, fora de escopo.
- Qualquer mudança em quando/quem recebe um protocolo (isso continua 100% controlado
  pela config de `[[project_assignment_message]]`) — só o *formato* do valor muda.
