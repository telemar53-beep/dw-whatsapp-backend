# Suporte a mensagens de mídia (DW Telecom)

**Data:** 2026-09-06
**Status:** Aprovado para planejamento de implementação
**Estende:** [2026-09-04-whatsapp-attendance-system-design.md](2026-09-04-whatsapp-attendance-system-design.md)

## Contexto e motivação

O sistema hoje (backend e frontend completos, em produção) só processa mensagens de texto — tanto o adaptador Meta Cloud quanto o Baileys descartam silenciosamente qualquer mensagem que não seja texto puro (`parseInboundMessages` filtra `message.type !== 'text'`; `extractTextContent` só reconhece `conversation`/`extendedTextMessage`). Isso é um bloqueador real para substituir o Chat Mix no atendimento de verdade: clientes de uma ISP mandam com frequência foto de comprovante de pagamento, PDF de comprovante, áudio, e link de localização da casa — tudo isso precisa chegar para quem está atendendo. O atendente também precisa poder mandar arquivos de volta ao cliente (não só receber).

## Escopo

**Dentro do escopo:**
- Recebimento (inbound) de imagem, documento, áudio, vídeo, sticker e localização, nos dois canais (Meta Cloud e Baileys).
- Envio (outbound) de imagem, documento, áudio e vídeo pelo atendente, nos dois canais.
- Armazenamento dos arquivos no disco persistente do Render (já usado hoje para as sessões do Baileys).
- Exibição de cada tipo de mídia na tela de conversa do frontend.

**Fora do escopo (fica para specs futuras, já identificadas em conversa com o usuário):**
- Cadastro de atendentes pela tela de administração (hoje só via script de linha de comando).
- Histórico de atendimentos anteriores do mesmo cliente, visível durante o atendimento atual.
- Atendente iniciar uma conversa nova digitando o número do cliente, incluindo cadastro e acompanhamento de aprovação de *templates* de mensagem da Meta (obrigatórios para iniciar conversa pelo número oficial fora da janela de 24h).
- Respostas rápidas/mensagens prontas configuráveis pelo atendente.
- Indicador de quais atendentes estão online.

## Decisão de arquitetura

### Modelo de dados

Cada mensagem do WhatsApp carrega no máximo um arquivo — o protocolo não tem "mensagem com múltiplos anexos" — então a extensão é feita com novas colunas na própria tabela `messages` (não uma tabela separada):

```sql
ALTER TABLE messages
  ALTER COLUMN content DROP NOT NULL,
  ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'sticker', 'location')),
  ADD COLUMN media_path TEXT,
  ADD COLUMN media_mime_type TEXT,
  ADD COLUMN media_filename TEXT,
  ADD COLUMN location_latitude DOUBLE PRECISION,
  ADD COLUMN location_longitude DOUBLE PRECISION;
```

`content` deixa de ser obrigatório: continua guardando o texto da mensagem quando `message_type = 'text'`, e passa a guardar a legenda (*caption*) opcional de uma foto/vídeo/documento quando houver uma (`NULL` quando não houver). `media_path` é o caminho relativo do arquivo no disco (preenchido para `image`/`document`/`audio`/`video`/`sticker`, `NULL` para `text`/`location`). `location_latitude`/`location_longitude` só são preenchidos para `message_type = 'location'` — uma localização não é um arquivo, é só um par de coordenadas.

### Módulo de armazenamento de mídia

Novo módulo `src/media/media-storage.js`, isolando toda a leitura/escrita de arquivo em disco:
- `saveMediaFile(buffer, extension) -> relativePath` — grava o arquivo dentro de `MEDIA_STORAGE_DIR` (nova variável de ambiente obrigatória, seguindo o mesmo padrão de `BAILEYS_SESSIONS_DIR` — em produção aponta para uma subpasta do mesmo disco persistente do Render já usado pelo Baileys, ex: `/var/data/media`) com um nome gerado (UUID + extensão), evitando colisão de nomes.
- `getMediaFilePath(relativePath) -> caminho absoluto` — usado apenas internamente pela rota que serve o arquivo.

### Rota de servir mídia

Nova rota `GET /api/media/:messageId`, protegida por `requireAuth` — qualquer atendente autenticado pode acessar (mesmo nível de acesso já usado hoje em `GET /api/conversations/:id/messages`, que não restringe por atendente atribuído). Antes de servir o arquivo, a rota confirma apenas que a mensagem existe e tem um `media_path`; os arquivos nunca ficam acessíveis sem token, já que podem conter dados sensíveis do cliente (comprovantes). Como essa rota precisa ser carregada diretamente por elementos HTML (`<img>`, `<audio>`, `<a>` de download) que não conseguem mandar um cabeçalho `Authorization`, ela aceita o token também via `?token=` na query string — a mesma exceção documentada e já aprovada para a rota do QR code do Baileys (`GET /api/admin/channels/:id/qr`). A partir deste spec, a regra passa a ser: **rotas que servem um recurso para ser carregado diretamente por um elemento HTML (imagem, áudio, iframe), sem JavaScript intermediário para injetar o cabeçalho, podem aceitar o token por query string** — continua sendo a exceção, não o padrão geral de autenticação do sistema.

