# Integração OpenAI — pendências e decisões em aberto

Companheiro de `2026-09-11-openai-integration-design.md`. Registra o que ficou
deliberadamente de fora da Fase 1, para não se perder.

## Decisões de produto que precisam ser suas

### 1. A primeira mensagem do cliente não recebe nem menu nem rascunho

Num canal com IA ligada, `shouldStartTriage` devolve `false`, e o modo Assistente
só rascunha para conversa **já atribuída** a um atendente. A sequência real é:

```
cliente escreve → sem menu, sem setor, sem rascunho → entra na fila
→ atendente assume → ainda sem rascunho
→ cliente escreve DE NOVO → aí a IA rascunha
```

Isso é coerente com o plano aprovado, mas muda a expectativa no dia 1: o menu
numérico roteava por setor logo na primeira mensagem, e a IA não faz isso.

Saídas possíveis, todas fora do escopo atual:
- agendar um turno de IA também no momento em que o atendente assume;
- permitir sugestão em conversa não atribuída, emitindo para a fila;
- manter a triagem ligada e usar IA só depois do atendente assumir — exigiria
  soltar a regra "um robô por canal".

### 2. `buscar_cliente` não verifica se quem está no WhatsApp é dono do CPF

Quem souber um CPF obtém nome, plano, status do contrato, status da conexão e
faturas. Na Fase 1 existe um humano entre o rascunho e o cliente, o que contém o
risco. **No modo Automático isso vira enumeração de base de clientes por
qualquer pessoa.**

Antes da Fase 2, decidir um fator de confirmação — data de nascimento, últimos
dígitos do contrato, ou outro dado que o cliente saiba e um terceiro não.

### 3. `transferir_atendimento` grava setor mesmo em modo Assistente

A ferramenta escreve `conversations.sector_id` no momento em que o modelo a
chama, antes de o atendente decidir se envia ou descarta o rascunho. Se ele
descartar, o setor continua trocado, sem reversão e sem aviso.

Mitigação da Fase 1: **manter a ferramenta desligada** (o padrão já é desligado).
Correção real, para a Fase 2: a ferramenta devolve a intenção e a gravação
acontece quando o atendente aceita.

## Antes de ligar num canal de produção

- Conferir que `ai_tool_permissions` está vazia ou só com ferramentas de
  consulta. O padrão nega tudo; nada é habilitado sozinho.
- Deixar `transferir_atendimento` e `definir_motivo_atendimento` desligadas até
  decidir o item 3.
- Avisar os atendentes que o campo de digitação virou multi-linha: **Enter envia,
  Shift+Enter quebra linha.** É a única mudança deste branch visível para quem
  nunca usar a IA.

## Operação

- **Nunca rodar `migrate down` com este código no ar.** A migração é aditiva e
  segura de aplicar, mas o código novo faz `SELECT` explícito de `ai_enabled`,
  `sgp_client_id`, `sgp_document`, `suggested_reason_id` e `sent_by` em dezenas
  de consultas do caminho quente. Reverter o schema quebra o sistema inteiro,
  não só a IA. (A spec dizia que a ordem era indiferente; está errada nesse
  ponto — o Render roda `migrate up` no build, que é o fluxo correto.)
- `ai_interactions` cresce a cada interação e guarda a resposta final. Definir
  retenção antes que vire um problema.
- Se a tabela `messages` já for grande, notar que a migração adiciona o CHECK de
  `sent_by` com validação da tabela inteira (lock ACCESS EXCLUSIVE durante o
  scan). Em base pequena é instantâneo; em base grande, `NOT VALID` seguido de
  `VALIDATE CONSTRAINT` evitaria o bloqueio.

## Achados menores adiados

Trinta e oito itens foram identificados nas revisões e deliberadamente não
corrigidos, para não estender os ciclos. Agrupados:

| Grupo | Qtd | Natureza |
|---|---|---|
| Testes faltando | 9 | `GET` devolvendo null, 404 de conversa inexistente, `normalizeClient`, guardas de `scheduleAiReply` |
| Endurecimento hoje inalcançável | 6 | `toOpenAiTools(undefined)`, `COALESCE` em `model`/`mode`, rejeitar array em `checkConnection`/`listInvoices` — todos protegidos por validação a montante |
| Idioma e estilo | 7 | `SELECT *` vs colunas, `WHERE id = 1` literal, `traduzErro` em português num módulo inglês, `?.` vs `&&`, desempate de `ORDER BY` |
| UI/UX | 4 | "Modelo é obrigatório" bloqueando config desativada; `CATEGORY_ORDER` fixo; envio de sugestão editada perde o "respondendo a" |
| Higiene de teste | 3 | spy de `Date.now` sem `finally`; um teste que virou tautológico após a correção 1; `consoleSpy.mockRestore` fora de `finally` |
| Inexatidões de relatório | 5 | contagens e números de linha errados em relatórios de rascunho — já cumpriram seu papel, podem ser descartados |
| Resolvidos por outra correção | 4 | incluindo o `detalhe` do `execution_error`, fechado ao mandar só o `motivo` ao modelo |

Nenhum deles bloqueia merge. A revisão final os triou explicitamente.

## Dívida identificada e não fechada

- `maskDocument` revela 7 dos 11 dígitos de um CPF (`529.***.**4725`). Aceitável
  na superfície atual de ferramentas; revisar se mais dados sensíveis entrarem.
- Mensagens de erro do admin chegam em inglês numa tela em português
  (`No API key configured`, e as do cliente OpenAI). A correção certa é o
  frontend detectar o caso — ele já sabe `configured: false` — em vez de
  traduzir string de API.
- Quando a IA classifica o motivo do atendimento, nada empurra a conversa
  atualizada para a tela aberta; a pré-seleção só aparece num carregamento
  posterior. Falta um evento de socket.
