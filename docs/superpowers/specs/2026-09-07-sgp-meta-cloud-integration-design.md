# Integração SGP com o WhatsApp oficial (Meta Cloud) — Design

> Estende `docs/superpowers/specs/2026-09-07-sgp-integration-design.md`, já
> implementado e confirmado funcionando em produção com o canal Baileys.

## Contexto e objetivo

A integração com o SGP já funciona para o número não-oficial (Baileys),
confirmada com disparo automático real de cobrança. Falta suportar o
mesmo disparo pelo número **oficial** (Meta Cloud API), que exige um
template pré-aprovado pela Meta para iniciar contato fora da janela de
24h — não aceita texto livre como o Baileys.

Descoberto por evidência real (telas do SGP e do Chat Mix, não
documentação pública):

- O SGP tem uma tela de **regras de notificação automática** (`Modificar
  SMS Aviso`) independente da tela de cadastro de gateway — cada regra
  escolhe qual **Gateway SMS** usar (`atendimento-whatsapp` no exemplo
  visto), com um valor padrão se não especificado.
- Para o gateway de texto livre (Baileys), o campo "Mensagem" da regra é
  texto puro com variáveis (`{cliente1}`, `{valor}`, `{vencimento}`,
  `{link}`, etc. — o SGP já substitui pelo valor real antes de chamar o
  gateway, confirmado pelo já-implementado).
- Para o gateway oficial, o Chat Mix usa **o mesmo endpoint/URL** do
  gateway de texto livre — só o `token` de autenticação muda entre os
  dois cadastros de "SMS Gateway" no SGP — e o campo "Mensagem" carrega
  uma sintaxe própria do Chat Mix:
  `variables={cliente}|{valor}|{vencimento}|{link}||header_link={link}||header_type=document||template=984`
  (as variáveis também vêm substituídas pelo SGP antes de chegar). O
  `template=984` é um ID interno do Chat Mix sem significado fora do
  sistema deles — não reaproveitável.
- A DW Telecom já tem **2 templates de cobrança aprovados pela Meta**,
  registrados através da plataforma do Chat Mix (a aprovação é vinculada
  à conta Meta Business/WABA, não ao Chat Mix — os templates existem de
  verdade na Meta e ficariam disponíveis para qualquer sistema que
  conecte a mesma WABA):
  - **Template A** (link no corpo, 4 variáveis — nome/valor/vencimento/link):
    ```
    Olá {{1}}, seu boleto chegou!

    A data de vencimento da sua fatura está chegando, e para te auxiliar
    no pagamento, seguem as informações do seu boleto:

    Valor: {{2}}
    Vencimento: {{3}}
    Boleto: {{4}}

    Qualquer dúvida quanto ao pagamento, entrar em contato com a nossa
    central de atendimento no: *0800 4454546*

    Atenciosamente, *DW Telecom.*
    ```
  - **Template B** (anexo de documento no cabeçalho em vez do link no
    corpo, 3 variáveis — nome/valor/vencimento): mesmo texto, sem o
    `{{4}}`/link no corpo.

**Bloqueio real, não impeditivo para o desenho:** a DW Telecom ainda não
tem nenhum canal Meta Cloud conectado *neste* sistema (só existe do lado
do Chat Mix) — o teste ponta-a-ponta real só é possível depois que esse
canal for criado e os templates forem registrados aqui.

## Modelo de dados

### `platform_integrations` deixa de ser um registro único por plataforma

Hoje: `UNIQUE(platform)`, um único canal/token para `'sgp'`. Passa a
suportar **múltiplos registros** — um por gateway cadastrado no SGP
(hoje: um para Baileys, outro para o oficial; a tabela já foi desenhada
com `platform` genérico pensando em plataformas futuras, esse ajuste
mantém essa extensibilidade).

```sql
ALTER TABLE platform_integrations
  DROP CONSTRAINT platform_integrations_platform_key,
  ADD COLUMN description TEXT NOT NULL DEFAULT '',
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'freetext' CHECK (mode IN ('freetext', 'template')),
  ADD COLUMN default_template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL;
```

