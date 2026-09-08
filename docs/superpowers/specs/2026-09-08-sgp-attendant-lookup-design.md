# Consulta ao SGP pelo atendente — Design

> Estende `docs/superpowers/specs/2026-09-04-whatsapp-attendance-system-design.md`.
> Direção oposta à `docs/superpowers/specs/2026-09-07-sgp-integration-design.md` e
> `2026-09-07-sgp-meta-cloud-integration-design.md`: aquelas specs cobrem o SGP chamando
> este sistema para disparar mensagens; esta spec cobre **este sistema chamando a API
> própria do SGP** para consultar dados de cliente/contrato e gerar 2ª via de boleto/PIX.

## Contexto e objetivo

Hoje, quando um atendente precisa de dados de um cliente (nome, contrato,
plano, endereço) ou de uma 2ª via de boleto/PIX durante um atendimento, não
há nenhuma forma de consultar isso dentro do painel — precisa abrir o SGP em
outra aba. O objetivo é deixar o atendente digitar o CPF do cliente dentro da
própria conversa e ver os dados reais e gerar boleto/PIX sem sair da tela.

**Confirmado com o usuário durante o brainstorm:**
- Só uso manual pelo atendente por enquanto — nenhuma automação/bot de
  triagem aciona isso.
- Qualquer atendente autenticado pode buscar e gerar boleto — sem
  restrição extra além do login já existente (o SGP é quem, se quiser,
  aplica suas próprias regras de negócio do lado dele).
- O painel fica dentro da própria `ConversationView`, como um painel lateral
  retrátil (mesmo padrão visual do painel "Equipe" já existente).

**Fora de escopo desta spec — "Liberação em confiança":** o usuário pediu
originalmente 3 ações (identificar cliente, 2ª via de boleto/PIX,
desbloqueio em confiança). Ao reler os testes reais que o usuário capturou
no Chat Mix (ação "Liberação por confiança"), ficou claro que o Chat Mix,
nesse teste, nunca chegou a acionar uma chamada de desbloqueio de verdade —
o campo `check_access` do retorno reaproveita literalmente a mesma chamada
`consultacliente` (mesma URL, mesmos parâmetros) e reavalia os dados já
retornados; todos os contratos testados estavam com `contratoStatus`
"Ativo" (nenhum bloqueado), e o SGP respondeu com o mesmo erro genérico
`{"success": false, "error": "empty_search", "message": "Document not
found"}` usado em outros pontos do SGP para "nada encontrado nesta busca".
**Não existe, portanto, nenhuma evidência real de qual endpoint de fato
aciona o desbloqueio** — não é só o formato de sucesso que é desconhecido,
é o endpoint inteiro. Implementar isso agora exigiria adivinhar uma chamada
de API real com efeito colateral direto no serviço de internet do cliente,
o que não é aceitável. Fica como item futuro, destravado quando o usuário
conseguir capturar um teste real no Chat Mix contra um contrato de fato
suspenso/bloqueado — só assim dá para ver a chamada real de desbloqueio.

## Modelo de dados

### Nova tabela `sgp_query_config`

Uma única linha, gerenciada pelo admin — diferente de `platform_integrations`
(que é uma lista, um gateway por canal), aqui só existe uma instância de SGP
por cliente deste sistema (a mesma URL/App/Token da tela "Gerenciar Sgp" do
Chat Mix que o usuário mostrou).

```sql
CREATE TABLE sgp_query_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_url TEXT NOT NULL,
  app TEXT NOT NULL,
  token TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

O `token` fica em texto puro no banco (mesma decisão já aceita neste
projeto para o access token da Meta Cloud em `channels.config` — ferramenta
admin-only, sem exigência nova de criptografia). Nunca é devolvido por
inteiro por nenhuma rota — a tela de admin mostra só os 4 últimos
caracteres, igual ao próprio Chat Mix (`...5c7a` no print que o usuário
mandou).

Sem migração de dados existentes — tabela nova, vazia até o admin preencher.

## Backend

### `src/integrations/sgp-query-config.repository.js` (novo)

Repositório simples de uma linha só:

```js
async function getSgpQueryConfig() // SELECT * LIMIT 1, ou null se não configurado
async function upsertSgpQueryConfig({ baseUrl, app, token, enabled })
  // token é opcional — se omitido, mantém o token já salvo (update parcial)
```

Fica em arquivo separado de `sgp-integration.repository.js` deliberadamente —
aquele cobre a direção contrária (SGP nos chamando) e misturar os dois
conceitos geraria confusão, como a memória do projeto já registrou ao
descobrir que são "três mecanismos separados" na tela do Chat Mix.

### `src/integrations/sgp-client.js` (novo)

Módulo isolado de I/O — chamadas HTTP reais para a API do SGP, via `axios`
(já usado em `meta-cloud.adapter.js` para chamadas externas, mesmo padrão).
Toda chamada usa `application/x-www-form-urlencoded` com `token`/`app` do
`sgp_query_config` mais os campos específicos da ação.

```js
async function lookupClientByCpf(cpf)
// POST {baseUrl}/api/ura/consultacliente  { token, app, cpfcnpj: cpf }
// cpf já normalizado (só dígitos) antes de chegar aqui.
// Retorna a lista de contratos normalizada (ver seção "Formato de resposta").
// Lança SgpClientNotFoundError quando `contratos` vem vazio/ausente.

