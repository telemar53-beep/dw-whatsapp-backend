# Abas do dashboard + edição de contato e cidades (DW Telecom)

**Data:** 2026-09-08
**Status:** Aprovado para planejamento de implementação
**Estende:** [2026-09-04-whatsapp-attendance-system-design.md](2026-09-04-whatsapp-attendance-system-design.md)

## Contexto e motivação

O usuário mandou capturas de tela do Chat Mix (ferramenta que este projeto
substitui) pedindo três coisas juntas: (1) reorganizar a barra lateral do
dashboard em três abas com contador — "Andamento", "Espera", "Automação" —
em vez dos dois blocos sempre-visíveis de hoje; (2) uma forma de o
atendente corrigir o nome do contato durante o atendimento; (3) uma lista
de cidades atendidas, configurável pelo admin, associável a cada contato e
exibida como sufixo do nome (ex: "Berg - Bahia"). O usuário optou
explicitamente por tratar as três coisas num único spec/plano, em vez de
dividir.

## Escopo

**Dentro do escopo:**
- Três abas na barra lateral do dashboard, com contador de itens.
- Separação de "conversas em triagem automática" das "conversas
  aguardando atendimento humano" — hoje misturadas na mesma fila.
- Edição do nome do contato e associação a uma cidade, via modal aberto ao
  clicar no avatar/nome no topo da conversa.
- Nova lista de cidades gerenciada pelo admin (criar/excluir), mesmo
  padrão de "Setores"/"Respostas rápidas".
- Exibição do sufixo de cidade em toda parte que hoje mostra o nome do
  contato (fila, minhas conversas, cabeçalho da conversa aberta).

**Fora do escopo (aceito como está, não é um gap a corrigir aqui):**
- Cadastro de cliente novo do zero (sem ele ter mandado mensagem ainda) —
  usuário confirmou que só quer editar contatos que já existem.
- Atualização em tempo real da edição em outras abas/janelas abertas — a
  tela atual atualiza na hora; o resto atualiza no próximo carregamento,
  mesmo comportamento já aceito hoje para outras coisas do sistema.
- Busca/filtros/seleção múltipla de atendimentos (visíveis nas capturas do
  Chat Mix, mas não pedidos pelo usuário) — fora de escopo.
- Contato pertencer a mais de uma cidade — é sempre no máximo uma.
- Mudar a página de administração ou a página de métricas, que já foram
  redesenhadas por outra sessão em andamento — as novas telas deste spec
  que vivem na área de administração (aba "Cidades") seguem o novo visual
  já em uso ali; as que vivem no dashboard/conversa (abas, modal de
  edição) seguem o visual atual dessa área, que ainda não foi redesenhada.

## Decisão de arquitetura

### A) Abas do dashboard

Sem rota nova no backend: toda conversa em triagem automática já aparece
hoje na fila (`conversations.status` é `'waiting'` por padrão, mesmo
durante a triagem), e cada conversa já carrega `triageState`. A separação
em "Espera" vs. "Automação" é só um filtro no frontend do array que
`useQueue()` já busca:

- **Andamento** = `myConversations` (de `useMyConversations()`, sem
  mudança nenhuma).
- **Automação** = `queue.filter((c) => c.triageState === 'pending')`.
- **Espera** = `queue.filter((c) => c.triageState !== 'pending')`.

`DashboardPage.jsx` ganha um estado `activeTab` (`'inProgress' | 'waiting'
| 'automation'`, inicial `'inProgress'`) e uma barra de 3 botões acima das
listas, cada um mostrando o nome da aba e, se a contagem for maior que
zero, um badge vermelho redondo com o número (mesmo padrão visual das
capturas do Chat Mix). Só a lista da aba ativa é renderizada; `TeamPanel`
continua sempre visível, abaixo da área de abas, em qualquer aba.
`QueueList.jsx` ganha duas props opcionais (`title`, `emptyMessage`, com
os valores de hoje como padrão) para ser reaproveitado tanto na aba
"Espera" quanto na aba "Automação" sem duplicar o componente.

