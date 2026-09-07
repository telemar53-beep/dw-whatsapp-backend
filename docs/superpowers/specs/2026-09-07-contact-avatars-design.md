# Foto de perfil do contato (DW Telecom)

**Data:** 2026-09-07
**Status:** Aprovado para planejamento de implementação
**Estende:** [2026-09-04-whatsapp-attendance-system-design.md](2026-09-04-whatsapp-attendance-system-design.md)

## Contexto e motivação

O Chat Mix (ferramenta que este projeto substitui) mostra a foto de perfil do
cliente na conversa. Hoje este sistema só mostra nome/telefone em todo lugar.
Este recurso adiciona a foto de perfil, reaproveitando a infraestrutura de
mídia já existente (`src/media/media-storage.js`, o padrão de rota
autenticada `GET /api/media/:messageId`).

**Limitação confirmada e aceita, não é um gap deste projeto:** a API oficial
da Meta Cloud não expõe foto de perfil de clientes para o negócio — o
`contacts` object dos webhooks só traz `profile.name`/`wa_id` (confirmado via
pesquisa da documentação oficial durante o brainstorming). Só canais Baileys
(não-oficiais), que têm `sock.profilePictureUrl(jid)` disponível, vão
mostrar foto real. Canais Meta Cloud continuam mostrando só um placeholder,
exatamente como hoje.

## Escopo

**Dentro do escopo:**
- Busca automática da foto de um contato Baileys, uma única vez, no momento
  em que o contato é criado no banco (primeira mensagem que ele já mandou
  para qualquer canal Baileys deste sistema).
- Download e armazenamento em disco (reaproveitando `saveMediaFile`), com
  nova coluna `contacts.avatar_path` e nova rota autenticada
  `GET /api/contacts/:contactId/avatar`.
- Script de backfill (`scripts/backfill-contact-avatars.js`, rodado
  manualmente uma vez após o deploy) para contatos Baileys já existentes que
  nunca passaram pelo momento de criação com essa funcionalidade ativa.
- Exibição no frontend: avatar em `ConversationListItem` (fila geral e
  "Minhas conversas") e no cabeçalho de `ConversationView` (que hoje não
  identifica o contato — ganha nome + avatar).

**Fora do escopo (aceito como está, não é um gap a corrigir aqui):**
- Canais Meta Cloud nunca terão foto real — limitação da própria Meta, não
  deste sistema.
- Atualização periódica da foto (se o cliente trocar de foto depois da
  primeira busca, o sistema não vai perceber). Só uma nova busca manual via
  um recurso futuro, se algum dia for pedido.
- Reintentar a busca em mensagens futuras se a primeira tentativa falhar
  (ex: contato com a foto privada na hora da primeira mensagem). Escolha
  explícita do usuário durante o brainstorming: mais simples, custo é só
  não ter foto para esse contato específico.
- `ConversationHistoryModal.jsx` não ganha avatar — esse modal já não mostra
  nenhuma identidade do contato hoje (só data/canal do atendimento
  anterior), então isso ficaria fora do padrão natural desta mudança.

## Decisão de arquitetura

### Dado (banco)

Nova migração: `contacts.avatar_path TEXT` (nullable, mesmo estilo de
`messages.media_path`) — caminho relativo dentro do disco já apontado por
`MEDIA_STORAGE_DIR` (variável de ambiente já existente, nenhuma nova
variável obrigatória).

### Busca e armazenamento (Baileys)

`contact.repository.js`'s `findOrCreateContactByPhoneNumber` passa a
devolver também `wasCreated: boolean` (mesma ideia do `justCreated` que
`inbound-message.service.js` já rastreia para conversas) — `true` só quando
o `SELECT` inicial não encontrou o contato (ramo que insere a linha nova).
`ingestInboundMessage` (em `inbound-message.service.js`) propaga isso no seu
retorno como `contactJustCreated`, sem incluir `wasCreated` no objeto
`contact` em si (mantém o formato do `contact` limpo para quem já consome
esse objeto hoje).

**Caso de borda aceito:** numa corrida rara (duas mensagens simultâneas de
um número totalmente novo), as duas podem achar `wasCreated: true` — na
pior hipótese, a busca da foto roda duas vezes para o mesmo contato,
resultado idêntico, sem erro. Não vale a complexidade extra de detectar
isso via `xmax` do Postgres para um recurso de exibição.

Em `baileys.manager.js`'s `handleMessagesUpsert`, logo depois de chamar
`ingestInboundMessage(...)`: se `contactJustCreated` for `true`, dispara
(sem `await`, "fire-and-forget") uma nova função interna que:
1. Chama `entry.sock.profilePictureUrl(phoneJid, 'image')`.
2. Baixa os bytes com `axios.get(url, { responseType: 'arraybuffer' })`
   (mesmo padrão já usado em `meta-cloud.adapter.js` para baixar mídia da
   Meta).
3. Salva com `saveMediaFile(buffer, extensionForMimeType(...))` (já existe
   em `media-storage.js`).
4. Grava o caminho retornado em `contacts.avatar_path` via uma nova
   `setContactAvatarPath(contactId, avatarPath)` em `contact.repository.js`.

Essa função nunca deixa um erro escapar (contato sem foto disponível, falha
de rede, timeout — tudo cai num `catch` que só loga e termina) — mesmo
cuidado já tomado historicamente neste projeto com handlers de evento do
Baileys (uma rejeição de Promise não tratada já derrubou o processo antes,
no Plano 5). Nunca atrasa nem bloqueia o processamento da mensagem em si.

