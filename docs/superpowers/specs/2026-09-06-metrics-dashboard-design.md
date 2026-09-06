# Dashboard de métricas e produtividade (DW Telecom)

**Data:** 2026-09-06
**Status:** Aprovado para planejamento de implementação
**Estende:** [2026-09-04-whatsapp-attendance-system-design.md](2026-09-04-whatsapp-attendance-system-design.md)

## Contexto e motivação

Hoje não existe nenhuma forma de medir produtividade ou desempenho do atendimento — nem para o admin acompanhar a equipe, nem para um atendente ver o próprio desempenho. Este recurso adiciona uma tela de métricas, calculadas em tempo real a partir dos dados que já existem (conversas, eventos de conversa, mensagens), sem precisar de nenhuma tabela nova de "métricas salvas".

## Escopo

**Dentro do escopo:**
- Quatro métricas: atendimentos por atendente, tempo médio de atendimento, tempo médio de primeira resposta, atendimentos por setor.
- Três períodos fixos: hoje, últimos 7 dias, últimos 30 dias.
- Um atendente comum vê só os próprios números (atendimentos fechados, tempo médio de atendimento, tempo médio de primeira resposta — todos calculados só com as conversas dele).
- Um admin vê a visão completa: os mesmos números por atendente (comparando a equipe) e o gráfico de atendimentos por setor.
- Exibição em gráficos, usando uma biblioteca de gráficos nova no projeto.

**Fora do escopo (fica para specs futuras, se necessário):**
- Período customizável (seletor de datas livre) — só os três períodos fixos por enquanto.
- Exportar relatório (PDF/CSV).
- Métricas de triagem/automação — dependem do recurso de triagem, que ainda não existe.
- Qualquer tabela de "métricas salvas"/histórico agregado — tudo é calculado na hora, direto das tabelas existentes.

## Decisão de arquitetura

### Cálculo de cada métrica

Nenhuma tabela nova — tudo consultado direto de `conversations`, `conversation_events` e `messages`, sempre filtrado pelo período escolhido.

- **Atendimentos por atendente:** conta de linhas em `conversation_events` com `event_type = 'closed'` e `created_at` dentro do período, agrupado por `from_agent_id` (o atendente que efetivamente fechou a conversa — mais preciso que `conversations.assigned_agent_id`, que reflete só o estado atual e pode ter mudado por transferência).
- **Tempo médio de atendimento:** média de (`conversation_events.created_at` do evento `'closed'`) menos `conversations.created_at`, para as conversas fechadas no período.
- **Tempo médio de primeira resposta:** média de (menor `messages.created_at` com `direction = 'outbound'` naquela conversa) menos `conversations.created_at` — tempo real até o cliente receber uma resposta, não o tempo até alguém assumir a conversa. Conversas sem nenhuma mensagem outbound ainda ficam de fora dessa média.
- **Atendimentos por setor:** mesma base do "atendimentos por atendente" (eventos `'closed'` no período, por `from_agent_id`), mas agrupado pelos setores daquele atendente via `agent_sectors`/`sectors`. Como um atendente pode estar em vários setores, o atendimento dele conta para *todos* os setores dele — a soma entre setores pode passar do total geral, isso é esperado.

### Backend

Uma única rota, `GET /api/metrics?period=today|7d|30d` (`requireAuth` apenas — sem `requireRole('admin')`, já que atendente comum também acessa). O **backend** decide o que devolver com base no papel de quem pediu (nunca o frontend escondendo dados só visualmente):
- Atendente comum (`role = 'agent'`): recebe só os três números calculados com `from_agent_id` igual ao próprio id.
- Admin: recebe os mesmos três números por atendente (lista, um item por atendente que teve pelo menos um atendimento no período) e a lista de atendimentos por setor.

Nova camada, `src/metrics/metrics.repository.js`, isolando as consultas SQL de agregação.

### Frontend

Um link "Métricas" no cabeçalho do `DashboardPage` (ao lado de "Trocar senha"/"Sair"), visível para qualquer atendente, levando a uma nova página (`/metrics`). Botões de período fixo no topo (Hoje / Últimos 7 dias / Últimos 30 dias). Gráficos com a biblioteca **Recharts** (nova dependência no `frontend/package.json`, mas leve e o padrão de facto para gráficos em React). Um atendente comum vê cartões com os três números próprios; um admin vê um gráfico de barras comparando os atendentes e outro com os setores.

## Testes

Mesmo padrão do projeto: testes de integração para a rota (repositório mockado) cobrindo os dois papéis (admin recebe a visão completa, atendente recebe só a própria); testes de unidade para as consultas de agregação do repositório, usando o banco de teste real (mesmo padrão de `channel.repository.test.js`); testes de componente para a nova tela (troca de período, admin vê os gráficos extras, atendente não vê).

## Próximos passos

Com o spec aprovado, o próximo passo é usar a skill `writing-plans` para transformar isso num plano de implementação detalhado.