(Constraint `platform_integrations_platform_key` confirmado por consulta
direta a `pg_constraint` antes de escrever esta migration — é o nome
padrão gerado pelo Postgres para o `UNIQUE(platform)` original.)

`mode` é **derivado do tipo do canal escolhido**, nunca informado
diretamente pelo admin: canal `baileys` → `'freetext'`; canal
`meta_cloud` → `'template'`. Isso remove uma fonte de inconsistência
(não dá para escolher um canal Baileys com modo `template`, por
exemplo). `default_template_id` só faz sentido quando `mode = 'template'`
— é um valor de conveniência (pré-seleciona um template ao configurar a
regra do SGP), mas **o template realmente usado em cada envio vem do
próprio `template=<nome>` da mensagem recebida**, não deste campo.

### `message_templates` ganha `header_type`

```sql
ALTER TABLE message_templates
  ADD COLUMN header_type TEXT CHECK (header_type IN ('document', 'image', 'video'));
```

Nulo = template sem cabeçalho de mídia (ex: Template A, que já usa o
link no corpo). Preenchido = o template espera um cabeçalho desse tipo
(ex: Template B, cabeçalho `document`).

### Nova forma de registrar um template: "registrar existente" (sem criar na Meta)

A tela de Templates ganha uma segunda opção ao lado de "Criar novo
template" (que continua existindo, sem mudanças). "Registrar template
existente" busca automaticamente o corpo/idioma/categoria/id-da-Meta a
partir do **nome** informado — evita risco de digitar o corpo errado e
o envio falhar por não bater com o texto realmente aprovado. Só o
**cabeçalho** (nenhum/documento/imagem/vídeo) é informado manualmente,
já que a listagem de templates da Meta usada aqui não expõe isso de
forma direta o bastante para inferir com segurança.

## Fluxo do endpoint (`GET /api/integrations/sgp/messages`)

A autenticação continua igual (busca por `token` na query string), mas
agora `verifySgpApiKey` pode encontrar **qualquer uma** das integrações
cadastradas, e o resultado passa a incluir também `mode` e
`defaultTemplateId`:

```js
// Novo contrato de verifySgpApiKey(candidateKey):
// { status: 'not_configured' }                                    // nenhuma integração 'sgp' existe
// { status: 'invalid' }                                            // existe(m), mas nenhum hash bate com a chave
// { status: 'disabled' }                                           // o hash bate, mas aquele registro está desativado
// { status: 'ok', channelId, mode, defaultTemplateId }             // bate e está ativo
```

(O status `no_key` do desenho singleton deixa de existir — num modelo de
múltiplos registros, um registro sem chave nunca é encontrado por
nenhum token possível, então cai naturalmente em `invalid` do ponto de
vista de quem chama; não há mais um "único" registro para relatar como
"sem chave ainda".)

Depois da autenticação e da checagem de duplicidade (`referenceId`,
inalterada), o handler carrega o canal e ramifica por `mode` — a forma
de validar o telefone (e até a checagem de conectividade do canal) já é
diferente entre os dois hoje, então essa ramificação acontece **antes**
da resolução de telefone, não depois. A checagem
`channel.status !== 'connected'` (400 "canal não conectado") continua
existindo **só para o ramo Baileys** — mesma regra que
`/start` já segue: o ramo Meta Cloud nunca checa `channel.status`,
porque canais Meta Cloud não têm um ciclo de vida de "conexão" (ficam
sempre prontos assim que configurados com credenciais válidas):

- **`mode = 'freetext'`** (Baileys — comportamento atual, sem mudança):
  confere `channel.status === 'connected'`, normaliza o telefone e
  resolve via
  `baileysManager.resolveWhatsAppJid(channel, normalizedPhoneNumber)`
  (400 se não estiver no WhatsApp), usa `content`
  (`phoneNumber`/`content` da query) como mensagem de texto direto.