A conversa aberta (`selectedConversation`) não é afetada pela troca de
aba — continua funcionando exatamente como hoje, incluindo o
comportamento mobile de esconder a lista quando uma conversa está aberta.

### B) Editar nome do contato e cidade

Novo `EditContactModal.jsx` (mesmo padrão visual do `TransferModal.jsx`
atual — a área do dashboard/conversa ainda não foi redesenhada, então este
modal segue o visual atual, não o novo). Abre ao clicar no bloco
avatar+nome no cabeçalho de `ConversationView.jsx` (esse bloco vira um
`<button>`). Pré-preenchido com `conversation.contactDisplayName` e
`conversation.contactCityId` (campo novo, ver seção D), busca a lista de
cidades via `GET /api/cities` (aberta a qualquer atendente autenticado,
mesmo padrão de `GET /api/sectors`) para popular um `<select>`. Um botão
"Salvar" chama `PATCH /api/contacts/:contactId` com
`{ displayName, cityId }` — `cityId` pode ser `null` (opção "Nenhuma"
no select). Qualquer atendente autenticado pode editar, não só admin —
é uma correção do dia a dia durante o atendimento.

O nome do contato é global (a tabela `contacts` é por número de telefone,
não por conversa/canal) — editar afeta todas as conversas passadas e
futuras daquele contato, em qualquer canal. O campo de nome é opcional
(pode ficar em branco e salvar como `null`) — a coluna já é nullable hoje
e todo o resto do sistema já trata um nome ausente caindo para o
telefone; isso permite ao atendente limpar um nome errado (ex: vindo de
um `pushName` estranho) sem precisar digitar algo no lugar.

Após salvar com sucesso, o modal fecha. A conversa atualmente aberta
reflete a mudança imediatamente (o componente que chamou o modal atualiza
seu próprio estado local com o nome/cidade retornados pela API). Outras
abas/janelas, ou a mesma conversa listada na fila de outro atendente, só
mostram a mudança no próximo carregamento — comportamento aceito, mesmo já
usado hoje em outras partes do sistema.

### C) Lista de cidades (admin)

Nova tabela `cities` (id, name, created_at) — cópia exata da tabela
`sectors` de hoje, sem a tabela de associação (`agent_sectors`), já que
aqui a associação é uma coluna única em `contacts`, não uma relação N:N.

Backend: `src/cities/city.repository.js` (`listCities`, `createCity`,
`deleteCity` — sem `updateCity`, já que o design não pede renomear, só
criar/excluir), `src/api/cities.routes.js` (`GET /` aberta, mesmo padrão
de `sectors.routes.js`) e `src/api/admin-cities.routes.js` (`POST /` e
`DELETE /:id`, admin-only, mesmo padrão de `admin-sectors.routes.js`
menos a rota `PATCH`).

Frontend: nova aba "Cidades" em `AdminChannelsPage.jsx` (ao lado de
"Setores"), `CitiesAdminTab.jsx` + `CreateCityForm.jsx` — cópia estrutural
de `SectorsAdminTab.jsx`/`CreateSectorForm.jsx`, mas **sem** o botão
"Editar" em cada linha (só nome + excluir, já que não há `updateCity`).
Essas telas vivem na área de administração, que **já foi redesenhada**
pela sessão em paralelo (visual "glass"/`teal-signal`/`ink-950`) — os
novos componentes seguem esse visual atual, copiando as classes exatas de
`SectorsAdminTab.jsx`/`CreateSectorForm.jsx`.

Excluir uma cidade que tem contatos associados não é bloqueado — esses
contatos voltam a ficar sem cidade (`ON DELETE SET NULL`), mesmo
comportamento já usado por `conversations.sector_id`.

### D) Onde a cidade aparece

