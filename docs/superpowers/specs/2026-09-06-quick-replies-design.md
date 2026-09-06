# Respostas rápidas (DW Telecom)

**Data:** 2026-09-06
**Status:** Aprovado para planejamento de implementação
**Estende:** [2026-09-04-whatsapp-attendance-system-design.md](2026-09-04-whatsapp-attendance-system-design.md)

## Contexto e motivação

Atendentes de suporte da DW Telecom respondem repetidamente às mesmas perguntas (horário de atendimento, instruções de reinício de roteador, status de pagamento, etc.), digitando o mesmo texto várias vezes ao dia. Hoje não existe nenhuma forma de salvar e reutilizar uma mensagem pronta — cada resposta é digitada do zero. Este recurso deixa um administrador cadastrar uma lista de respostas prontas, disponível para todos os atendentes escolherem durante o atendimento.

## Escopo

**Dentro do escopo:**
- Cadastro de respostas rápidas por um administrador (título + texto), compartilhadas com todos os atendentes.
- Qualquer atendente autenticado pode ver a lista e usar uma resposta durante um atendimento.
- Botão no campo de mensagem que abre a lista e preenche o texto ao escolher uma — o atendente pode editar antes de enviar, nada é enviado automaticamente.
- Editar e excluir uma resposta já cadastrada (só admin).

**Fora do escopo (fica para specs futuras):**
- Respostas pessoais por atendente (só existe a lista compartilhada, cadastrada por admin).
- Variáveis/placeholders (ex: substituir automaticamente pelo nome do cliente) — texto fixo por enquanto.
- Categorias ou pastas para organizar as respostas — lista simples, ordenada por título.
- Integração com templates da Meta (canal oficial) — spec própria, já identificada como item futuro separado, incluindo o refinamento levantado nas telas do Chat Mix mostradas pelo usuário (lá o "selecione a mensagem" pode oferecer tanto respostas rápidas comuns quanto templates aprovados, dependendo do canal).

## Decisão de arquitetura

### Modelo de dados

```sql
CREATE TABLE quick_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Sem coluna de dono/atendente — a lista é global, igual para todos. Sem soft-delete/`active`: como não é uma credencial nem uma conexão externa, excluir a linha diretamente é suficiente (nada mais no sistema referencia uma resposta rápida por id).

### Backend — rotas

Seguindo exatamente o padrão já estabelecido para canais (`GET /api/channels` vs `admin-channels.routes.js`) e para atendentes (`GET /api/agents` vs `admin-agents.routes.js`): a leitura fica aberta a qualquer atendente autenticado, a escrita fica restrita a admin, em arquivos de rota separados.

- **`src/api/quick-replies.routes.js`**, montada em `/api/quick-replies`: `GET /` (`requireAuth` apenas) — lista todas as respostas rápidas, ordenadas por título.
- **`src/api/admin-quick-replies.routes.js`**, montada em `/api/admin/quick-replies`: `POST /` (`requireAuth` + `requireRole('admin')`) cria (`title`, `content` obrigatórios, 400 se faltar); `PATCH /:id` edita (mesmos campos); `DELETE /:id` remove (404 se o id não existir).
- Nova camada de repositório, **`src/quick-replies/quick-reply.repository.js`**: `listQuickReplies()`, `createQuickReply({title, content})`, `updateQuickReply(id, {title, content})`, `deleteQuickReply(id)`.

### Frontend — administração

Uma terceira aba "Respostas rápidas" em `AdminChannelsPage` (ao lado de "Canais" e "Atendentes", mesmo padrão de abas já usado). Um formulário de criação no topo (título + texto), igual ao `CreateAgentForm`/`CreateChannelForm` já existentes. Abaixo, a lista de respostas cadastradas; cada item tem um botão "Editar" que transforma aquela linha num formulário inline (mesmos dois campos, com Salvar/Cancelar) — sem modal separado, já que é uma edição simples de texto — e um botão "Excluir" com o mesmo estilo dos botões destrutivos já usados no projeto.

### Frontend — uso pelo atendente

Um hook novo, `useQuickReplies()`, buscando uma vez via `GET /api/quick-replies` (mesmo padrão de `useAgents`/`useChannels`). Em `MessageInput`, um novo botão (ícone, ao lado dos botões de anexo e microfone já existentes) abre uma lista simples mostrando o título de cada resposta cadastrada. Ao clicar em uma, o campo de texto da mensagem passa a conter o `content` daquela resposta (substituindo o que já estava digitado) e a lista fecha — o atendente edita e envia normalmente pelo fluxo que já existe hoje, sem nenhuma mudança no caminho de envio.

## Testes

Mesmo padrão do projeto: testes de integração para as três rotas (repositório mockado) cobrindo os casos de validação (campos obrigatórios, 404 em editar/excluir um id inexistente, 403 para não-admin nas rotas de escrita); testes de componente para a aba de administração (criar, editar inline, excluir) e para o botão de respostas rápidas no `MessageInput` (abre a lista, selecionar uma preenche o campo).

## Próximos passos

Com o spec aprovado, o próximo passo é usar a skill `writing-plans` para transformar isso num plano de implementação detalhado.