async function getDuplicateInvoice(contratoId)
// Encadeia, na mesma ordem confirmada pelos testes reais do Chat Mix:
//   1. POST {baseUrl}/api/central/titulos      { token, app, contrato: contratoId, nao_gerar_os: 1 }
//   2. POST {baseUrl}/api/ura/fatura2via        { token, app, contrato: contratoId, nao_gerar_os: 1 }
//   3. Para cada item de `links[]` retornado no passo 2 (campo `id`):
//        POST {baseUrl}/api/ura/pagamento/pix/<id>  { token, app, contrato: contratoId }
// O passo 1 existe só para espelhar o fluxo real observado — o resultado
// usado é o do passo 2 e 3. O `pix` do passo 3 é usado como fonte de
// verdade do código PIX (pode ser mais atualizado que o `codigopix` que já
// vem no passo 2); se o passo 3 falhar para um item específico, cai para o
// `codigopix` do passo 2 em vez de derrubar a ação inteira.
// Retorna { hasOpenInvoice: false } quando `fatura2via` volta com
// `status: 0` / `links: []` (sem fatura em aberto para gerar 2ª via).
```

Timeout de 15s por chamada (axios `timeout`), sem retry automático — uma
falha de rede vira erro 502 na rota, o atendente tenta de novo manualmente
(mesmo espírito de "erro visível, sem mascarar" já usado no resto do
projeto).

**Campos deliberadamente excluídos da resposta normalizada, por segurança:**
o retorno bruto de `consultacliente` inclui `contratoCentralSenha` e
`servico_senha` — a senha em texto puro da central do assinante e do login
PPPoE do cliente. Não há motivo legítimo para um atendente ver a senha do
cliente na tela; esses dois campos nunca são copiados para a resposta do
nosso backend, em nenhum ponto do código (não é uma máscara no frontend —
o dado simplesmente não sai do `sgp-client.js`).

### Formato de resposta normalizada

`lookupClientByCpf`:

```json
{
  "client": { "id": 16957, "name": "...", "document": "036.668.113-37" },
  "contracts": [
    {
      "id": 17402,
      "status": "Ativo",
      "plan": "1GB",
      "openInvoicesCount": 1,
      "openAmount": 0,
      "address": "AGENOR COSTA, 523 - RODAGEM, CÂNDIDO MENDES/MA",
      "phones": ["(98) 98512-0338"],
      "emails": ["exemplo@dominio.com"]
    }
  ]
}
```

`getDuplicateInvoice`:

```json
{
  "hasOpenInvoice": true,
  "duplicates": [
    {
      "id": "123456",
      "dueDate": "2026-09-20",
      "value": 89.9,
      "barCode": "836...digitável...",
      "pixCode": "000201...emv...6304ABCD",
      "boletoLink": "https://.../boleto.pdf"
    }
  ]
}
```

(valores acima são exemplos ilustrativos — os nomes de campo batem com o que
foi confirmado nos testes reais, os valores não são dados reais de cliente.)

### Rotas — configuração (admin)

Adicionadas em `src/api/admin-integrations.routes.js` (mesmo arquivo das
rotas `/sgp` já existentes, mesmo middleware `requireAuth` +
`requireRole('admin')`):

```
GET  /api/admin/integrations/sgp-query-config
     -> { configured: true, baseUrl, app, tokenLast4: "5c7a", enabled }
     -> { configured: false } quando a tabela está vazia

PUT  /api/admin/integrations/sgp-query-config
     body: { baseUrl, app, token?, enabled }
     token omitido = mantém o token já salvo; obrigatório na primeira vez
     (configured: false) e opcional depois.
```

### Rotas — consulta (qualquer atendente)

Novo arquivo `src/api/sgp-query.routes.js`, montado em `server.js` como
`app.use('/api/sgp', sgpQueryRoutes)`. Todas as rotas usam `requireAuth`
(nenhum `requireRole` — confirmado que qualquer atendente pode acionar).

```
GET  /api/sgp/clientes?cpf=<somente dígitos>
     200 -> { client, contracts }        (formato acima)
     400 -> { error: 'cpf is required' }              cpf ausente/vazio
     400 -> { error: 'SGP integration is not configured' }
     400 -> { error: 'SGP integration is not enabled' }
     404 -> { error: 'Client not found' }              consultacliente sem contratos
     502 -> { error: 'Failed to reach SGP' }            timeout/erro de rede

POST /api/sgp/contratos/:contratoId/boleto
     200 -> { hasOpenInvoice, duplicates }
     400/502 -> mesmos casos acima (config ausente/desabilitada/erro de rede)