- **`mode = 'template'`** (oficial): o telefone é só normalizado
  (dígitos), sem chamada equivalente a `resolveWhatsAppJid` — mesma
  regra que `/start`'s ramo Meta Cloud já usa hoje (a Cloud API não
  oferece uma checagem prévia de "este número está no WhatsApp"
  equivalente à do Baileys). `content` não é mais texto puro —
  vem no formato
  `variables=v1|v2|...|vN||header_link=<url>||header_type=<document|image|video>||template=<nome>`.
  Um novo parser (`parseSgpTemplatePayload`) separa por `||`, extrai a
  lista de `variables` (por `|`, primeiro segmento, prefixo
  `variables=`), e as demais partes como pares `chave=valor`
  (`header_link`, `header_type`, `template`). `header_link`/`header_type`
  são opcionais, mas devem aparecer **juntos ou nenhum dos dois** — um
  sem o outro é erro de configuração (400). O template é procurado pelo
  `name` na tabela local; se não encontrado, ou se a quantidade de
  variáveis não bater com `variableCount`, ou se `header_type` do
  payload não bater com o `header_type` cadastrado do template
  (proteção contra configurar o SGP errado), responde 400 com mensagem
  clara. Passando na validação, **reaproveita exatamente o caminho já
  usado por `POST /api/conversations/start`'s ramo Meta Cloud**: chama
  `enqueueOutboundMessage({conversationId, channelId, content: null,
  templateName, templateLanguage, templateVariables: variables,
  headerType, headerLink})` — passa pela mesma fila Bull, com o mesmo
  retry automático (`attempts: 3`, backoff exponencial) e o mesmo ciclo
  de vida de registro de mensagem (`sent` → `failed` em caso de erro,
  `message:updated` emitido se a conversa tiver atendente) já usados
  por qualquer outro envio deste sistema. `headerType`/`headerLink` são
  campos novos que precisam ser adicionados à assinatura de
  `enqueueOutboundMessage` (`src/queue/outbound-queue.js`) e repassados
  pelo job do Bull até `outbound-worker.js`.

## Cabeçalho de mídia na Meta Cloud (capacidade nova)

`src/whatsapp-adapters/meta-cloud.adapter.js`'s `sendTemplateMessage`
hoje só monta o componente `body` (variáveis), e
`src/queue/outbound-worker.js`'s ramo de template
(`templateName ? adapter.sendTemplateMessage(...) : ...`) só repassa
`name`/`language`/`variables`. Ambos ganham `headerType`/`headerLink`
opcionais: quando presentes, `sendTemplateMessage` monta também um
componente `header` referenciando a mídia **pelo link direto**
(`{type: headerType, [headerType]: {link: headerLink}}`) — a própria
Meta busca a URL, sem a gente precisar baixar/re-hospedar o arquivo.

## Área de admin

### Integrações — lista, não mais formulário único

Mesmo padrão visual/estrutural de Canais/Cidades: uma lista de cartões
(descrição, canal, modo — derivado e mostrado só como rótulo, ativo/
inativo, botão "Gerar nova chave" por linha) e um formulário abaixo para
cadastrar uma nova integração (descrição, canal — ao escolher um canal
`meta_cloud`, aparece um seletor de template padrão opcional listando
templates aprovados daquele canal; ao escolher `baileys`, esse seletor
não aparece). Nenhuma integração existente hoje (o registro único já em
produção) precisa de migração de dados — a `ALTER TABLE` já a mantém
válida (`description` cai no default `''`, editável depois pela mesma
tela; `mode` já nasce `'freetext'` por default, batendo com o canal
Baileys que já está configurado).

### Templates — nova opção "Registrar template existente"

Ao lado do formulário já existente "Criar novo template": um segundo
formulário com canal (`meta_cloud`), nome, idioma, e tipo de cabeçalho
(nenhum/documento/imagem/vídeo). Ao submeter, busca na Meta pelo
nome+idioma exatos, extrai corpo/categoria/id/quantidade de variáveis, e
grava local — sem chamar a API de criação de template da Meta.

## Erros e casos de borda

- `verifySgpApiKey` compara a chave recebida contra o hash de **cada**
  integração `'sgp'` cadastrada (bcrypt não permite busca indexada por
  texto puro) — com poucas integrações (hoje 1, logo 2) o custo é
  irrelevante; não é um padrão que escalaria bem para dezenas, mas está
  muito longe dessa escala aqui.