`contacts` ganha `city_id UUID REFERENCES cities(id) ON DELETE SET NULL`
(nullable). `contact.repository.js` ganha `updateContact(id, {
displayName, cityId })`, e `toContact` passa a incluir `cityId`.

As três queries de `conversation.repository.js` que já juntam `contacts`
(`getConversationWithContact`, `listWaitingConversations`,
`listConversationsByAgent`) ganham um `LEFT JOIN cities ci ON ci.id =
ct.city_id` e dois campos novos: `contactCityId` (o id bruto, usado para
pré-preencher o select do modal de edição) e `cityName` (o nome já
resolvido, usado só para exibição). `listClosedConversationsByContact`
continua fora — nem hoje junta `contacts`.

Sempre que `cityName` existir, o nome exibido vira `"Nome - Cidade"` (ou
`"Telefone - Cidade"` se não houver nome) em `ConversationListItem.jsx`
(fila e minhas conversas) e no cabeçalho de `ConversationView.jsx`. Sem
cidade, mostra só o nome/telefone, como hoje. A lógica de montar essa
string fica inline nos dois componentes (não vale a pena criar um
utilitário compartilhado para uma única linha usada em dois lugares —
mesmo padrão de duplicação pequena já aceito neste projeto para as props
do `ContactAvatar`).

## Testes

- **`city.repository.test.js`** (novo): criar, listar (ordem alfabética,
  mesmo padrão de `sector.repository.test.js`), excluir; excluir uma
  cidade com contato associado deixa o contato sem cidade (não bloqueia).
- **`cities.routes.test.js`** / **`admin-cities.routes.test.js`** (novos):
  espelham `sectors.routes.test.js`/`admin-sectors.routes.test.js` (menos
  os casos de `PATCH`, que não existe aqui).
- **`contact.repository.test.js`** (existente, estendido): `updateContact`
  atualiza nome e cidade; `updateContact` com `cityId: null` remove a
  cidade; `toContact`/`findContactById` incluem `cityId`.
- **`conversation.repository.test.js`** (existente, estendido):
  `contactCityId`/`cityName` aparecem corretamente nas 3 queries afetadas,
  incluindo o caso sem cidade (`null`/`null`).
- **`DashboardPage.test.jsx`** (existente, reescrito nos testes que
  assumiam as duas listas sempre visíveis): clicar em cada aba mostra só
  a lista correspondente; o badge de contagem aparece com o número certo
  e some quando a contagem é zero; uma conversa com `triageState:
  'pending'` aparece na aba "Automação" e não em "Espera"; selecionar uma
  conversa continua funcionando independente da aba ativa.
- **`EditContactModal.test.jsx`** (novo): pré-preenche nome/cidade atuais;
  salvar chama a API com os valores certos e fecha o modal; erro da API
  mostra mensagem, mantém o modal aberto.
- **`ConversationView.test.jsx`** (existente, estendido): clicar no
  avatar/nome abre o modal de edição.
- **`ConversationListItem.test.jsx`** / **`ConversationView.test.jsx`**
  (existentes, estendidos): mostram `"Nome - Cidade"` quando há cidade,
  só o nome quando não há.
- **`CitiesAdminTab.test.jsx`** / **`CreateCityForm.test.jsx`** (novos):
  espelham os testes de `SectorsAdminTab.test.jsx`/`CreateSectorForm.test.jsx`.

## Casos de borda aceitos (não é gap, é comportamento esperado)

- Editar o nome de um contato não reflete instantaneamente nas telas de
  outros atendentes — só no próximo carregamento.
- Uma conversa que sai da triagem (`triageState` deixa de ser `'pending'`)
  passa a aparecer em "Espera" automaticamente, sem nenhum código
  adicional — é só o resultado natural do filtro reavaliar o array já
  atualizado via socket.
- Sem `updateCity`/renomear cidade nesta entrega — só criar e excluir,
  igual ao pedido do usuário.

## Próximos passos

Com o spec aprovado, o próximo passo é usar a skill `writing-plans` para
transformar isso num plano de implementação detalhado.
