# Múltiplos Canais WhatsApp (Baileys dinâmico + administração de canais)

**Data:** 2026-09-05
**Status:** Aprovado para planejamento de implementação
**Estende:** [2026-09-04-whatsapp-attendance-system-design.md](2026-09-04-whatsapp-attendance-system-design.md)

## Contexto e motivação

O spec original previa 1 número não oficial fixo, conectado via Baileys. Na
prática, a DW Telecom já sabe que vai querer 2-3 números não oficiais em
breve — não é um caso hipotético a "deixar a porta aberta", é uma
necessidade concreta e próxima. Além disso, hoje adicionar um número oficial
(Meta Cloud) extra já é tecnicamente possível (o modelo de dados e o
adaptador do Plano 2 já suportam múltiplos canais do mesmo tipo), mas só via
script de linha de comando direto no servidor — não há uma forma prática de
fazer isso quando necessário, nem para números oficiais nem, ainda, para
não oficiais.

Este documento estende o spec original para que **adicionar um canal —
oficial ou não oficial — seja uma operação de administração do sistema em
funcionamento, não uma mudança de código nem uma tarefa de linha de comando
no servidor**.

## Escopo

**Dentro do escopo:**
- Gerenciador de conexões Baileys que suporta N números não oficiais
  simultâneos (não apenas 1), cada um com sua própria sessão persistida.
- API HTTP de administração de canais (listar, cadastrar Meta Cloud,
  cadastrar Baileys com fluxo de QR code via navegador).
- Reaproveitamento do motor de conversas (`ingestInboundMessage`) para que
  mensagens recebidas via Baileys sigam exatamente o mesmo caminho que
  mensagens recebidas via Meta Cloud (persistência + tempo real).
- Correção de uma lacuna existente: `outbound-worker.js` hoje sempre envia
  via o adaptador Meta Cloud, independente do tipo do canal — precisa
  escolher o adaptador certo por `channel.type`.

**Fora do escopo:**
- Frontend de verdade para a tela de administração de canais — por ora, a
  rota do QR code é uma página HTML simples o suficiente para ser usada
  direto no navegador, sem esperar o plano do frontend.
- Balanceamento de carga ou particionamento de canais entre múltiplos
  processos/instâncias — todos os canais (Meta e Baileys) continuam
  rodando no mesmo processo Node, mesma decisão do monólito modular já
  tomada no spec original.
- Migração ou reestruturação do schema do banco: a tabela `channels` já
  foi desenhada no Plano 2 com `type`, `status` (incluindo o valor
  `awaiting_qr`, já previsto), `config` (JSONB) e `phone_number` genéricos
  o bastante para múltiplos canais de qualquer tipo — nenhuma alteração de
  schema é necessária para este plano.

## Decisão de arquitetura

### Gerenciador de conexões Baileys

Novo módulo `src/whatsapp-adapters/baileys.manager.js`, responsável por
manter um socket Baileys ativo por canal `baileys` cadastrado — não um
único socket fixo. Cada conexão usa `@whiskeysockets/baileys` (o fork ativo
da biblioteca), com sessão de autenticação persistida em disco num
diretório próprio por canal: `<BAILEYS_SESSIONS_DIR>/<channelId>/`. A
variável `BAILEYS_SESSIONS_DIR` aponta para um diretório local em
desenvolvimento e para o Persistent Disk do Render em produção (pendência
de infraestrutura já registrada no spec original).

Responsabilidades do gerenciador:
- `startAllBaileysConnections()`: ao iniciar o servidor, busca todos os
  canais `type = 'baileys'` no banco e inicia uma conexão para cada um
  (a sessão salva evita escanear o QR de novo a cada reinício).
- `startBaileysConnection(channel)`: inicia (ou reinicia) a conexão de um
  canal específico. Reage a eventos do Baileys:
  - `connection.update` com `qr` presente → guarda o QR atual em memória
    (associado ao `channelId`), disponível para a rota de administração.
  - `connection.update` com `connection: 'open'` → marca o canal como
    `connected` no banco, limpa o QR guardado.
  - `connection.update` com `connection: 'close'` → se for uma queda
    recuperável (ex: rede), reconecta automaticamente; se for logout
    definitivo, marca o canal como `disconnected`, apaga a sessão em disco
    e exige um novo QR (via a rota de administração) para reconectar.
  - `messages.upsert` (mensagem recebida) → chama `ingestInboundMessage`
    (já existente, ver seção abaixo) com os campos normalizados.
