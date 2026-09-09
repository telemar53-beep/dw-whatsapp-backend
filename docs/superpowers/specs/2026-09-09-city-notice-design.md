# Aviso condicional por cidade — Design

## Contexto

Terceira e última entrega do pedido original de "mensagens" (as outras duas — boas-vindas
por canal e a renomeação da aba "Respostas rápidas" → "Mensagens" — já estão em produção).
Pedido literal do usuário: quando uma cidade específica está passando por uma instabilidade
de rede, ele quer poder cadastrar um aviso (ex: "nesse momento nossa rede passa por
instabilidade... etc") e ativá-lo — só os clientes cujo contato tem aquela cidade marcada
recebem esse aviso automaticamente quando entram em contato, seja numa conversa nova ou já
em andamento. Diferente da boas-vindas (geral, por canal), esse aviso é condicional a um
atributo do contato (a cidade) e à urgência do momento (só enquanto o problema durar).

## Decisões confirmadas com o usuário

1. **As duas mensagens, não uma substituindo a outra** (confirmado em brainstorm anterior,
   ao desenhar a boas-vindas): quando o aviso de cidade está ativo, o cliente recebe a
   boas-vindas do canal (se configurada) E o aviso da cidade, em sequência — nunca um no
   lugar do outro.
2. **Dispara em conversa nova OU já em andamento**: diferente da boas-vindas (só dispara em
   `justCreated`), o aviso de cidade dispara em qualquer mensagem do cliente enquanto o
   aviso estiver ativo — mas só uma vez por cliente por ativação (não repete a cada
   mensagem).
3. **Vários avisos simultâneos, um por cidade**: cada cidade tem seu próprio aviso,
   configurado e ativado/desativado independentemente das outras. Várias cidades podem
   estar com aviso ativo ao mesmo tempo.
4. **Localização na UI**: dentro da aba "Mensagens" (não dentro de "Cidades"), como uma
   terceira seção "Avisos por cidade" — mesmo padrão visual das outras duas seções
   (Boas-vindas por canal, Respostas rápidas).
5. **Ordem de disparo quando os dois se aplicam** (conversa nova + cidade com aviso ativo):
   boas-vindas do canal → aviso da cidade → pergunta de triagem. Em conversa já em
   andamento, só o aviso da cidade dispara (sem repetir boas-vindas/triagem).

## Modelo de dados

Duas tabelas novas, criadas na mesma migração:

```sql
CREATE TABLE city_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id UUID NOT NULL UNIQUE REFERENCES cities(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE city_notice_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_notice_id UUID NOT NULL REFERENCES city_notices(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city_notice_id, contact_id)
);
```

- `city_notices.city_id UNIQUE`: no máximo um aviso por cidade — cadastrar de novo para a
  mesma cidade é uma atualização (upsert), não uma segunda linha.
- `city_notices.message NOT NULL`: ao contrário da boas-vindas (onde texto vazio = "sem
  boas-vindas"), aqui o texto é sempre obrigatório para salvar — não existe "aviso vazio". O
  toggle `enabled` é o que controla se está ativo, independente do texto existir.
- `activated_at`: gravado com `now()` toda vez que `enabled` passa de `false` para `true`.
  Não é consultado por nenhuma lógica de negócio diretamente — serve de auditoria/depuração
  (quando o aviso atual começou a valer). A resposta a "quem já recebeu desde a última
  ativação" mora só em `city_notice_deliveries`.
- `city_notice_deliveries`: registra quem já recebeu aquele aviso (chave única por
  `city_notice_id` + `contact_id`, então uma tentativa de reenvio é sempre um "já recebeu,
  não reenviar"). **Toda vez que `enabled` passa de `false` para `true`, todas as linhas de
  `city_notice_deliveries` daquele `city_notice_id` são apagadas** — reativar é tratado como
  uma ocorrência nova do problema, então todo cliente daquela cidade recebe de novo, mesmo
  que já tivesse recebido numa ativação anterior.
- Ambas com `ON DELETE CASCADE`: excluir uma cidade (`DELETE /api/admin/cities/:id`, já
  existente) remove automaticamente seu aviso e o rastro de entregas — nenhuma mudança
  necessária nessa rota já existente. Excluir um contato (não existe rota pra isso hoje,
  mas por segurança) também limpa o rastro de entrega dele.

## Backend

### `src/city-notices/city-notice.repository.js` (novo módulo)

```javascript
const { getPool } = require('../db/pool');

function toCityNotice(row) {
  return {
    id: row.id,
    cityId: row.city_id,
    message: row.message,
    enabled: row.enabled,
    activatedAt: row.activated_at,
  };
}

async function listCityNoticesByCityIds(cityIds) {
  if (cityIds.length === 0) return [];
  const result = await getPool().query(
    'SELECT id, city_id, message, enabled, activated_at FROM city_notices WHERE city_id = ANY($1)',
    [cityIds]
  );
  return result.rows.map(toCityNotice);
}

async function findActiveCityNoticeByCityId(cityId) {
  if (!cityId) return null;
  const result = await getPool().query(
    'SELECT id, city_id, message, enabled, activated_at FROM city_notices WHERE city_id = $1 AND enabled = true',
    [cityId]
  );
  if (result.rowCount === 0) return null;
  return toCityNotice(result.rows[0]);
}

async function upsertCityNotice(cityId, { message, enabled }) {
  const existing = await getPool().query('SELECT enabled FROM city_notices WHERE city_id = $1', [cityId]);
  const wasEnabled = existing.rowCount > 0 && existing.rows[0].enabled;
  const isReactivation = enabled && !wasEnabled;

  const result = await getPool().query(
    `INSERT INTO city_notices (city_id, message, enabled, activated_at)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (city_id) DO UPDATE SET
       message = EXCLUDED.message,
       enabled = EXCLUDED.enabled,
       activated_at = CASE WHEN EXCLUDED.enabled THEN city_notices.activated_at ELSE NULL END,
       updated_at = now()
     RETURNING id, city_id, message, enabled, activated_at`,
    [cityId, message, enabled]
  );
  const notice = toCityNotice(result.rows[0]);

  if (isReactivation) {
    // A reactivation (false -> true) is a fresh occurrence of the problem: forget who
    // already got the previous round, so every contact in the city is notified again.
    await getPool().query('UPDATE city_notices SET activated_at = now() WHERE id = $1', [notice.id]);
    await getPool().query('DELETE FROM city_notice_deliveries WHERE city_notice_id = $1', [notice.id]);
    notice.activatedAt = new Date();
  }
  return notice;
}

async function deleteCityNotice(cityId) {
  const result = await getPool().query('DELETE FROM city_notices WHERE city_id = $1', [cityId]);
  return result.rowCount > 0;
}

async function hasContactReceivedNotice(cityNoticeId, contactId) {
  const result = await getPool().query(
    'SELECT 1 FROM city_notice_deliveries WHERE city_notice_id = $1 AND contact_id = $2',
    [cityNoticeId, contactId]
  );
  return result.rowCount > 0;
}

async function recordNoticeDelivery(cityNoticeId, contactId) {
  await getPool().query(
    `INSERT INTO city_notice_deliveries (city_notice_id, contact_id)
     VALUES ($1, $2)
     ON CONFLICT (city_notice_id, contact_id) DO NOTHING`,
    [cityNoticeId, contactId]
  );
}

module.exports = {
  listCityNoticesByCityIds,
  findActiveCityNoticeByCityId,
  upsertCityNotice,
  deleteCityNotice,
  hasContactReceivedNotice,
  recordNoticeDelivery,
};
```

`wasEnabled` é lido ANTES do upsert, numa query separada — é o que decide se essa chamada é
uma reativação (`false → true`). Uma edição que mantém `enabled: true → true` (só mudando o
texto, por exemplo) não mexe em `activated_at` nem em `city_notice_deliveries` — continua
valendo como a mesma ocorrência, sem reenviar pra quem já recebeu.

### Hook em `src/conversations/inbound-message.service.js`

Novo passo, independente do bloco `if (justCreated)` — roda em toda mensagem, não só em
conversa nova. Novo import: `const { findActiveCityNoticeByCityId, hasContactReceivedNotice, recordNoticeDelivery } = require('../city-notices/city-notice.repository');`

`enqueueOutboundMessage` grava a mensagem no banco de forma síncrona, na ordem em que é
chamada, antes de enfileirar o envio em si — então a ordem em que o histórico da conversa
mostra as mensagens é a ordem textual das chamadas no código. Para bater com a ordem
aprovada (boas-vindas → aviso → triagem), o passo do aviso de cidade fica DEPOIS do bloco
`if (justCreated) { boas-vindas → triagem }` — mesmo rodando em toda mensagem, não só em
conversa nova:

```javascript
if (justCreated) {
  try {
    const channel = await findChannelById(channelId);
    if (channel && channel.welcomeMessage) {
      await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: channel.welcomeMessage });
    }
    if (conversation.triageState === 'pending') {
      await sendTriageQuestion(conversation.id, channelId);
    }
  } catch (err) {
    console.error(`Failed to send automatic messages for conversation ${conversation.id}`, err);
  }
} else if (!justCreated && conversation.triageState === 'pending') {
  conversation = await processTriageReply(conversation, channelId, content);
}

try {
  const cityNotice = await findActiveCityNoticeByCityId(contact.cityId);
  if (cityNotice && !(await hasContactReceivedNotice(cityNotice.id, contact.id))) {
    await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: cityNotice.message });
    await recordNoticeDelivery(cityNotice.id, contact.id);
  }
} catch (err) {
  console.error(`Failed to send city notice for conversation ${conversation.id}`, err);
}
```

O aviso de cidade fica no seu próprio `try/catch`, separado do bloco de boas-vindas —
uma falha num não deve impedir o outro.

### Rotas admin — `src/api/admin-city-notices.routes.js` (novo arquivo)

Montado em `src/server.js` como `app.use('/api/admin/cities', adminCityNoticesRoutes)` (mesmo
prefixo de `admin-cities.routes.js`, arquivo separado por responsabilidade — mesmo padrão
usado para `admin-channels`/`admin-dashboard` no resto do projeto).

- `GET /api/admin/cities/notices` (`requireAuth`, `requireRole('admin')`) — lista todas as
  cidades com seu aviso (se existir): `[{ id, name, notice: { message, enabled } | null }]`.
  Junta `listCities()` (já existe) com `listCityNoticesByCityIds()` (novo) em memória — sem
  precisar de uma query SQL com JOIN dedicada, já que o número de cidades é pequeno.
- `PATCH /api/admin/cities/:id/notice` (`requireAuth`, `requireRole('admin')`) — corpo
  `{ message, enabled }`, os dois obrigatórios (`message` string não-vazia após trim,
  `enabled` boolean). 404 se a cidade não existir, 400 se `message` vazio, 400 se `enabled`
  não for boolean. Chama `upsertCityNotice(cityId, { message: message.trim(), enabled })`.
- `DELETE /api/admin/cities/:id/notice` (`requireAuth`, `requireRole('admin')`) — remove o
  aviso da cidade por completo (volta pro estado "sem aviso salvo"). 404 se não havia aviso.

Limite de 4096 caracteres no `message`, mesmo padrão e mesma mensagem de erro
(`'message must be 4096 characters or fewer'`) já usado em `welcomeMessage`.

### `frontend/src/services/api.js`

```javascript
export function listCityNotices(token) {
  return apiFetch('/api/admin/cities/notices', { token });
}

export function setCityNotice(cityId, message, enabled, token) {
  return apiFetch(`/api/admin/cities/${cityId}/notice`, { method: 'PATCH', body: { message, enabled }, token });
}

export function deleteCityNotice(cityId, token) {
  return apiFetch(`/api/admin/cities/${cityId}/notice`, { method: 'DELETE', token });
}
```

## Admin UI

Nova seção "Avisos por cidade" em `frontend/src/components/MessagesAdminTab.jsx`, entre
"Boas-vindas por canal" e "Respostas rápidas" — mesmo quadro de ajuda ("O que é isso?" +
exemplo) e mesmo padrão de linha fechada com criar/editar/excluir que a seção de
boas-vindas acabou de ganhar:

- Cidade sem aviso salvo: nome + botão "Criar aviso" (sem textarea aberta).
- Cidade com aviso salvo: linha fechada com nome + uma bolinha de status ("Ativo"/"Inativo",
  mesmo componente visual `StatusDot` já usado pros canais) + prévia do texto + botões
  Editar/Excluir.
- Editar (ou Criar) abre o formulário: textarea do texto + checkbox "Ativo" (mesmo padrão
  já usado em `IntegrationCard`/`ChannelCard`) + Salvar/Cancelar.
- Excluir pede confirmação e remove o aviso por completo (`DELETE`), volta pra "sem aviso
  salvo".

Usa uma lista de cidades vinda de `listCityNotices()` (não de `useCities()`, que não inclui
o aviso) — um novo hook `useCityNotices()` no mesmo padrão de `useChannels`/`useCities`.

## Erros e casos de borda

- **Contato sem cidade** (`contact.cityId` é `null`): `findActiveCityNoticeByCityId(null)`
  retorna `null` de cara (guarda explícita no repository) — nenhuma query desnecessária,
  nenhum aviso enviado. Comportamento idêntico ao de hoje (sem aviso nenhum).
- **Cidade excluída enquanto tinha aviso ativo**: `ON DELETE CASCADE` remove o aviso e as
  entregas junto — próxima mensagem de um contato daquela cidade não encontra aviso nenhum
  (a cidade em si só existe como FK opcional em `contacts.city_id`, que vira `NULL`
  automaticamente também, já que essa FK já tinha esse comportamento antes desta feature).
- **Falha ao enfileirar o aviso** (Redis fora do ar, etc.): capturada no próprio `try/catch`
  do passo do aviso, logada, não propaga — mesma filosofia de resiliência já aplicada ao
  bloco de boas-vindas/triagem (não deixar uma falha de mensagem automática derrubar o
  broadcast pro atendente).
- **Texto maior que 4096 caracteres**: 400 na validação da rota, mesmo padrão do
  `welcomeMessage`.

## Testes

- `src/city-notices/city-notice.repository.test.js`: CRUD básico, `findActiveCityNoticeByCityId`
  retorna `null` pra cidade sem aviso ou aviso desativado, `upsertCityNotice` reseta entregas
  só quando reativa (false→true), não reseta numa edição de texto com `enabled` inalterado.
- `src/conversations/inbound-message.service.test.js`: cenários — contato de cidade com
  aviso ativo em conversa nova (boas-vindas + aviso, nessa ordem); mesma cidade em conversa
  já em andamento (só aviso, sem repetir boas-vindas); segunda mensagem do mesmo contato
  não repete o aviso; contato sem cidade não recebe nada; cidade com aviso desativado não
  envia.
- `src/api/admin-city-notices.routes.test.js`: as 3 rotas, validações (message vazio,
  enabled não-boolean, limite de 4096, cidade inexistente).
- Frontend: `MessagesAdminTab.test.jsx` ganha os mesmos ~8 cenários que a seção de
  boas-vindas já tem (criar, editar, excluir, cancelar, erros), adaptados pro toggle
  "Ativo" no lugar do texto-vazio-desativa.