```

`contratoId` chega da lista já retornada por `GET /clientes` — a rota não
recebe CPF de novo nessa chamada, só o id do contrato.

## Frontend

### `useSgpLookup()` (novo hook)

Diferente dos hooks "REST uma vez + atualiza por socket" já usados no
projeto (`useAgents`, `useChannels`) — aqui não há dado persistente para
manter sincronizado, é busca sob demanda disparada pelo atendente. Estado
local simples:

```js
const { client, contracts, loading, error, search, fetchDuplicate, duplicateState } = useSgpLookup();
// search(cpf) -> chama GET /api/sgp/clientes
// fetchDuplicate(contratoId) -> chama POST /api/sgp/contratos/:id/boleto,
//   guarda o resultado por contratoId em duplicateState (Map-like:
//   { [contratoId]: { loading, error, hasOpenInvoice, duplicates } })
```

### `SgpLookupPanel.jsx` (novo componente)

- Campo de texto para CPF (só dígitos, mesma normalização de telefone já
  usada em `StartConversationModal`) + botão "Buscar".
- Estado vazio: nada renderizado além do campo.
- Cliente não encontrado: mensagem simples, sem toast de erro (é um
  resultado válido de busca, não uma falha do sistema).
- Cliente encontrado: nome + documento no topo; um cartão por contrato
  (status, plano, endereço, telefones/e-mails) com um botão "Gerar 2ª via +
  PIX".
- Ao clicar "Gerar 2ª via + PIX": mostra loading no botão daquele contrato
  específico; resultado aparece embaixo do cartão — linha digitável e
  código PIX em blocos com botão "Copiar" (usa a mesma API
  `navigator.clipboard` já disponível no browser, sem dependência nova),
  link do boleto como link normal. `hasOpenInvoice: false` mostra "Nenhuma
  fatura em aberto para este contrato."

### Encaixe na `ConversationView.jsx`

Hoje o componente é uma coluna única (`flex h-full flex-col`: cabeçalho,
lista de mensagens, input). Passa a ter um novo botão no cabeçalho
("Consultar SGP") que alterna um estado local `sgpPanelOpen`; quando
verdadeiro, a raiz vira uma linha (`flex h-full`) com a coluna atual mais um
`<aside>` de largura fixa à direita renderizando `<SgpLookupPanel />` — sem
nenhuma dependência da conversa selecionada (o CPF é digitado do zero a
cada busca, não é amarrado ao contato da conversa automaticamente nesta
primeira versão).

### Admin: `SgpQueryConfigCard.jsx` (novo componente)

Um card simples (mesmo `cardClass`/`inputClass` já usados em
`IntegrationsAdminTab.jsx`) renderizado acima da lista de integrações
existente, na mesma aba "Integrações": campos URL, App, Token (mostra só
`...tokenLast4` quando já configurado, com um botão "Trocar token" que
revela o campo vazio para digitar um novo), checkbox Ativo, botão Salvar.
Usa `useSgpQueryConfig()` (novo hook, mesmo padrão REST-simples de
`useSgpLookup`).

## Tratamento de erro — resumo

| Situação | Resposta do backend | UI |
|---|---|---|
| CPF vazio | 400 | validação inline, nem chama a API |
| Config ausente/desabilitada | 400 | "Integração com o SGP não configurada." |
| Cliente não encontrado | 404 | "Cliente não encontrado." |
| SGP fora do ar / timeout | 502 | "Não foi possível consultar o SGP agora." |
| Sem fatura em aberto | 200, `hasOpenInvoice: false` | mensagem inline, não é erro |

## Testes

Segue o padrão já estabelecido no projeto (Jest no backend, Vitest +
Testing Library no frontend), TDD task a task:

- `sgp-client.js`: axios mockado — casos de sucesso de `lookupClientByCpf`
  e `getDuplicateInvoice` (incluindo o fallback do passo 3 pro `codigopix`
  do passo 2), cliente não encontrado, `hasOpenInvoice: false`, timeout.
- `sgp-query-config.repository.js`: contra o banco de teste real (mesmo
  padrão dos outros repositórios deste projeto).
- `sgp-query.routes.js` e as novas rotas admin: repositório/cliente
  mockados, cobrindo os 5 casos da tabela acima.
- `useSgpLookup.test.jsx`, `SgpLookupPanel.test.jsx`,
  `useSgpQueryConfig.test.jsx`, `SgpQueryConfigCard.test.jsx`: `services/api.js`
  mockado, mesmo padrão de `useSgpIntegrations.test.jsx` /
  `IntegrationsAdminTab.test.jsx`.
- `ConversationView.test.jsx`: precisa mockar `useSgpLookup` (mesma
  armadilha já documentada neste projeto — mockar o hook que um componente
  compartilhado passa a chamar, não só o arquivo alterado).

## Fora de escopo (confirmado com o usuário)

- Automação/bot de triagem acionando qualquer uma dessas ações — só manual.
- Qualquer restrição de permissão além do login já existente.
- "Liberação em confiança" (ver seção de contexto acima) — item futuro,
  bloqueado até haver um teste real contra um contrato suspenso.
- Cache/persistência local dos dados do SGP — toda consulta é ao vivo.
- Vincular automaticamente o CPF ao contato da conversa aberta — a busca é
  sempre manual, sem pré-preencher a partir do telefone do contato.