### Recebimento (inbound)

**Meta Cloud:** `parseInboundMessages` passa a reconhecer `image`, `document`, `audio`, `video`, `sticker` (que carregam um `media.id`, não o arquivo em si) e `location` (que carrega `latitude`/`longitude` diretamente no payload, sem arquivo). Para os tipos com `media.id`, o adaptador faz duas chamadas HTTP à Graph API antes de considerar a mensagem processada: `GET /v20.0/{media-id}` (retorna uma URL de download temporária, que expira em poucos minutos, e o `mime_type`), depois um `GET` nessa URL com o `access_token` do canal no cabeçalho para baixar os bytes — só então salva via `media-storage.js` e segue para `ingestInboundMessage`.

**Baileys:** `handleMessagesUpsert` passa a reconhecer `imageMessage`, `documentMessage`, `audioMessage`, `videoMessage`, `stickerMessage` e `locationMessage`. Para os tipos com arquivo, usa a função `downloadMediaMessage` já embutida na biblioteca `@whiskeysockets/baileys` (baixa e decodifica automaticamente, sem chamadas HTTP manuais) e salva o resultado via `media-storage.js`.

Em ambos os casos, `ingestInboundMessage` (já existente) ganha os novos campos (`messageType`, `mediaPath`, `mediaMimeType`, `mediaFilename`, `locationLatitude`, `locationLongitude`, todos opcionais/`null` por padrão) sem duplicar a lógica de fila/atribuição/tempo real que já funciona hoje para texto — o mesmo caminho serve os dois tipos de conteúdo.

### Envio (outbound)

No frontend, um botão de anexo no `MessageInput` abre o seletor de arquivo do sistema operacional; ao escolher um arquivo, a requisição para `POST /api/conversations/:id/messages` passa a ser enviada como `multipart/form-data` (arquivo + legenda opcional) em vez de JSON puro quando há um anexo — o backend usa a biblioteca `multer` (nova dependência) para processar o upload.

Um limite de tamanho é aplicado na validação de entrada, usando os mesmos limites que a própria API oficial do WhatsApp já impõe (para não deixar o atendente tentar enviar algo que o WhatsApp rejeitaria de qualquer forma): 16 MB para imagem/áudio/vídeo, 100 MB para documento.

O arquivo recebido é salvo via `media-storage.js`, a mensagem outbound é criada com os novos campos preenchidos e enfileirada como hoje — o worker de saída, ao processar, escolhe por canal:
- **Meta Cloud:** precisa primeiro subir o arquivo para os servidores da Meta (`POST /v20.0/{phone-number-id}/media`, multipart, retorna um ID), e só depois enviar a mensagem referenciando esse ID.
- **Baileys:** manda o arquivo direto na própria mensagem (`sock.sendMessage(jid, { image: buffer, caption }, ...)` ou equivalente por tipo), sem passo de upload prévio.

### Frontend

`ConversationView` passa a renderizar cada mensagem de acordo com `message_type`:
- `image`/`sticker` → miniatura clicável (abre em tamanho maior)
- `document` → ícone + nome do arquivo + link de download
- `audio` → player de áudio embutido (`<audio controls>`)
- `video` → player de vídeo embutido (`<video controls>`)
- `location` → link "Ver no mapa" (URL do Google Maps montada a partir de `location_latitude`/`location_longitude`)

Todo arquivo é buscado pela rota autenticada `GET /api/media/:messageId?token=...` — mesmo padrão do `QrCodeView` já existente.

## Testes

Mesmo padrão já usado no projeto inteiro: os adaptadores continuam mockados por completo nos testes automatizados (nunca contato real com a Meta/WhatsApp). Ao final da implementação, um teste manual real — como já foi feito para validar o Baileys — mandando de propósito uma foto, um PDF, um áudio e uma localização de um WhatsApp de teste, e enviando cada tipo de volta pelo atendente, confirmando ponta a ponta.

## Próximos passos

Com o spec aprovado, o próximo passo é usar a skill `writing-plans` para transformar isso num plano de implementação detalhado. As demais ideias levantadas durante o brainstorming (cadastro de atendentes pela tela de admin, histórico de atendimentos anteriores, iniciar conversa + templates da Meta, respostas rápidas, indicador de atendentes online) ficam registradas como próximos specs, fora do escopo deste documento.