Uma função auxiliar separada, exportada como
`fetchContactAvatarForChannel(channel, contactId, phoneNumber)`, encapsula os
passos 1-4 acima a partir de um `channelId` (busca a conexão ativa no `Map`
de conexões, igual `resolveWhatsAppJid` já faz) — usada tanto pelo fluxo ao
vivo quanto pelo script de backfill, para não duplicar a lógica.

### Rota de exibição

Nova `src/api/contacts.routes.js`, montada em `/api/contacts` (mesma lista de
`app.use` em `server.js`), com `GET /:contactId/avatar` — clone quase exato
de `GET /api/media/:messageId` (mesma checagem de token via header ou
`?token=`, mesmo `res.sendFile(getMediaFilePath(...))`, 404 se o contato não
tiver `avatar_path`).

### Propagação para as listas de conversa

As três queries de `conversation.repository.js` que já fazem
`JOIN contacts ct` para pegar `contact_display_name`/`contact_phone_number`
(`getConversationWithContact`, `listWaitingConversations`,
`listConversationsByAgent`) ganham também `ct.avatar_path AS
contact_avatar_path` no `SELECT`. `toConversationSummary` passa a incluir
`contactAvatarPath: row.contact_avatar_path`. `listClosedConversationsByContact`
(usada só pelo histórico) fica sem alteração — nem hoje faz join com
`contacts`.

### Frontend

Novo helper em `services/api.js`:
```js
export function avatarUrl(contactId, token) {
  return `${API_BASE_URL}/api/contacts/${contactId}/avatar?token=${token}`;
}
```

Novo componente `frontend/src/components/ContactAvatar.jsx`: recebe
`contactId`, `avatarPath`, `displayName` e `phoneNumber` como props. Se
`avatarPath` for truthy, renderiza `<img src={avatarUrl(contactId, token)} />`
num círculo; senão, renderiza um círculo colorido com a primeira letra de
`displayName` (ou de `phoneNumber`, se não houver `displayName`), mesmo
estilo simples usado em outros indicadores visuais deste projeto (ex:
bolinha de presença do `TeamPanel`).

- `ConversationListItem.jsx` (usado por `QueueList` e `MyConversationsList`)
  ganha `<ContactAvatar>` à esquerda do nome.
- `ConversationView.jsx`: o cabeçalho hoje só mostra o texto genérico
  "Conversa" — passa a mostrar `<ContactAvatar>` + nome/telefone do
  contato, igual ao padrão do Chat Mix. Essa é uma correção de uma lacuna
  já existente (o atendente não sabe quem é o contato só olhando o
  cabeçalho da conversa aberta), aproveitada nesta mudança.

### Backfill de contatos existentes

`scripts/backfill-contact-avatars.js` (mesmo padrão de
`scripts/create-agent.js`/`create-channel.js`: roda uma vez manualmente via
Render Shell contra a `DATABASE_URL` de produção, depois do deploy). Passos:
1. Inicia as conexões Baileys já existentes (reaproveitando
   `startAllBaileysConnections`).
2. Busca todo contato com `avatar_path IS NULL` que tem pelo menos uma
   conversa (aberta ou fechada) num canal `baileys`.
3. Para cada um, chama `fetchContactAvatarForChannel` usando o canal Baileys
   mais recente daquele contato, com um pequeno intervalo entre chamadas
   (evitar sobrecarregar a conexão/levantar suspeita de automação no
   WhatsApp).
4. Contatos cujo canal não está conectado no momento, ou cuja foto não está
   disponível, ficam sem foto — o script loga e segue para o próximo, sem
   parar a execução inteira por um contato problemático.

## Testes

- **`contact.repository.test.js`** (existente, estendido): `wasCreated` é
  `true` só na primeira criação; `setContactAvatarPath` grava e é refletido
  por uma leitura seguinte.
- **`baileys.manager.test.js`** (existente, estendido): mensagem de contato
  novo dispara a busca da foto; mensagem de contato já existente (ou já com
  `avatar_path`) não dispara; falha na busca (foto indisponível, erro de
  rede) não impede a mensagem de ser processada nem derruba o teste.
- **`contacts.routes.test.js`** (novo, espelha `media.routes.test.js`):
  200 com o arquivo certo quando o contato tem `avatar_path`; 404 quando não
  tem ou o contato não existe; 401 sem token válido.
- **`conversation.repository.test.js`** (existente, estendido):
  `contactAvatarPath` aparece corretamente nas 3 queries afetadas.
- **`ContactAvatar.test.jsx`** (novo): mostra a imagem quando há
  `avatarPath`; mostra a inicial do nome (ou telefone) quando não há.
- **`ConversationListItem.test.jsx`** / **`ConversationView.test.jsx`**
  (existentes, estendidos): renderizam `ContactAvatar` com os dados certos.

## Casos de borda aceitos (não é gap, é comportamento esperado)

- Cliente troca de foto depois da primeira busca: sistema continua mostrando
  a foto antiga (sem atualização automática, decisão explícita do escopo).
- Corrida rara de criação simultânea do mesmo contato: foto buscada duas
  vezes, sem efeito colateral além de uma chamada extra ao Baileys.
- Canal Baileys desconectado no momento em que um contato antigo passa pelo
  script de backfill: fica sem foto até uma execução futura do script (não
  há retry automático).

## Próximos passos

Com o spec aprovado, o próximo passo é usar a skill `writing-plans` para
transformar isso num plano de implementação detalhado.
