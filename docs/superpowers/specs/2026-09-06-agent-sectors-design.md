# Setores de atendentes (DW Telecom)

**Data:** 2026-09-06
**Status:** Aprovado para planejamento de implementação
**Estende:** [2026-09-04-whatsapp-attendance-system-design.md](2026-09-04-whatsapp-attendance-system-design.md)

## Contexto e motivação

Hoje o único agrupamento que existe para atendentes é o campo `role` (`agent`/`admin`) — não há nenhum conceito de equipe, departamento ou setor. A DW Telecom quer poder organizar atendentes por setor (ex: Financeiro, Comercial, Suporte Técnico) para fins organizacionais e como base para relatórios futuros (o dashboard de métricas planejado em seguida, por exemplo, poderá cruzar dados por setor).

## Escopo

**Dentro do escopo:**
- Admin cadastra, edita (renomeia) e exclui setores — uma lista compartilhada, igual à de respostas rápidas.
- Um atendente pode pertencer a zero, um ou vários setores ao mesmo tempo.
- Admin atribui/remove setores de qualquer atendente (inclusive os já existentes hoje, que nascem sem nenhum setor).
- A lista de atendentes na tela de administração mostra os setores de cada um.

**Fora do escopo (fica para specs futuras, se necessário):**
- Roteamento da fila por setor — a fila de atendimento continua única, visível a todos os atendentes, exatamente como hoje. Setor é só organização/relatório, não afeta quem vê qual conversa.
- Qualquer mudança no fluxo de transferência de conversa (`TransferModal` continua listando todos os atendentes, sem filtro por setor).
- Dashboard de métricas em si (spec própria, já identificada como próximo item da fila).

## Decisão de arquitetura

### Modelo de dados

```sql
CREATE TABLE sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_sectors (
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  sector_id UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, sector_id)
);
```

`agent_sectors` é uma tabela de ligação simples (muitos-para-muitos): um atendente pode estar em vários setores, um setor pode ter vários atendentes. `ON DELETE CASCADE` nas duas pontas — excluir um setor remove as ligações dele automaticamente (sem exclusão suave, mesmo padrão já usado em `quick_replies`); excluir um atendente (hoje isso não acontece, atendentes só são desativados, mas a constraint fica correta de qualquer forma) também limparia as ligações.

### Backend

Seguindo o padrão já estabelecido (canais, respostas rápidas): leitura aberta a qualquer atendente autenticado, escrita restrita a admin, em arquivos de rota separados.

- **`src/sectors/sector.repository.js`**: `listSectors()`, `createSector({name})`, `updateSector(id, {name})`, `deleteSector(id)`, `setAgentSectors(agentId, sectorIds)` (substitui por completo o conjunto de setores daquele atendente — apaga as ligações existentes e insere as novas, numa transação).
- **`src/api/sectors.routes.js`**, montada em `/api/sectors`: `GET /` (`requireAuth` apenas) — lista todos os setores.
- **`src/api/admin-sectors.routes.js`**, montada em `/api/admin/sectors`: `POST /` cria (`name` obrigatório), `PATCH /:id` renomeia, `DELETE /:id` remove — todas admin-only.
- Nova rota em `src/api/admin-agents.routes.js`: `PUT /:id/sectors`, admin-only, corpo `{sectorIds: [...]}` — chama `setAgentSectors`. Reaproveita a rota já existente, não cria um arquivo novo.
- `GET /api/admin/agents` (já existente) passa a incluir os setores de cada atendente na resposta (`sectors: [{id, name}]`), via um `LEFT JOIN` com `agent_sectors`/`sectors` agregado por `json_agg`, seguindo o mesmo estilo de `JOIN` já usado em `conversation.repository.js`.

### Frontend

Uma quarta aba "Setores" em `AdminChannelsPage` (ao lado de Canais, Atendentes, Respostas rápidas), com um componente `SectorsAdminTab` — mesmo padrão de `QuickRepliesAdminTab` (formulário de criação, lista com editar-inline e excluir), só que mais simples: um único campo, o nome.

Na aba "Atendentes" já existente (`AgentsAdminTab`), cada linha passa a mostrar os setores do atendente (nomes separados por vírgula, ou "Nenhum setor" se vazio) e ganha um link "Editar setores" que expande a linha numa lista de checkboxes — uma por setor cadastrado, marcadas conforme o atendente já pertence ou não — com um botão "Salvar" que chama `PUT /api/admin/agents/:id/sectors` com a lista de ids marcados.

## Testes

Mesmo padrão do projeto: testes de integração para as rotas (repositório mockado) cobrindo validação, 404, 403; testes de componente para a nova aba de setores (criar, editar, excluir) e para a edição de setores de um atendente na aba "Atendentes" (marcar/desmarcar, salvar, ver a lista atualizada).

## Próximos passos

Com o spec aprovado, o próximo passo é usar a skill `writing-plans` para transformar isso num plano de implementação detalhado.