- `sendTextMessage(channel, toPhoneNumber, content)`: mesma assinatura e
  formato de retorno (`{whatsappMessageId}`) do adaptador Meta Cloud, usando
  `sock.sendMessage(jid, { text: content })` do Baileys.
- `addBaileysChannel({ name, phoneNumber })`: cria a linha do canal no
  banco (via `createChannel`, já existente) com `type: 'baileys'` e chama
  `startBaileysConnection` imediatamente, para que o QR fique disponível
  assim que a rota de administração for consultada.

### API de administração de canais

Nova rota `src/api/admin-channels.routes.js`, montada em
`/api/admin/channels`, protegida por `requireAuth` + `requireRole('admin')`
(ambos já existentes desde o Plano 1):

- `GET /api/admin/channels` — lista todos os canais (id, type, name,
  phoneNumber, status).
- `POST /api/admin/channels` — cadastra um canal novo.
  - `{ type: 'meta_cloud', name, phoneNumber, phoneNumberId, accessToken }`
    → cria o canal já pronto para uso (mesmo caminho do
    `scripts/create-channel.js` existente, agora também acessível via API).
  - `{ type: 'baileys', name, phoneNumber }` → cria o canal e inicia a
    conexão Baileys; responde com o `id` do canal para a rota do QR.
- `GET /api/admin/channels/:id/qr` — renderiza uma página HTML simples com
  o QR code atual daquele canal (gerado como imagem a partir do texto do
  QR, biblioteca `qrcode`). Responde 404 se o canal não for Baileys, não
  existir, ou não estiver com status `awaiting_qr`.

**Autenticação da rota do QR:** como essa rota é pensada para ser aberta
diretamente no navegador (sem um frontend que injete o cabeçalho
`Authorization`), ela aceita o token JWT também via query string
(`?token=...`), além do cabeçalho `Bearer` já suportado por todas as
outras rotas. Essa é a única rota do sistema com essa exceção — decisão
deliberada para uma ferramenta interna de administração, documentada aqui
para não ser confundida com um padrão geral de autenticação.

### Reaproveitamento do motor de conversas

A lógica de decidir se uma mensagem recebida deve emitir `queue:new`
(broadcast, conversa sem atendente) ou `message:new` (direcionado, conversa
já atribuída) — hoje embutida na rota do webhook Meta Cloud — muda de lugar:
passa a viver dentro do próprio `ingestInboundMessage`
(`src/conversations/inbound-message.service.js`). Assim, tanto o webhook da
Meta quanto o gerenciador Baileys chamam a mesma função e ganham
persistência + tempo real de forma idêntica, sem duplicar a decisão em dois
lugares. A rota do webhook Meta Cloud fica mais simples: só repassa a
mensagem normalizada para `ingestInboundMessage`, sem se preocupar com
emissão de eventos.

### Correção do worker de envio

`src/queue/outbound-worker.js` hoje chama incondicionalmente o adaptador
Meta Cloud para enviar qualquer mensagem da fila — uma lacuna que passa a
ser um bug real assim que existir um canal Baileys na fila. O worker passa
a escolher o adaptador pelo `channel.type`:

```js
const adapters = {
  meta_cloud: require('../whatsapp-adapters/meta-cloud.adapter'),
  baileys: require('../whatsapp-adapters/baileys.manager'),
};
```

Ambos os adaptadores expõem `sendTextMessage(channel, toPhoneNumber, content)`
com a mesma assinatura, então a troca é transparente para o resto do worker.

## Testes

Como não é viável automatizar contra o WhatsApp real (mesma restrição já
registrada no spec original para os dois canais), o gerenciador Baileys é
testado mockando a biblioteca `@whiskeysockets/baileys` inteira (mesmo
padrão já usado para mockar `axios` no adaptador Meta Cloud) — os testes
verificam que a lógica do gerenciador reage corretamente aos eventos
emitidos pela biblioteca (QR recebido, conexão aberta/fechada, mensagem
recebida), não o comportamento real do protocolo WhatsApp. A API de
administração de canais é testada como as demais rotas do projeto: mocks
na camada de repositório/gerenciador, `requireAuth`/`requireRole` reais.

## Próximos passos

Com o spec aprovado, o próximo passo é usar a skill `writing-plans` para
transformar isso num plano de implementação detalhado.