- Payload de template malformado (sem `variables=`, sem `template=`,
  `header_link` sem `header_type` ou vice-versa): 400 com mensagem
  específica de qual parte falhou.
- Template não encontrado pelo nome, quantidade de variável não bate, ou
  `header_type` do payload diferente do cadastrado no template: 400.
- Canal escolhido para uma integração `mode = 'template'` que não seja
  `meta_cloud`, ou vice-versa (canal `baileys` numa tentativa de
  configurar `template` manualmente): rejeitado na criação/edição da
  integração — mas como `mode` é sempre derivado do canal, isso só pode
  acontecer se o canal for trocado depois por um de tipo diferente
  mantendo o `mode` antigo; a edição sempre recalcula `mode` a partir do
  canal atual, então esse estado não é alcançável via a nossa própria
  API.

## Testes

- `sgp-integration.repository.test.js`: reescrito para múltiplos
  registros — `listSgpIntegrations`, `createSgpIntegration` (deriva
  `mode` do canal), `updateSgpIntegration`, `rotateSgpApiKey(id)`,
  `verifySgpApiKey` com 2+ integrações cadastradas (uma ativa batendo,
  uma desativada, uma com token totalmente diferente).
- Novo `sgp-template-payload-parser.test.js` (ou arquivo equivalente):
  casos de parse válido (com e sem cabeçalho), e todos os casos de erro
  listados acima.
- `integrations-sgp.routes.test.js`: novos testes para `mode = 'template'`
  (sucesso com e sem cabeçalho, template não encontrado, contagem de
  variável errada, header_type divergente) — os testes existentes de
  `mode = 'freetext'` continuam validando o caminho Baileys sem mudança
  de comportamento.
- `meta-cloud.adapter.test.js`: `sendTemplateMessage` com e sem
  header, confirmando o componente `header` correto por tipo.
- `template.service.test.js`/`template.repository.test.js`: nova função
  `registerExistingTemplate` (sucesso, nome não encontrado na Meta,
  canal não é meta_cloud) e `createTemplateRecord`/`toTemplate` cobrindo
  `headerType`.
- Frontend: `IntegrationsAdminTab` reescrito para lista (múltiplos
  cartões, criar novo com seletor de template quando o canal é
  `meta_cloud`); `TemplatesAdminTab` ganha o formulário de registrar
  existente.
- Tudo isso é testável com mocks, sem precisar de um canal Meta Cloud
  real conectado — o teste ponta-a-ponta de verdade fica para quando o
  canal for criado e os 2 templates existentes forem registrados.

## Migração

Duas migrations novas: alterar `platform_integrations` (remover
`UNIQUE(platform)`, adicionar `description`/`mode`/`default_template_id`)
e alterar `message_templates` (adicionar `header_type`). **⚠️ Rodar
`npm run migrate -- up` no Render Shell IMEDIATAMENTE após o deploy,
antes de qualquer disparo real do SGP** — diferente da maioria das
migrations deste projeto, esquecer esta quebra a integração Baileys que
JÁ ESTÁ em produção recebendo disparo automático real (não só a
funcionalidade nova): o código novo de `verifySgpApiKey` lê as colunas
`mode`/`description` em toda chamada, então sem a migration a *própria*
cobrança automática que já funciona para de funcionar com um 500.

## Fora de escopo

- Buscar/importar automaticamente TODOS os templates aprovados da Meta
  numa lista pra escolher (decisão explícita: só registrar por nome,
  um de cada vez).
- Suporte a mais de um cabeçalho por template, ou cabeçalho do tipo
  texto/localização (a Meta suporta, mas não é o caso de uso atual).
- Editar o texto de um template já registrado (mesma limitação que já
  existia antes desta spec — templates são imutáveis depois de
  aprovados pela Meta de qualquer forma).
- Migrar dados de configuração de dentro do Chat Mix automaticamente —
  o cadastro da nova integração + dos 2 templates existentes é feito
  manualmente pelo usuário nas telas novas.
