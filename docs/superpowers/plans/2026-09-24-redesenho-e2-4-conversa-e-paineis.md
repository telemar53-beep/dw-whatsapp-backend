# E2.4 — Conversa e painéis — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar a conversa — vocabulário único de estado, CSS da conversa morando com ela, bolha memoizada, cabeçalho de 2 linhas sem a barra de contexto, painel Cliente que reúne o que saiu da vista e onde o cliente é editado, painel SGP numa superfície só com o QR sob demanda e o aviso de atendimento encerrado, compositor com popovers ancorados e inserção no cursor, e as faixas acima do compositor.

**Architecture:** A `ConversationView` (1.028 linhas) perde três pedaços para componentes próprios: `MessageBubble` (a linha da linha do tempo, com `memo`), `PainelCliente` (dados + edição + setor, substitui o `CustomerPanel` interno, o `EditContactModal` e o conteúdo do `ConversationInfoPanel`) e `CabecalhoDaConversa`. O CSS da conversa sai de `pages/dashboard.css` (carregado só pela mesa — por isso o modal de conversa aberto direto na Supervisão ficava sem estilo) e vira utilitário no próprio JSX; o layout do painel (coluna de 268 px ou substituição) é escolhido pelo estado do React, sem folha de estilo. Os popovers do compositor passam à `Popover` da E2.2 (camada leve), e o painel lateral entra na pilha como camada leve.

**Tech Stack:** React 18.3, Tailwind 4.3 (tokens E2.1), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-24-redesenho-simplicidade-design.md` (5.8, 6.3, 6.4, 9, 14.1 decisões 4 e 9), Apêndice B (B.3, B.4), Apêndice E (E.2: Editar cliente, Conversa em modal + painel de informações, Emojis, Respostas rápidas, Alerta) e anexos `grupo-B.md` (§2, §4–§6) e `grupo-C.md` (§2). Plano mestre: `docs/superpowers/plans/2026-09-24-redesenho-e2-mesa-de-atendimento.md`.

> **Provado antes da aprovação (24/09/2026):** as Tasks 1 a 7 e o Step 1 da Task 8 foram aplicadas a partir deste texto numa cópia descartável do frontend com a E2.1 (Tasks 1, 2, 3, 5 e 6) e a E2.2 aplicadas (`scratchpad/e24-prova/`, fora do repositório), por um auditor, e os pontos que mudaram o texto foram conferidos de novo contra o código. Resultados: todos os testes novos falham antes e passam depois, salvo os listados como "passam antes" (agora com uma asserção que prova); as mutações do `memo`, do callback estável e da guarda do salvamento pegam; suíte cheia 1.690 → 1.735 testes sem falha nova além das que dependem de tarefa da E2.1 não aplicada na cópia (`Button` em tokens, `font-wa`); `ConversationView-*.js` 131,7 → 111,2 kB (gz 41,7 → 33,0) com o `qrcode` em chunk próprio (24,5 kB); `DashboardPage-*.css` 17,5 → 8,7 kB; CSS de entrada 104,5 → 98,8 kB. Erros do plano achados assim e corrigidos no texto: a ordem das Tasks 3 e 4 (a edição do cliente ficava inalcançável entre as duas — o painel Cliente agora vem antes do cabeçalho); `conversationStatus` apagado cedo demais; três testes de outras páginas e um de `ConversationListItem` que dependiam do cabeçalho e dos tiques antigos; o critério do build do `qrcode`; um teste que faltava para a posição do cursor com o foco no campo (a mutação não pegava); o setor sumindo da tela enquanto os setores carregam; a regra das pendências do acento, que precisa rodar em toda tarefa. O `IconSpark` que a cópia não achava em `IconesTrabalho` é da cópia (módulos de antes do ajuste de 24/09 do Apêndice D), não do plano.
>
> **Prova em cadeia (24/09/2026):** as Tasks 1 a 7 rodaram de novo numa cópia com E2.1, E2.2 e E2.3 aplicadas, seguidas da E2.5 inteira (`scratchpad/e25-prova/`, arquivada em `D:\dw-redesenho-arquivo\2026-09-24\`). Ela achou mais erros deste texto, corrigidos nos trechos marcados **[Prova na cópia, 24/09/2026]**: o **override parcial do contato** — trocar o setor apagava o nome do cabeçalho, e nota e cidade apagadas voltavam; defeito real que nenhum teste pegava; o teste que achava "Financeiro" duas vezes; os dois testes de salvar que estavam só em prosa; o aviso de encerrado que ninguém ligava na `DashboardPage` (a E2.3 e a E2.4 deixavam um para o outro); e duas sobras de CSS (`--chat-ai-chip*`, `.dialog-contact-fields`). O texto corrigido rodou numa cópia de verificação: suíte com 1.780 testes passando e só as 3 falhas antigas de `api.qr`; build ok; cada teste novo falha quando o defeito que ele cobre volta (mutação).

## Global Constraints

Valem as do plano mestre. As que mais pesam aqui:

- **Correções da E1/E1.1 não regridem:** `ConversationView.trocaDeConversa.test.jsx` inteiro (CLASSE-01, "carregar anteriores", âncora da rolagem), `useRolagemDaLinhaDoTempo.test.jsx` (33), `useConversationMessages.test.jsx` (paginação 50 + sonda, 20 s, mescla da carga inicial), `useSgpLookup.test.jsx` (a busca mais recente vence). `data-mensagem-id` fica **no elemento da linha inteira**, filho da linha do tempo; separador de dia nunca o tem; `memorizarPosicao()` é chamada no clique **antes** de `carregarAnteriores()`.
- **Estado do chat sobrevive à troca de conversa** (`ConversationView` e `MessageInput` não remontam): todo estado novo desta etapa — modo edição do cliente, rascunho do formulário, setor em salvamento, popover aberto, alerta, histórico, envio de template — **zera na troca de `conversation.id`**, com teste.
- **Invariantes da seção 9:** painel nunca cobre as mensagens (coluna de 268 px ou substituição com "Voltar à conversa"); conversa ≥ 420 px; teto do compositor relativo à janela (`MessageInput.test.jsx` 683×384 → ≤ 173 px; 1080 → 320 px); popover não vira modal (emojis `role="dialog"` não modal, respostas `role="menu"`); um `role="status"` por tela; `aria-live` ≠ `role="status"`.
- **Pix nunca mostra o código** fora do cartão (regra existente).
- **Decisão 4:** cobrança do SGP a partir de atendimento encerrado **continua**, com o aviso "Atendimento encerrado — a cobrança vai direto ao cliente" no painel. Nenhum envio é bloqueado.
- **Decisão 9:** resposta rápida com o campo vazio preenche; com texto, **insere no cursor** (substituindo só a seleção).
- **Pendências do acento em toda tarefa:** o passo de verificação de cada tarefa roda também `src/estilo`; arquivo que ficou limpo sai de `PENDENCIAS` na mesma tarefa — o teste "a lista só encolhe" falha enquanto um arquivo limpo continua na lista (a prova em cópia viu a suíte vermelha da Task 6 à Task 8 por isso). O Step 1 da Task 8 vira conferência.

## Review Focus

- **Resposta que chega depois da troca de conversa.** Salvar o cliente com a rede lenta e trocar de conversa: o nome de A não pode aparecer no cabeçalho de B (CV-EDC-13, CLASSE-01). Teste na Task 3.
- **ESC com o painel SGP aberto dentro do modal da Supervisão.** O 1º ESC fecha o painel, o 2º o modal (CVM-MOD-10). O painel nasce aberto junto com a conversa (conversa com CPF) — é exatamente o caso que a camada leve da E2.2 resolve por `useEffect`. Teste na Task 4.
- **Enter depois de escolher emoji pelo teclado.** Hoje o 1º Enter escolhe, leva o foco ao campo, e o 2º Enter envia a mensagem (N6). Passa a manter o foco na grade. Teste na Task 6.
- **Inserir no cursor com emoji de duas unidades.** `✌️` e `❤️` têm seletor de variação: a posição do cursor depois da inserção tem de ficar depois do emoji inteiro. Teste na Task 6.
- **Link da fatura em atendimento encerrado.** O backend recusa o texto com 409 (rota de mensagens) e aceita Pix/QR/código/PDF: o aviso não pode prometer que "tudo" vai ao cliente, e o erro do link aparece como hoje. Teste na Task 5.

---

## Arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `frontend/src/utils/estadoDaConversa.js` (+ `.test.js`) | Criar | vocabulário único (P5) |
| `frontend/src/estilo/cssDaConversa.test.js` | Criar | `dashboard.css` sem regra da conversa |
| `frontend/src/components/MessageStatusTicks.jsx` (+ teste) | Reescrever | tiques com nome acessível |
| `frontend/src/components/MessageBubble.jsx` | Criar | linha da linha do tempo, com `memo` |
| `frontend/src/components/ConversationView.bolhas.test.jsx` | Criar | 1 render de bolha por mensagem recebida |
| `frontend/src/components/CabecalhoDaConversa.jsx` | Criar | cabeçalho de 2 linhas + ações |
| `frontend/src/components/PainelCliente.jsx` (+ `.test.jsx`) | Criar | dados, edição e setor |
| `frontend/src/components/EditContactModal.jsx` (+ teste) | Apagar | a edição vai ao painel |
| `frontend/src/components/ConversationInfoPanel.jsx` (+ teste) | Apagar | o painel Cliente o substitui no modal |
| `frontend/src/components/ConversationModal.jsx` (+ teste) | Modificar | × no cabeçalho da conversa; sai o painel de informações (o resto do modal é da E2.5) |
| `frontend/src/components/MessageAttachment.jsx` (+ teste) | Modificar | "indisponível" sem `role="status"` |
| `frontend/src/components/SgpLookupPanel.jsx` (+ teste) | Modificar | uma superfície, QR sob demanda, aviso de encerrado |
| `frontend/src/utils/armazenamentoLocal.js` | Modificar | `lerSessao`/`gravarSessao` |
| `frontend/src/components/MessageInput.jsx` (+ teste) | Modificar | popovers, inserir no cursor, estados, descartar gravação |
| `frontend/src/components/AiSuggestionCard.jsx` (+ teste) | Modificar | faixa acima do compositor |
| `frontend/src/components/ConversationView.jsx` | Modificar | usa os componentes novos; faixas; rodapé de encerrada |
| `frontend/src/pages/dashboard.css` | Modificar | saem as regras da conversa |
| `frontend/src/components/overlays.css` | Modificar | saem `.dialog-popover-heading`, `.dialog-quick-replies`, `.dialog-emoji-picker`, `.dialog-sgp-panel`, `.chat-workspace-customer-panel …` |

## Interfaces

**Consome:** tokens, ícones de `IconesTrabalho` (E2.1); `useCamadaLeve`, `Popover`, `FaixaDeAviso`, `Button` (E2.1/E2.2); `avisarNaMesa` da `DashboardPage` (E2.3, via prop `onEncerrado`).

**Produz:**

```js
// utils/estadoDaConversa.js — P5: 'Em atendimento' | 'Em espera' | 'Em automação' | 'Encerrado'
export function estadoDaConversa(conversation): string
export function estaEncerrada(conversation): boolean

// components/MessageBubble.jsx (default export memo)
//   { message, primeiraDoGrupo: bool, nomeDoContato: string, contactId, contactAvatarPath, contactPhoneNumber,
//     podeResponder?: bool, onResponder?(message), onAnalisarComprovante?(messageId) }
export function horaDaMensagem(iso): string|null

// components/PainelCliente.jsx (default) — quem pode alterar o setor é decidido dentro, por useAuth
//   { conversation, override, onOverride(novo), onFechar() }
//   override = { contactId, displayName, cityId, cityName, localityId, localityName, internalNote, sectorId, sectorName } | null (parcial)

// components/CabecalhoDaConversa.jsx (default)
//   { conversation, nomeDoContato, local, estado, podeAssumir, podeTransferirEEncerrar,
//     onVoltar?, onAssumir, onTransferir, onEncerrar, onHistorico,
//     sgpAberto, onSgp, clienteAberto, onCliente, gatilhoSgpRef, gatilhoClienteRef, onFechar? }

// ConversationView — props novas: onEncerrado?(frase) (mesa), onFechar?() (modal: "Fechar conversa" no cabeçalho)

// utils/armazenamentoLocal.js
export function lerSessao(chave): string|null
export function gravarSessao(chave, valor): boolean
```

---

### Task 1: Vocabulário único de estado e o layout do painel sem CSS da página

**Files:**
- Create: `frontend/src/utils/estadoDaConversa.js`, `frontend/src/utils/estadoDaConversa.test.js`
- Create: `frontend/src/estilo/cssDaConversa.test.js`
- Modify: `frontend/src/components/ConversationView.jsx` (raiz, primeira coluna e slots do painel em utilitários; `conversationStatus` sai)
- Modify: `frontend/src/pages/dashboard.css` (saem as regras da conversa), `frontend/src/index.css` (variáveis `--chat-*` que ficarem sem uso)
- Modify: `frontend/src/components/ConversationView.test.jsx`

Spec P5 e 5.8: hoje são 4 mapeamentos para o mesmo estado — "Em atendimento" (verde) no cabeçalho, "Em andamento" (laranja) no painel de informações do modal, e regras inline repetidas no `CustomerPanel` e na Supervisão. E o CSS da conversa mora em `pages/dashboard.css`, que só a `DashboardPage` importa: aberto direto na Supervisão, o modal de conversa (`ConversationModal`, com `className="chat-workspace"`) fica sem a coluna de 268 px, sem a substituição do painel e sem as bolhas por token.

O que o utilitário não dizia — a coluna de 268 px do painel e a troca por substituição — passa para **utilitários condicionais no JSX**, e não para um `conversa.css`. Motivo: a regra que esconde a conversa no modo alternado (`.conv-raiz.is-painel-alternado > div:first-child { display: none }`) tem de vencer o `flex` do próprio elemento; em `@layer components` ela perderia para `@layer utilities`, e fora de camada seria mais uma regra vencendo utilitário por ordem de camada — a armadilha que o programa está tirando do código. Com o estado já no React (`painelAlternado`), a classe certa é escolhida ali. `conv-raiz`, `chat-workspace-conversation`, `is-painel-alternado` e `conv-painel-slot` ficam **como ganchos, sem regra**: as linhas de base do harness (`ferramentas/medicao/linha-de-base/*/M2.json`, `M5.json`) e o diagnóstico de rolagem os usam.

- [ ] **Step 1: Escrever os testes que falham**

`frontend/src/utils/estadoDaConversa.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { estadoDaConversa, estaEncerrada } from './estadoDaConversa';

describe('vocabulário único de estado (P5)', () => {
  test.each([
    [{ status: 'closed' }, 'Encerrado'],
    [{ status: 'assigned', closedAt: '2026-09-24T12:00:00Z' }, 'Encerrado'],
    [{ status: 'assigned', assignedAgentId: 'a1' }, 'Em atendimento'],
    [{ status: 'assigned' }, 'Em atendimento'],
    [{ status: 'waiting', triageState: 'pending' }, 'Em automação'],
    [{ status: 'waiting' }, 'Em espera'],
    [{ status: 'silent', triageState: 'pending' }, 'Em espera'],
  ])('%o → %s', (conversa, esperado) => {
    expect(estadoDaConversa(conversa)).toBe(esperado);
  });

  test('encerrada por status ou por data', () => {
    expect(estaEncerrada({ status: 'closed' })).toBe(true);
    expect(estaEncerrada({ status: 'assigned', closedAt: 'x' })).toBe(true);
    expect(estaEncerrada({ status: 'assigned' })).toBe(false);
  });
});
```

`frontend/src/estilo/cssDaConversa.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

// Spec 5.8: o CSS da conversa morava em pages/dashboard.css, que só existe na
// página quando a MESA foi carregada — o modal de conversa aberto direto na
// Supervisão ficava sem ele. A conversa passa a ser só utilitário.
describe('dashboard.css sem regra da conversa', () => {
  test('nenhum seletor da conversa, do painel ou do "voltar à conversa"', () => {
    const css = readFileSync(join(SRC, 'pages/dashboard.css'), 'utf8');
    expect(css).not.toMatch(/\.conv-raiz|\.conv-painel|\.sgp-acoes|chat-workspace-(conversation|header|context|timeline|system-note|day|bubble|message|composer|customer|panel)|chat-message-author|chat-context-label|chat-ai-suggestion|chat-painel-voltar/);
  });
});
```

Em `ConversationView.test.jsx`:

```jsx
describe('E2.4: painel em coluna ou por substituição, sem CSS da página', () => {
  const comCpf = { id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactSgpDocument: '12345678909' };

  test('coluna: a conversa fica, o painel tem 268 px ao lado', () => {
    const { container } = render(<ConversationView conversation={comCpf} onTransferClick={vi.fn()} workspace />);
    const raiz = container.querySelector('.conv-raiz');
    expect(raiz.firstElementChild).not.toHaveClass('hidden');
    expect(container.querySelector('#conv-painel-sgp')).toHaveClass('w-[268px]');
  });

  test('alternado: a conversa sai de cena, o painel ocupa a área e há "Voltar à conversa"', () => {
    const { container } = render(<ConversationView conversation={comCpf} onTransferClick={vi.fn()} workspace painelModo="alternado" />);
    const raiz = container.querySelector('.conv-raiz');
    expect(raiz).toHaveClass('flex-col');
    expect(raiz.firstElementChild).toHaveClass('hidden');
    expect(container.querySelector('#conv-painel-sgp')).toHaveClass('flex-1');
    expect(screen.getByRole('button', { name: /voltar à conversa/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/utils/estadoDaConversa.test.js src/estilo/cssDaConversa.test.js src/components/ConversationView.test.jsx`
Expected: FAIL (módulo inexistente; `dashboard.css` com as regras; sem `hidden`/`w-[268px]`).

- [ ] **Step 3: Implementar**

`frontend/src/utils/estadoDaConversa.js`:

```js
// Vocabulário ÚNICO de estado (spec P5): o mesmo nome em toda tela. Havia
// quatro mapeamentos — "Em atendimento" verde no cabeçalho e "Em andamento"
// laranja no painel do modal, na mesma tela. A conversa de campanha que ainda
// não teve resposta ('silent') está esperando o cliente: "Em espera".
export function estaEncerrada(conversation) {
  return conversation.status === 'closed' || Boolean(conversation.closedAt);
}

export function estadoDaConversa(conversation) {
  if (estaEncerrada(conversation)) return 'Encerrado';
  if (conversation.assignedAgentId || conversation.status === 'assigned') return 'Em atendimento';
  if (conversation.triageState === 'pending' && conversation.status !== 'silent') return 'Em automação';
  return 'Em espera';
}
```

Na `ConversationView.jsx`:

- `conversationStatus` (`:148-154`) **fica** até a Task 4: o cabeçalho de hoje ainda lê `status.label` e `status.dot` (apagá-la aqui quebra o render — achado da prova em cópia). O painel Cliente (Task 3) e o cabeçalho novo (Task 4) usam `estadoDaConversa`.
- A raiz, a primeira coluna e os dois slots do painel:

```jsx
  // Coluna quando cabe, substituição quando não; sobreposição em nenhum caso
  // (seção 9). Em utilitário, escolhido aqui pelo estado: a regra de esconder a
  // conversa tem de vencer o `flex` dela, e numa folha de estilo em camada ela
  // perderia (as classes da raiz e do slot ficam como ganchos do harness).
  const classeDoSlot = painelAlternado
    ? 'conv-painel-slot min-h-0 w-full flex-1 overflow-hidden bg-painel'
    : 'conv-painel-slot h-full min-h-0 w-[268px] flex-none overflow-hidden border-l border-linha bg-painel';
```

```jsx
    <div ref={raizRef} className={`conv-raiz ${workspace ? 'chat-workspace-conversation' : ''} ${painelAlternado ? 'is-painel-alternado flex-col' : ''} flex h-full`}>
      <div className={`${painelAlternado ? 'hidden' : 'flex'} h-full min-w-0 flex-1 flex-col bg-fundo`}>
```

  e os dois slots (`<div className="conv-painel-slot" id="conv-painel-sgp">` e o do Cliente) passam a `className={classeDoSlot}`. O `w-[268px]` é o `PAINEL` de `useWorkspaceLayout` — o mesmo número em que o layout decide a ordem de sacrifício.
- O slot do Cliente ficava **sempre montado** na mesa e escondido por CSS (`.chat-workspace-customer { display: none }` sem `is-open`, que sai agora). Sem a regra ele apareceria sempre; passa a montar **só aberto** (a Task 4 troca o conteúdo pelo `PainelCliente`):

```jsx
      ) : workspace && customerPanelOpen && !customerPanelDismissed ? (
        <div id="conv-painel-cliente" className={classeDoSlot}>
          <CustomerPanel conversation={conversation} displayName={displayName} cityName={cityName} onClose={() => { setCustomerPanelOpen(false); setCustomerPanelDismissed(true); }} />
        </div>
      ) : null}
```

  Em `ConversationView.test.jsx`, os dois testes que liam o painel sempre montado mudam o gatilho, não o que afirmam: "mostra apenas os dados disponíveis do cliente no painel contextual" clica `getByRole('button', { name: 'Dados do cliente' })` antes de procurar o `complementary`; "permite fechar e reabrir os dados do cliente sem alterar a conversa" passa a abrir pelo botão, fechar por "Fechar dados do cliente", afirmar que o `complementary` **não existe**, reabrir e afirmar que existe (sai o `toHaveClass('is-dismissed')`).
- Sai `font-wa` da primeira coluna (se a E2.1 ainda não o tirou).

Apagar de `pages/dashboard.css` **por seletor** (a E2.3 já terá apagado as regras da lista, então os números de linha de hoje não valem): todas as regras cujo seletor contém `.chat-workspace-conversation`, `-header`, `-header-identity`, `-header-actions`, `-context`, `-context-label`, `-context-actions`, `.chat-context-label`, `-timeline`, `-system-note`, `-day`, `-bubble`, `.chat-message-author`, `-message-text`, `-composer`, `.chat-ai-suggestion`, `-customer`, `-customer-panel`, `-panel-heading`, `-panel-body`, `-customer-identity`, `-panel-section`; o `@media(max-width:700px)` que só mexe nessas; o bloco comentado "Painel lateral (SGP / Cliente)" inteiro (`.conv-raiz > .conv-painel-slot`, `.conv-raiz.is-painel-alternado …`, `.conv-raiz .conv-painel`, `.sgp-acoes`, o `@container (max-width: 268px)`, `.chat-painel-voltar` e seus estados); e as três de `.chat-workspace-conversation.is-painel-alternado` do fim do arquivo. O teste do Step 1 é a conferência.

Em `overlays.css`, as duas regras `.chat-workspace-customer-panel .chat-workspace-panel-heading button` (`:220-221`) saem junto.

Variáveis que ficarem sem uso: as `--workspace-*` moram em `pages/dashboard.css:2` (`--workspace-line`, `--workspace-inbound`, `--workspace-outbound`) e as `--chat-*` em `index.css`. Conferir cada uma com `grep -rn "var(--X" src` **depois** da remoção, em cadeia (quando `--workspace-inbound` sai, `--chat-bubble-in` pode ficar sem uso); a que sobrar sem uso sai; a que a lista, a Supervisão, `pages/settings/channels/channels-polish.css` ou o `MessageAttachment` ainda usam fica até a etapa deles. Comentário que descrevia uma variável apagada sai junto.

Até as Tasks 2–7, a conversa perde o estilo antigo e fica só com os utilitários do JSX — esperado: cada tarefa seguinte redesenha a sua região. **Não publicar** este estado intermediário (a branch só vai à prévia no fim da E2).

- [ ] **Step 4: Rodar e ver passar — e o modal fora da mesa**

Run: `cd frontend && npx vitest run src/utils/estadoDaConversa.test.js src/estilo src/components/ConversationView src/components/ConversationModal.test.jsx src/pages/DashboardPage.test.jsx`
Expected: PASS. Os modos largo/trilho/alternado da `DashboardPage` continuam (eles leem o `painelModo`, não o CSS).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/estadoDaConversa.js frontend/src/utils/estadoDaConversa.test.js frontend/src/estilo/cssDaConversa.test.js frontend/src/components/ConversationView.jsx frontend/src/components/ConversationView.test.jsx frontend/src/pages/dashboard.css frontend/src/components/overlays.css frontend/src/index.css
git commit -m "E2.4: vocabulario unico de estado; layout do painel em utilitario, fora do CSS da mesa"
```

---

### Task 2: Bolhas com `memo`, tiques nomeados e a linha do tempo

**Files:**
- Rewrite: `frontend/src/components/MessageStatusTicks.jsx`; Modify: `MessageStatusTicks.test.jsx`
- Create: `frontend/src/components/MessageBubble.jsx`
- Create: `frontend/src/components/ConversationView.bolhas.test.jsx`
- Modify: `frontend/src/components/ConversationView.jsx:35-36,92-95` (constantes e `clockLabel` saem), `:369-371` (`useCallback`), `:697-890` (linha do tempo)
- Modify: `frontend/src/components/ConversationView.test.jsx` (selo "IA", tiques por nome)
- Modify: `frontend/src/components/MessageAttachment.jsx:130,550` e `MessageAttachment.test.jsx:144` (o "indisponível" sem `role="status"`)
- Modify: `frontend/src/index.css` (`--chat-ai-chip` e `--chat-ai-chip-ink` saem com o selo antigo)

Spec 6.3: fundo liso `--color-fundo` (sai o gradiente); a nota "Este atendimento fica registrado…" vira texto de 12 px sem pílula; separador de dia em pílula pequena neutra; "Carregar mensagens anteriores" como botão secundário pequeno. Bolhas: entrada `--color-bolha-entrada` à esquerda, saída `--color-bolha-saida` à direita, **IA usa a bolha de saída** com o rótulo "Assistente IA" e o ícone da IA na meta (sai o lilás e o filete); rótulo do autor na primeira bolha do grupo; texto 14/20; raio 10 com canto de 4 px do lado do autor na primeira do grupo; citação com barra em tinta-3 e nome em tinta; selo de hora sobre imagem em fundo escuro sólido, sem blur; falha com ícone + "Não entregue: motivo" em perigo. Tiques com nome acessível "Enviada", "Entregue", "Lida", "Falhou" (lido no acento-suave, entregue em tinta-3). **`MessageBubble` com `memo`** (decisão do proprietário): meta de 1 re-render de bolha por mensagem recebida (hoje 55,5).

- [ ] **Step 1: Escrever os testes que falham**

`frontend/src/components/ConversationView.bolhas.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import ConversationView from './ConversationView';
import MessageAttachment from './MessageAttachment';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { usePlaces } from '../hooks/useCities';
import { useSectors } from '../hooks/useSectors';
import { useSgpLookup } from '../hooks/useSgpLookup';
import { useReasons } from '../hooks/useReasons';
import { useAiSuggestion } from '../hooks/useAiSuggestion';
import * as api from '../services/api';

// Os mesmos mocks de ConversationView.test.jsx. Arquivo separado porque o mock
// do MessageAttachment abaixo quebraria os testes de anexo de lá.
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useCities');
vi.mock('../hooks/useSectors');
vi.mock('../hooks/useSgpLookup');
vi.mock('../hooks/useReasons');
vi.mock('../hooks/useAiSuggestion');
vi.mock('../services/api');
// Cada bolha renderiza um MessageAttachment: contar as chamadas dele é contar
// quantas bolhas re-renderizaram.
vi.mock('./MessageAttachment', () => ({ default: vi.fn(() => null) }));

const CONVERSA = { id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactDisplayName: 'Ana', contactPhoneNumber: '+5511999990000' };
const HORA = '2026-09-24T12:00:00.000Z';
const cinquenta = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, direction: i % 3 ? 'inbound' : 'outbound', content: `mensagem ${i}`, createdAt: HORA, status: 'delivered' }));

function estado(messages) {
  return { messages, status: 'ready', sendMessage: vi.fn(), appendMessage: vi.fn(), reloadMessages: vi.fn(), temAnteriores: false, carregandoAnteriores: false, carregarAnteriores: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useQuickReplies.mockReturnValue({ quickReplies: [], status: 'ready', refresh: vi.fn() });
  usePlaces.mockReturnValue({ places: [], status: 'ready', refresh: vi.fn() });
  useSectors.mockReturnValue({ sectors: [], status: 'ready' });
  useSgpLookup.mockReturnValue({ client: null, contracts: [], loading: false, error: null, search: vi.fn(), fetchDuplicate: vi.fn(), duplicateState: {} });
  useReasons.mockReturnValue({ reasons: [], loading: false, refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
});

// O teste simula o hook, então só prova o memo se o hook REAL preservar a
// identidade das mensagens que não mudaram — e preserva: useConversationMessages
// troca só o objeto da mensagem alterada (`m.id === message.id ? {...m, ...} : m`)
// e acrescenta a nova ao fim (`[...prev, message]`).
describe('bolhas memoizadas (spec 6.3)', () => {
  test('uma mensagem recebida re-renderiza UMA bolha, não as 50', () => {
    useConversationMessages.mockReturnValue(estado(cinquenta));
    const { rerender } = render(<ConversationView conversation={CONVERSA} onTransferClick={vi.fn()} workspace />);
    expect(MessageAttachment).toHaveBeenCalledTimes(50);

    MessageAttachment.mockClear();
    const nova = { id: 'm50', direction: 'inbound', content: 'chegou agora', createdAt: HORA };
    useConversationMessages.mockReturnValue(estado([...cinquenta, nova]));
    rerender(<ConversationView conversation={CONVERSA} onTransferClick={vi.fn()} workspace />);

    expect(MessageAttachment).toHaveBeenCalledTimes(1);
  });

  test('cada linha de mensagem carrega data-mensagem-id; o separador de dia não', () => {
    useConversationMessages.mockReturnValue(estado(cinquenta.slice(0, 3)));
    const { container } = render(<ConversationView conversation={CONVERSA} onTransferClick={vi.fn()} workspace />);
    const linhas = container.querySelectorAll('[data-mensagem-id]');
    expect([...linhas].map((l) => l.getAttribute('data-mensagem-id'))).toEqual(['m0', 'm1', 'm2']);
    expect(container.querySelector('[data-separador-dia]').hasAttribute('data-mensagem-id')).toBe(false);
  });
});
```

Em `MessageStatusTicks.test.jsx`, trocar as buscas por `title` por nome acessível:

```jsx
  test.each([
    ['sent', 'Enviada'],
    ['delivered', 'Entregue'],
    ['read', 'Lida'],
    ['failed', 'Falhou'],
  ])('%s tem o nome acessível %s', (status, nome) => {
    render(<MessageStatusTicks status={status} />);
    expect(screen.getByRole('img', { name: nome })).toBeInTheDocument();
  });

  test('lida no acento-suave; entregue não', () => {
    const { rerender } = render(<MessageStatusTicks status="read" />);
    expect(screen.getByRole('img', { name: 'Lida' }).className).toMatch(/text-accent-soft/);
    rerender(<MessageStatusTicks status="delivered" />);
    expect(screen.getByRole('img', { name: 'Entregue' }).className).not.toMatch(/text-accent-soft/);
  });
```

(substituindo os testes de `title` e de `text-chat-online`.) Em `ConversationView.test.jsx`: os dois testes do selo "IA" (hoje `getByText('IA')` / ausente) passam a `getByRole('img', { name: 'Enviada pela IA' })` / ausente; as buscas por `getByTitle('Entregue')` e `queryByTitle('Enviado'|'Entregue'|'Lido')` passam a `getByRole('img', { name: 'Entregue' })` e `queryByRole('img', { name: /enviada|entregue|lida/i })`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ConversationView.bolhas.test.jsx src/components/MessageStatusTicks.test.jsx`
Expected: FAIL — sem `memo` a montagem já re-renderiza as 50 bolhas uma segunda vez, e a falha aparece na primeira asserção (`expected "spy" to be called 50 times, but got 100 times`); não há `data-separador-dia`; os tiques não têm nome.

- [ ] **Step 3: Implementar os tiques**

`frontend/src/components/MessageStatusTicks.jsx` inteiro:

```jsx
import { IconCheck, IconChecks, IconWarningCircle } from './icons/IconesTrabalho';

// Estado da mensagem por FORMA e por NOME (P8): 1 tique enviada, 2 entregue,
// 2 no acento-suave lida, ícone de falha. Antes só havia `title` (o leitor de
// tela não lia) e a lida era verde (não existe cor de sucesso, spec 5.2.2).
function MessageStatusTicks({ status }) {
  if (status === 'failed') {
    return <span role="img" aria-label="Falhou" className="inline-flex shrink-0 text-perigo"><IconWarningCircle size={14} /></span>;
  }
  if (status === 'sent') {
    return <span role="img" aria-label="Enviada" className="inline-flex shrink-0 text-tinta-3"><IconCheck size={14} /></span>;
  }
  if (status === 'delivered' || status === 'read') {
    const lida = status === 'read';
    return (
      <span role="img" aria-label={lida ? 'Lida' : 'Entregue'} className={`inline-flex shrink-0 ${lida ? 'text-accent-soft' : 'text-tinta-3'}`}>
        <IconChecks size={14} />
      </span>
    );
  }
  return null;
}

export default MessageStatusTicks;
```

- [ ] **Step 4: Implementar a bolha**

`frontend/src/components/MessageBubble.jsx`:

```jsx
import { memo } from 'react';
import MessageAttachment from './MessageAttachment';
import MessageStatusTicks from './MessageStatusTicks';
import ContactAvatar from './ContactAvatar';
import { descreverFalha } from '../utils/failureReasons';
import { IconChevronDown, IconSpark, IconWarningCircle } from './icons/IconesTrabalho';

const OVERLAY_TYPES = ['image', 'video', 'sticker'];
const BLOCK_TYPES = ['document', 'location', 'pix'];

export function horaDaMensagem(valor) {
  if (!valor) return null;
  return new Date(valor).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Uma linha da linha do tempo (spec 6.3). `memo`: com 50 mensagens na tela,
// cada mensagem nova re-renderizava as 50 bolhas (medido: 55,5 por mensagem).
// As props são primitivas ou estáveis — a mensagem mantém a identidade (o hook
// mescla por id) e os callbacks vêm de useCallback no pai.
// `data-mensagem-id` fica NA LINHA INTEIRA: é por ele que a rolagem ancora
// (useRolagemDaLinhaDoTempo); separador de dia nunca o tem.
function MessageBubble({
  message,
  primeiraDoGrupo,
  nomeDoContato,
  contactId,
  contactAvatarPath,
  contactPhoneNumber,
  podeResponder = false,
  onResponder,
  onAnalisarComprovante,
}) {
  const saida = message.direction === 'outbound';
  const daIa = saida && message.sentBy === 'ai';
  // O código Pix nunca aparece como texto solto: o cartão (PixCardMessage)
  // mostra a prévia truncada dele.
  const temTexto = message.messageType === 'pix' ? false : Boolean(message.content);
  const figurinha = message.messageType === 'sticker' && message.mediaPath;
  const modoDaMeta = !temTexto && OVERLAY_TYPES.includes(message.messageType) && message.mediaPath
    ? 'sobre'
    : !temTexto && BLOCK_TYPES.includes(message.messageType)
      ? 'bloco'
      : 'flutua';
  const justa = modoDaMeta === 'sobre' && !figurinha;
  const rotuloCitado = message.repliedToPreview ? (message.repliedToPreview.direction === 'outbound' ? 'Você' : nomeDoContato) : null;
  const canto = primeiraDoGrupo ? (saida ? 'rounded-tr-sm' : 'rounded-tl-sm') : '';

  // Dentro da bolha, metadado em tinta-2 — nunca tinta-3 (sobre a bolha de
  // saída ela cairia para ~3:1, spec 5.3).
  const meta = (
    <span className="flex shrink-0 items-center gap-1 text-meta tabular-nums text-tinta-2">
      {daIa && <span role="img" aria-label="Enviada pela IA" className="inline-flex"><IconSpark size={12} /></span>}
      {horaDaMensagem(message.createdAt)}
      {saida && <MessageStatusTicks status={message.status} />}
    </span>
  );

  return (
    <div data-mensagem-id={message.id} className={`flex ${saida ? 'justify-end' : 'justify-start'} ${primeiraDoGrupo ? 'mt-3' : 'mt-1'}`}>
      <div
        className={`group relative max-w-[85%] md:max-w-[65%] ${
          figurinha ? '' : `rounded-ui-md ${canto} ${saida ? 'bg-bolha-saida' : 'bg-bolha-entrada'} ${justa ? 'p-1' : 'px-3 pb-2 pt-2'}`
        }`}
      >
        {saida && !figurinha && primeiraDoGrupo && (
          <span className="mb-0.5 flex items-center gap-1 text-meta font-semibold text-tinta-2">
            {daIa && <span aria-hidden="true" className="inline-flex"><IconSpark size={12} /></span>}
            {daIa ? 'Assistente IA' : 'Atendente'}
          </span>
        )}
        {message.repliedToPreview && (
          <div className="mb-1 flex overflow-hidden rounded-ui-sm bg-fundo/40">
            <span aria-hidden="true" className="w-[3px] shrink-0 bg-tinta-3" />
            <span className="min-w-0 flex-1 px-2 py-1">
              <span className="block truncate text-rotulo font-semibold text-tinta">{rotuloCitado}</span>
              <span className="block truncate text-rotulo text-tinta-2">{message.repliedToPreview.content || 'Mídia'}</span>
            </span>
          </div>
        )}
        <MessageAttachment
          message={message}
          dark
          onAnalyzeReceipt={onAnalisarComprovante}
          avatar={!saida ? <ContactAvatar contactId={contactId} avatarPath={contactAvatarPath} displayName={nomeDoContato} phoneNumber={contactPhoneNumber} size={42} /> : null}
        />
        {temTexto && (
          <p className="whitespace-pre-wrap break-words text-corpo text-tinta">
            {message.content}
            <span aria-hidden="true" className="inline-block h-px align-bottom" style={{ width: saida ? 82 : 58 }} />
          </p>
        )}
        {saida && message.status === 'failed' && (
          <p className="mt-1 flex items-center gap-1 text-meta text-perigo">
            <span aria-hidden="true" className="inline-flex"><IconWarningCircle size={14} /></span>
            {message.metadata?.motivoFalha ? `Não entregue: ${descreverFalha(message.metadata.motivoFalha)}` : 'Não entregue'}
          </p>
        )}
        {modoDaMeta === 'flutua' && <span className="absolute bottom-1 right-3">{meta}</span>}
        {modoDaMeta === 'sobre' && <span className="absolute bottom-2 right-2 rounded-full bg-fundo px-1.5">{meta}</span>}
        {modoDaMeta === 'bloco' && <span className="mt-1 flex justify-end">{meta}</span>}
        {podeResponder && temTexto && (
          <button
            type="button"
            onClick={() => onResponder(message)}
            aria-label="Responder"
            className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-ui-sm bg-elevado text-tinta-2 opacity-0 transition-opacity duration-120 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <IconChevronDown size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

export default memo(MessageBubble);
```

(`bg-fundo/40` na citação: camadas sob o texto citado = bolha + citação, ≤ 3 com o fundo — spec 12.2. O selo "sobre imagem" é `bg-fundo` sólido: sai o `backdrop-blur`. O rótulo do autor passa a aparecer também no modal — antes era só na mesa; é a mesma bolha em todo lugar, inclusive no Histórico da E2.5.)

- [ ] **Step 5: Ligar na `ConversationView`**

Imports: `MessageAttachment` e `MessageStatusTicks` saem da `ConversationView` (a bolha os importa); entram `import MessageBubble from './MessageBubble';` e `useCallback`. As constantes `OVERLAY_TYPES`/`BLOCK_TYPES` (`:35-36`), `clockLabel` (`:92-95`) e o import de `descreverFalha` saem.

`analisarComprovanteDaMensagem` (`:369-371`) vira estável, e a resposta também:

```jsx
  const analisarComprovante = useCallback((messageId) => analyzeReceipt(conversation.id, messageId, token), [conversation.id, token]);
  const responder = useCallback((message) => setReplyingTo(message), []);
```

A linha do tempo (`:697-890`) passa a:

```jsx
      <p role="status" aria-live="polite" className="sr-only">{avisoDeMensagem}</p>
      <div ref={linhaDoTempoRef} className="chat-workspace-timeline chat-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-fundo px-4 py-2 md:px-8">
        <p className="mx-auto mb-3 flex w-fit max-w-[90%] items-center gap-1.5 text-center text-meta text-tinta-3">
          <span aria-hidden="true" className="inline-flex"><IconLock size={12} /></span>
          Este atendimento fica registrado no sistema da {companyName || 'empresa'}.
        </p>

        {messagesStatus === 'error' && (
          <div role="alert" className="mx-auto mb-3 flex w-fit max-w-[90%] flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-ui-md bg-perigo-fundo px-4 py-2 text-center text-rotulo text-perigo">
            <span>Não foi possível carregar as mensagens deste atendimento.</span>
            <Button size="sm" variant="secondary" onClick={reloadMessages}>Tentar de novo</Button>
          </div>
        )}

        {messagesStatus === 'loading' && messages.length === 0 && (
          <p className="mb-3 text-center text-rotulo text-tinta-3">Carregando mensagens…</p>
        )}

        {temAnteriores && (
          <div className="mb-3 flex justify-center">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                // A ordem importa: a posição é memorizada ANTES do pedido.
                memorizarPosicao();
                carregarAnteriores();
              }}
              disabled={carregandoAnteriores}
            >
              {carregandoAnteriores ? 'Carregando…' : 'Carregar mensagens anteriores'}
            </Button>
          </div>
        )}

        {timeline.map((row) =>
          row.kind === 'day' ? (
            <div key={row.key} data-separador-dia="" className="my-3 flex justify-center">
              <span className="rounded-full bg-painel px-3 py-1 text-meta font-medium text-tinta-2">{row.label}</span>
            </div>
          ) : (
            <MessageBubble
              key={row.key}
              message={row.message}
              primeiraDoGrupo={row.firstOfGroup}
              nomeDoContato={nameLabel}
              contactId={conversation.contactId}
              contactAvatarPath={conversation.contactAvatarPath}
              contactPhoneNumber={conversation.contactPhoneNumber}
              podeResponder={isMine}
              onResponder={responder}
              onAnalisarComprovante={isMine ? analisarComprovante : undefined}
            />
          )
        )}
        <div ref={bottomRef} />
      </div>
```

Três mudanças de papel, pela seção 9 ("um só `role="status"` por tela"): o "Carregando mensagens…" perde o `role="status"` (a região viva `sr-only` logo acima é o `status` da conversa); o `p` do aviso de mensagem continua sendo o único; e em `MessageAttachment.jsx` o "Áudio indisponível" (`:130`) e o "Vídeo indisponível" (`:550`) perdem o `role="status"` — são conteúdo parado da bolha, não anúncio, e cada mídia indisponível na tela somava um `status`. Em `MessageAttachment.test.jsx:144`, `getByRole('status')` passa a `getByText('Áudio indisponível')` e ganha a prova de que o papel saiu: `expect(screen.getByText('Áudio indisponível').closest('[role="status"]')).toBeNull();` (sem ela, o teste passaria antes e depois); o `:403` (`queryByRole('status')` ausente) continua valendo.

Os tiques também são buscados por `title` fora da conversa: em `ConversationListItem.test.jsx`, `getByTitle('Entregue')` (`:317`) passa a `getByRole('img', { name: 'Entregue' })`, e `queryByTitle('Enviado'|'Entregue'|'Lido')` (`:361-363`) passam a `queryByRole('img', { name: /enviada|entregue|lida/i })` — do jeito que estão, as três passariam a valer sempre, sem provar nada (achado da prova em cópia: o `:317` só quebrou na suíte cheia). Conferir antes com `grep -rn "Title('Enviado')\|Title('Entregue')\|Title('Lido')" src` — a E2.3 reescreve o item da lista e pode ter mudado as linhas. O teste "sem 'carregando' no vazio" (`ConversationView.test.jsx:1513-1557`) continua achando o texto. `Button` vem de `./ui`. A classe `chat-workspace-timeline` fica **como gancho** (sem CSS): `ConversationView.trocaDeConversa.test.jsx:134` e o diagnóstico `rolagem-anteriores.mjs` a usam.

**[Prova na cópia, 24/09/2026]** O selo "IA" antigo da bolha era o último uso de `--chat-ai-chip` e `--chat-ai-chip-ink`: em `index.css`, as duas variáveis saem, com o comentário "Selo da IA na bolha." logo acima delas. Conferir com `grep -rn "chat-ai-chip" src` → nada. (A Task 1 as deixava de pé porque o selo ainda existia, e nenhuma tarefa as tirava.)

- [ ] **Step 6: Rodar e ver passar — inclusive E1/E1.1**

Run: `cd frontend && npx vitest run src/components/ConversationView src/components/MessageStatusTicks.test.jsx src/components/MessageAttachment.test.jsx src/hooks/useRolagemDaLinhaDoTempo.test.jsx src/hooks/useConversationMessages.test.jsx`
Expected: PASS — "uma mensagem recebida re-renderiza UMA bolha"; os de `trocaDeConversa` (a mensagem do topo fica no lugar, mensagem do socket durante a carga, CLASSE-01) sem mudança.

- [ ] **Step 7: Provar por mutação**

Trocar `export default memo(MessageBubble);` por `export default MessageBubble;`. Rodar o `bolhas.test.jsx`.
Expected: FAIL (≥ 51 chamadas). Desfazer. Trocar `onResponder={responder}` por `onResponder={(m) => setReplyingTo(m)}`. Rodar.
Expected: FAIL (callback novo derruba o memo). Desfazer.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/MessageBubble.jsx frontend/src/components/MessageStatusTicks.jsx frontend/src/components/MessageStatusTicks.test.jsx frontend/src/components/ConversationView.jsx frontend/src/components/ConversationView.test.jsx frontend/src/components/ConversationView.bolhas.test.jsx frontend/src/components/MessageAttachment.jsx frontend/src/components/MessageAttachment.test.jsx frontend/src/components/ConversationListItem.test.jsx frontend/src/index.css
git commit -m "E2.4: bolha memoizada (1 render por mensagem), tiques nomeados e linha do tempo lisa"
```

---

### Task 3: Painel Cliente — dados, edição e setor

**Files:**
- Create: `frontend/src/components/PainelCliente.jsx`, `frontend/src/components/PainelCliente.test.jsx`
- Modify: `frontend/src/components/ConversationView.jsx:198-247` (`CustomerPanel` sai), `:282,975-988` (`editingContact`, `EditContactModal` saem), `:312` (painel Cliente também fora da mesa), `:579-583` (o nome/avatar do cabeçalho de hoje passa a abrir o painel), `:1019-1022` (slot)
- Delete: `frontend/src/components/EditContactModal.jsx`, `EditContactModal.test.jsx`
- Modify: `frontend/src/components/ConversationView.test.jsx`
- Modify: `frontend/src/components/overlays.css` (`.dialog-contact-fields` sai com o modal de edição)

Spec 6.4 e E.2/E.3: o painel Cliente reúne o que saiu da vista — identidade, estado, telefone, canal, protocolo, cidade, setor, atendente, nota interna, triagem por IA (motivo, setor da IA, identificação, confiança **em %** e baixa, resumo, resolvido pela IA) e "Encerrado em". Ele substitui **três** coisas: o `CustomerPanel` interno da mesa, o `EditContactModal` (a edição acontece aqui, em 1 coluna — Nome · Município · Localidade · Nota interna com ajuda fixa, `[Cancelar][Salvar]` no pé — e a conversa fica visível enquanto o atendente copia o nome e a cidade que o cliente escreveu) e o `ConversationInfoPanel` do modal (coluna fixa de 272 px que sumia abaixo de 768 px e dizia "Em andamento" em laranja) — este sai na Task 4, junto com o cabeçalho que dá ao modal o botão "Dados do cliente". **"Alterar setor"** (hoje só no `ConversationInfoPanel`, com falha silenciosa: `.catch(() => {})`) entra na linha Setor com a mesma regra de quem pode — admin, gerente ou o dono —, "Salvando…", falha que volta ao valor anterior com erro visível, e a linha mostrando o setor novo na hora. Na mesa e no modal o painel nasce **fechado**; nesta tarefa ele abre pelo nome/avatar do cabeçalho de hoje (que abria a edição num modal), e a Task 4 acrescenta o botão de ícone.

**Por que antes do cabeçalho:** o nome/avatar do cabeçalho é hoje o único gatilho da edição do cliente. Se o cabeçalho novo viesse antes, a edição ficaria inalcançável entre as duas tarefas (a prova em cópia viu os dois testes de edição quebrarem nesse intervalo). Corrige: a nota salva não voltava ao reabrir (CV-EDC-11); município que não carrega ficava mudo (CV-EDC-03); localidade desabilitada sem dizer por quê (CV-EDC-04); salvar sem "Salvando…" (CV-EDC-09); o salvamento lento gravava o nome de A no cabeçalho de B (CV-EDC-13).

**Interfaces:**
- Produces: `PainelCliente({ conversation, override, onOverride(novo), onFechar() })` — `override = { contactId, displayName, cityId, cityName, localityId, localityName, internalNote, sectorId, sectorName } | null`, parcial. Quem pode alterar o setor é decidido DENTRO do painel, por `useAuth` (a regra do `ConversationInfoPanel.jsx:55`). Exporta também `campoDoContato(override, campo, reserva)`: campo presente no override vale mesmo vazio; ausente, cai no da conversa. A `ConversationView` lê o cabeçalho por ele. **[Prova na cópia, 24/09/2026]**

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/components/PainelCliente.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PainelCliente from './PainelCliente';
import { useAuth } from '../contexts/AuthContext';
import { usePlaces } from '../hooks/useCities';
import { useSectors } from '../hooks/useSectors';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useCities');
vi.mock('../hooks/useSectors');
vi.mock('../services/api');

const LUGARES = [
  { id: 'm1', name: 'Cândido Mendes', kind: 'city' },
  { id: 'm2', name: 'Godofredo Viana', kind: 'city' },
  { id: 'l1', name: 'Barão de Tromaí', kind: 'locality', parentId: 'm1' },
];
const CONVERSA = {
  id: 'conv-1', contactId: 'k1', status: 'assigned', assignedAgentId: 'agent-1', assignedAgentName: 'Ana Lima',
  contactDisplayName: 'Maria', contactPhoneNumber: '+5598985004187', channelName: 'Loja',
  contactCityId: 'm1', contactCityName: 'Cândido Mendes', contactInternalNote: 'Cliente antiga',
  sectorId: 's1', sectorName: 'Financeiro', protocolNumber: '20260924-0007',
};
const TRIADA = {
  ...CONVERSA,
  aiTriageCompletedAt: '2026-09-24T11:10:00Z', aiTriageReasonName: 'Segunda via', aiTriageConfidence: 0.87,
  aiTriageSectorId: 's2', aiTriageIdentifiedBy: 'cpf', aiTriageSummary: 'Cliente pediu segunda via do boleto.',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  usePlaces.mockReturnValue({ places: LUGARES, status: 'ready', refresh: vi.fn() });
  useSectors.mockReturnValue({ sectors: [{ id: 's1', name: 'Financeiro' }, { id: 's2', name: 'Suporte' }], status: 'ready' });
});

function montar(conversation = CONVERSA, props = {}) {
  const onOverride = vi.fn();
  const utils = render(<PainelCliente conversation={conversation} override={null} onOverride={onOverride} onFechar={vi.fn()} {...props} />);
  return { onOverride, ...utils };
}

describe('painel Cliente (spec 6.4)', () => {
  test('reúne o que saiu da vista, com estado, canal, protocolo, cidade, atendente e nota', () => {
    montar();
    const painel = screen.getByRole('complementary', { name: 'Dados do cliente' });
    for (const texto of ['Em atendimento', 'Loja', '20260924-0007', 'Cândido Mendes', 'Ana Lima', 'Cliente antiga']) {
      expect(within(painel).getAllByText(texto).length).toBeGreaterThan(0);
    }
    expect(within(painel).queryByText('Encerrado em')).not.toBeInTheDocument();
  });

  test('conversa encerrada mostra "Encerrado em"', () => {
    montar({ ...CONVERSA, status: 'closed', closedAt: '2026-09-24T15:30:00.000Z' });
    expect(screen.getByText('Encerrado em')).toBeInTheDocument();
    expect(screen.getByText('Encerrado')).toBeInTheDocument();
  });

  describe('triagem por IA (portado do ConversationInfoPanel)', () => {
    test('mostra o bloco com todos os campos quando a triagem terminou', () => {
      montar(TRIADA);
      expect(screen.getByText('Triagem por IA')).toBeInTheDocument();
      expect(screen.getByText('Setor da IA').nextElementSibling).toHaveTextContent('Suporte');
      expect(screen.getByText('Motivo').nextElementSibling).toHaveTextContent('Segunda via');
      expect(screen.getByText('Identificação').nextElementSibling).toHaveTextContent('CPF');
      expect(screen.getByText('Confiança').nextElementSibling).toHaveTextContent('87%');
      expect(screen.getByText('Cliente pediu segunda via do boleto.')).toBeInTheDocument();
    });

    test('sem triagem concluída, sem bloco', () => {
      montar({ ...CONVERSA, aiTriageCompletedAt: null });
      expect(screen.queryByText('Triagem por IA')).not.toBeInTheDocument();
    });

    test.each([
      ['memory', 'memória'],
      ['phone', 'telefone'],
      ['cpf', 'CPF'],
      ['none', 'não identificado'],
    ])('identificação %s → %s', (identifiedBy, rotulo) => {
      montar({ ...TRIADA, aiTriageIdentifiedBy: identifiedBy });
      expect(screen.getByText('Identificação').nextElementSibling).toHaveTextContent(rotulo);
    });

    test('confiança baixa e resolvido pela IA aparecem', () => {
      montar({ ...TRIADA, aiTriageLowConfidence: true, aiTriageResolvedByAi: true });
      expect(screen.getByText('Confiança').nextElementSibling).toHaveTextContent('87% · baixa');
      expect(screen.getByText('Resolvido pela IA')).toBeInTheDocument();
    });
  });

  describe('edição no painel', () => {
    test('salvar chama a API com a mesma carga de antes e devolve o override com a nota', async () => {
      api.updateContact.mockResolvedValue({ displayName: 'Maria Souza', cityId: 'm1', localityId: 'l1', internalNote: 'Nova nota' });
      const { onOverride } = montar();
      await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
      await userEvent.clear(screen.getByLabelText('Nome'));
      await userEvent.type(screen.getByLabelText('Nome'), 'Maria Souza');
      await userEvent.selectOptions(screen.getByLabelText('Localidade'), 'l1');
      await userEvent.clear(screen.getByLabelText('Nota interna'));
      await userEvent.type(screen.getByLabelText('Nota interna'), 'Nova nota');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
      expect(api.updateContact).toHaveBeenCalledWith('k1', { displayName: 'Maria Souza', cityId: 'm1', localityId: 'l1', internalNote: 'Nova nota' }, 'tok-123');
      await waitFor(() => expect(onOverride).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'k1', displayName: 'Maria Souza', cityName: 'Cândido Mendes', localityName: 'Barão de Tromaí', internalNote: 'Nova nota' })));
      expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument();
    });

    test('reabrir a edição mostra a nota salva (CV-EDC-11)', async () => {
      render(<PainelCliente conversation={CONVERSA} override={{ contactId: 'k1', internalNote: 'Nota nova' }} onOverride={vi.fn()} onFechar={vi.fn()} />);
      expect(screen.getByText('Nota nova')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
      expect(screen.getByLabelText('Nota interna')).toHaveValue('Nota nova');
    });

    test('trocar de município zera a localidade', async () => {
      montar({ ...CONVERSA, contactLocalityId: 'l1' });
      await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
      expect(screen.getByLabelText('Localidade')).toHaveValue('l1');
      await userEvent.selectOptions(screen.getByLabelText('Município'), 'm2');
      expect(screen.getByLabelText('Localidade')).toHaveValue('');
    });

    test('localidade desabilitada diz por quê (CV-EDC-04)', async () => {
      montar({ ...CONVERSA, contactCityId: null });
      await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
      expect(screen.getByLabelText('Localidade')).toBeDisabled();
      expect(screen.getByLabelText('Localidade')).toHaveAccessibleDescription('Escolha o município primeiro.');
    });

    test('municípios que não carregam: o motivo e "Tentar de novo" (CV-EDC-03)', async () => {
      const refresh = vi.fn();
      usePlaces.mockReturnValue({ places: [], status: 'error', refresh });
      montar();
      await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar os municípios.');
      await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    test('salvando: "Salvando…" e campos travados; erro mantém o que foi digitado', async () => {
      let falhar;
      api.updateContact.mockReturnValue(new Promise((_, rej) => { falhar = rej; }));
      montar();
      await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
      await userEvent.type(screen.getByLabelText('Nome'), ' X');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
      expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
      expect(screen.getByLabelText('Nome')).toBeDisabled();
      falhar({ status: 500, body: { error: 'Internal' } });
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.getByLabelText('Nome')).toHaveValue('Maria X');
    });

    test('troca de conversa: sai do modo edição e descarta o rascunho', async () => {
      const { rerender } = montar();
      await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
      await userEvent.type(screen.getByLabelText('Nome'), ' rascunho');
      rerender(<PainelCliente conversation={{ ...CONVERSA, id: 'conv-2', contactId: 'k2', contactDisplayName: 'João' }} override={null} onOverride={vi.fn()} onFechar={vi.fn()} />);
      expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument();
      expect(screen.getAllByText('João').length).toBeGreaterThan(0);
    });

    test('salvamento que termina depois da troca de conversa não vale para a nova (CV-EDC-13)', async () => {
      let terminar;
      api.updateContact.mockReturnValue(new Promise((r) => { terminar = r; }));
      const onOverride = vi.fn();
      const { rerender } = render(<PainelCliente conversation={CONVERSA} override={null} onOverride={onOverride} onFechar={vi.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
      await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
      rerender(<PainelCliente conversation={{ ...CONVERSA, id: 'conv-2', contactId: 'k2' }} override={null} onOverride={onOverride} onFechar={vi.fn()} />);
      terminar({ displayName: 'Maria', cityId: 'm1', localityId: null, internalNote: null });
      await new Promise((r) => setTimeout(r, 0));
      expect(onOverride).not.toHaveBeenCalled();
    });
  });

  describe('setor (portado do ConversationInfoPanel, agora com retorno visível)', () => {
    test('o dono troca o setor: "Salvando…", e a linha fica com o novo', async () => {
      let terminar;
      api.setConversationSector.mockReturnValue(new Promise((r) => { terminar = r; }));
      const { onOverride } = montar();
      await userEvent.selectOptions(screen.getByLabelText('Alterar setor'), 's2');
      expect(screen.getByLabelText('Alterar setor')).toBeDisabled();
      expect(screen.getByText('Salvando…')).toBeInTheDocument();
      terminar({});
      await waitFor(() => expect(screen.getByLabelText('Alterar setor')).toBeEnabled());
      expect(api.setConversationSector).toHaveBeenCalledWith('conv-1', 's2', 'tok-123');
      expect(screen.getByLabelText('Alterar setor')).toHaveValue('s2');
      expect(onOverride).toHaveBeenCalledWith(expect.objectContaining({ sectorId: 's2', sectorName: 'Suporte' }));
    });

    test('o dono vê o setor atual por extenso, mesmo com os setores ainda carregando', () => {
      useSectors.mockReturnValue({ sectors: [], status: 'loading' });
      montar();
      expect(screen.getByText('Setor').nextElementSibling).toHaveTextContent('Financeiro');
      expect(screen.getByLabelText('Alterar setor')).toBeDisabled();
    });

    test('falha volta ao anterior e mostra o erro', async () => {
      api.setConversationSector.mockRejectedValue({ status: 500, body: {} });
      montar();
      await userEvent.selectOptions(screen.getByLabelText('Alterar setor'), 's2');
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.getByLabelText('Alterar setor')).toHaveValue('s1');
    });

    test.each([
      [{ id: 'admin-1', role: 'admin' }],
      [{ id: 'manager-1', role: 'manager' }],
    ])('%o altera o setor de conversa de outra pessoa', (agent) => {
      useAuth.mockReturnValue({ token: 'tok', agent });
      montar({ ...CONVERSA, assignedAgentId: 'outro' });
      expect(screen.getByLabelText('Alterar setor')).toBeInTheDocument();
    });

    test('atendente que não é o dono vê o setor só como texto', () => {
      useAuth.mockReturnValue({ token: 'tok', agent: { id: 'agent-2', role: 'agent' } });
      montar();
      expect(screen.queryByLabelText('Alterar setor')).not.toBeInTheDocument();
      expect(screen.getByText('Setor').nextElementSibling).toHaveTextContent('Financeiro');
    });
  });
});

// Achado da prova em cópia (24/09/2026): o override é parcial e campo apagado
// vale. Com `??`, a nota e a cidade apagadas voltavam, e a edição reabria com
// a cidade antiga — salvar de novo a gravaria de volta.
describe('override parcial: campo presente vale, mesmo vazio', () => {
  test('nota e cidade apagadas não voltam, e a edição reabre vazia', async () => {
    render(<PainelCliente conversation={CONVERSA} override={{ contactId: 'k1', displayName: 'Maria', cityId: null, cityName: null, localityId: null, localityName: null, internalNote: null }} onOverride={vi.fn()} onFechar={vi.fn()} />);
    expect(screen.queryByText('Cliente antiga')).not.toBeInTheDocument();
    expect(screen.queryByText('Cidade')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.getByLabelText('Município')).toHaveValue('');
    expect(screen.getByLabelText('Nota interna')).toHaveValue('');
  });

  test('só o setor no override: nome e cidade continuam os da conversa', () => {
    render(<PainelCliente conversation={CONVERSA} override={{ sectorId: 's2', sectorName: 'Suporte' }} onOverride={vi.fn()} onFechar={vi.fn()} />);
    expect(screen.getByText('Maria')).toBeInTheDocument();
    expect(screen.getByText('Cidade').nextElementSibling).toHaveTextContent('Cândido Mendes');
    expect(screen.getByText('Setor').nextElementSibling).toHaveTextContent('Suporte');
  });

  test('setor apagado: a linha diz "Não definido", não o setor antigo', () => {
    render(<PainelCliente conversation={CONVERSA} override={{ sectorId: null, sectorName: null }} onOverride={vi.fn()} onFechar={vi.fn()} />);
    expect(screen.getByText('Setor').nextElementSibling).toHaveTextContent('Não definido');
    expect(screen.getByLabelText('Alterar setor')).toHaveValue('');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/PainelCliente.test.jsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar o painel**

`frontend/src/components/PainelCliente.jsx`:

```jsx
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import ContactAvatar from './ContactAvatar';
import { useAuth } from '../contexts/AuthContext';
import { usePlaces } from '../hooks/useCities';
import { useSectors } from '../hooks/useSectors';
import { setConversationSector, updateContact } from '../services/api';
import { descreverErro } from '../utils/errorMessages';
import { estadoDaConversa } from '../utils/estadoDaConversa';
import { formatPhone } from '../utils/phone';
import { nomeDoLocal } from '../utils/place';
import { Button } from './ui';
import { IconClose } from './icons/IconesTrabalho';

const IDENTIFICACAO = { memory: 'memória', phone: 'telefone', cpf: 'CPF', none: 'não identificado' };
const CAMPO = 'h-9 w-full rounded-ui-md bg-campo px-3 text-corpo text-tinta outline-none placeholder:text-tinta-3 disabled:opacity-60';

function Linha({ rotulo, children }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 py-1">
      <dt className="text-rotulo text-tinta-3">{rotulo}</dt>
      <dd className="min-w-0 break-words text-corpo text-tinta">{children}</dd>
    </div>
  );
}

function Secao({ titulo, children }) {
  return (
    <section className="border-b border-linha px-4 py-3 last:border-b-0">
      <h3 className="mb-1 text-rotulo font-semibold text-tinta-2">{titulo}</h3>
      {children}
    </section>
  );
}

// O override é PARCIAL: a troca de setor manda só { sectorId, sectorName } e a
// edição manda os campos do contato. Campo PRESENTE vale mesmo vazio (a nota
// apagada chega `null` e não pode voltar à antiga); campo AUSENTE cai no da
// conversa. Lendo o objeto inteiro, trocar o setor apagava o nome do
// cabeçalho; com `??`, a nota e a cidade apagadas voltavam (prova em cópia,
// 24/09/2026).
export function campoDoContato(override, campo, reserva) {
  return override && Object.prototype.hasOwnProperty.call(override, campo) ? override[campo] : reserva;
}

// A mesma regra do ConversationInfoPanel, que este painel substitui.
function podeAlterarSetor(agent, conversation) {
  return Boolean(agent) && (agent.role === 'admin' || agent.role === 'manager' || conversation.assignedAgentId === agent.id);
}

// Formulário de edição NO painel (Apêndice E.3): o modal cobria a conversa de
// onde o atendente copia o nome e a cidade que o cliente escreveu.
function EdicaoDoCliente({ conversation, override, onSalvo, onCancelar }) {
  const { token } = useAuth();
  const { places, status: statusDosLugares, refresh } = usePlaces();
  const [nome, setNome] = useState(campoDoContato(override, 'displayName', conversation.contactDisplayName) ?? '');
  const [municipio, setMunicipio] = useState(campoDoContato(override, 'cityId', conversation.contactCityId) ?? '');
  const [localidade, setLocalidade] = useState(campoDoContato(override, 'localityId', conversation.contactLocalityId) ?? '');
  const [nota, setNota] = useState(campoDoContato(override, 'internalNote', conversation.contactInternalNote) ?? '');
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const id = useId();

  // Município é o que NÃO é localidade (o registro legado não classificado
  // continua aparecendo aqui); povoado nunca ocupa o lugar de município.
  const municipios = useMemo(() => places.filter((p) => p.kind !== 'locality'), [places]);
  const localidades = useMemo(() => (municipio ? places.filter((p) => p.kind === 'locality' && p.parentId === municipio) : []), [places, municipio]);

  async function salvar(evento) {
    evento.preventDefault();
    setErro(null);
    setSalvando(true);
    // A conversa DESTE pedido: quem recebe a resposta decide se ela ainda vale.
    const pedidoDe = conversation.id;
    try {
      const salvo = await updateContact(
        conversation.contactId,
        // A mesma carga de antes (EditContactModal): o nome vai como digitado.
        { displayName: nome, cityId: municipio || null, localityId: localidade || null, internalNote: nota || null },
        token,
      );
      // A resposta traz só os ids; o nome sai da lista que esta tela já tem.
      const nomeDe = (lugar) => (lugar ? places.find((p) => p.id === lugar)?.name || null : null);
      onSalvo(pedidoDe, {
        contactId: conversation.contactId,
        displayName: salvo.displayName,
        cityId: salvo.cityId,
        cityName: nomeDe(salvo.cityId),
        localityId: salvo.localityId,
        localityName: nomeDe(salvo.localityId),
        internalNote: salvo.internalNote,
      });
    } catch (err) {
      setErro(descreverErro(err, 'Não foi possível salvar. Tente de novo.'));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} noValidate className="flex min-h-0 flex-1 flex-col">
      <fieldset disabled={salvando} className="chat-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div>
          <label htmlFor={`${id}-nome`} className="mb-1 block text-rotulo font-medium text-tinta-2">Nome</label>
          <input id={`${id}-nome`} value={nome} onChange={(e) => setNome(e.target.value)} className={CAMPO} />
        </div>
        <div>
          <label htmlFor={`${id}-municipio`} className="mb-1 block text-rotulo font-medium text-tinta-2">Município</label>
          <select
            id={`${id}-municipio`}
            value={municipio}
            // Trocar de município zera a localidade no mesmo passo: a anterior
            // seria uma combinação que o servidor recusa.
            onChange={(e) => { setMunicipio(e.target.value); setLocalidade(''); }}
            disabled={statusDosLugares === 'loading'}
            className={CAMPO}
          >
            <option value="">{statusDosLugares === 'loading' ? 'Carregando…' : 'Nenhum'}</option>
            {municipios.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {statusDosLugares === 'error' && (
            <p role="alert" className="mt-1 text-rotulo text-perigo">
              Não foi possível carregar os municípios.{' '}
              <button type="button" onClick={refresh} className="font-semibold underline">Tentar de novo</button>
            </p>
          )}
        </div>
        <div>
          <label htmlFor={`${id}-localidade`} className="mb-1 block text-rotulo font-medium text-tinta-2">Localidade</label>
          <select
            id={`${id}-localidade`}
            value={localidade}
            onChange={(e) => setLocalidade(e.target.value)}
            disabled={!municipio}
            aria-describedby={!municipio || localidades.length === 0 ? `${id}-localidade-ajuda` : undefined}
            className={CAMPO}
          >
            <option value="">Nenhuma</option>
            {localidades.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          {!municipio && <p id={`${id}-localidade-ajuda`} className="mt-1 text-rotulo text-tinta-3">Escolha o município primeiro.</p>}
          {municipio && localidades.length === 0 && <p id={`${id}-localidade-ajuda`} className="mt-1 text-rotulo text-tinta-3">Nenhuma localidade cadastrada neste município.</p>}
        </div>
        <div>
          <label htmlFor={`${id}-nota`} className="mb-1 block text-rotulo font-medium text-tinta-2">Nota interna</label>
          <p id={`${id}-nota-ajuda`} className="mb-1 text-rotulo text-tinta-3">Visível só para os atendentes.</p>
          <textarea id={`${id}-nota`} value={nota} onChange={(e) => setNota(e.target.value)} aria-describedby={`${id}-nota-ajuda`} rows={3} className={`${CAMPO} h-auto py-2`} />
        </div>
      </fieldset>
      {erro && <p role="alert" className="mx-4 mt-2 rounded-ui-md bg-perigo-fundo px-3 py-2 text-rotulo text-perigo">{erro}</p>}
      <div className="flex shrink-0 justify-end gap-2 border-t border-linha px-4 py-3">
        <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Cancelar</Button>
        <Button type="submit" loading={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
      </div>
    </form>
  );
}

function SetorDaConversa({ conversation, override, onOverride }) {
  const { token, agent } = useAuth();
  const { sectors, status } = useSectors();
  const atual = campoDoContato(override, 'sectorId', conversation.sectorId) ?? '';
  const [valor, setValor] = useState(atual);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const id = useId();

  useEffect(() => { setValor(atual); setErro(null); }, [conversation.id, atual]);

  // O nome do setor fica SEMPRE à vista, como no painel de informações de
  // hoje; quem pode trocar ganha o select embaixo. Só com o select, o setor
  // atual sumia da tela enquanto os setores carregavam (ou se não estivesse na
  // lista) — achado da prova em cópia.
  const linha = <Linha rotulo="Setor">{campoDoContato(override, 'sectorName', conversation.sectorName) ?? 'Não definido'}</Linha>;
  if (!podeAlterarSetor(agent, conversation)) return linha;

  async function trocar(evento) {
    const novo = evento.target.value;
    const anterior = valor;
    setValor(novo);
    setErro(null);
    setSalvando(true);
    try {
      await setConversationSector(conversation.id, novo || null, token);
      onOverride({ sectorId: novo || null, sectorName: sectors.find((s) => s.id === novo)?.name || null });
    } catch (err) {
      // Antes: `.catch(() => {})` — o select ficava no setor novo e o servidor
      // no antigo, sem ninguém saber.
      setValor(anterior);
      setErro(descreverErro(err, 'Não foi possível alterar o setor. Tente de novo.'));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
    {linha}
    <div className="py-1">
      <label htmlFor={`${id}-setor`} className="text-rotulo text-tinta-3">Alterar setor</label>
      <select id={`${id}-setor`} value={valor} onChange={trocar} disabled={salvando || status === 'loading'} className={`${CAMPO} mt-1`}>
        <option value="">{status === 'loading' ? 'Carregando setores…' : 'Selecione um setor'}</option>
        {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {salvando && <p className="mt-1 text-rotulo text-tinta-3">Salvando…</p>}
      {erro && <p role="alert" className="mt-1 text-rotulo text-perigo">{erro}</p>}
    </div>
    </>
  );
}

// Painel Cliente (spec 6.4): o destino do que saiu do cabeçalho e da linha da
// lista, na mesa E no modal de conversa. Só dados reais.
function PainelCliente({ conversation, override, onOverride, onFechar }) {
  const [editando, setEditando] = useState(false);
  const { sectors } = useSectors();
  // A conversa ATUAL, lida na hora em que a resposta chega. Comparar com o
  // `conversation.id` do fechamento não serviria: o fechamento é o do render em
  // que o Salvar foi clicado, e lá o id ainda é o da conversa do pedido.
  const conversaAtualRef = useRef(conversation.id);
  conversaAtualRef.current = conversation.id;
  const overrideRef = useRef(override);
  overrideRef.current = override;

  // O componente não remonta na troca de conversa: modo edição e rascunho
  // morrem aqui, senão o formulário de A aparece aberto em B.
  useEffect(() => { setEditando(false); }, [conversation.id]);

  function aoSalvar(conversaDoPedido, novo) {
    // A resposta que chega depois da troca não vale para a conversa nova
    // (CV-EDC-13, CLASSE-01).
    if (conversaDoPedido !== conversaAtualRef.current) return;
    onOverride({ ...(overrideRef.current || {}), ...novo });
    setEditando(false);
  }

  const nome = campoDoContato(override, 'displayName', conversation.contactDisplayName) || conversation.contactPhoneNumber || 'Conversa';
  const local = nomeDoLocal(campoDoContato(override, 'localityName', conversation.contactLocalityName), campoDoContato(override, 'cityName', conversation.contactCityName));
  const nota = campoDoContato(override, 'internalNote', conversation.contactInternalNote);
  const encerradoEm = conversation.closedAt ? new Date(conversation.closedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null;
  const setorDaIa = conversation.aiTriageCompletedAt ? sectors.find((s) => s.id === conversation.aiTriageSectorId)?.name || 'Não definido' : null;
  const confianca = conversation.aiTriageConfidence != null ? `${Math.round(conversation.aiTriageConfidence * 100)}%` : '—';

  return (
    <aside aria-label="Dados do cliente" className="flex h-full min-h-0 w-full flex-col bg-painel">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-linha px-4">
        <h2 className="min-w-0 flex-1 truncate font-display text-titulo font-semibold text-tinta">{editando ? 'Editar cliente' : 'Dados do cliente'}</h2>
        {!editando && <Button size="sm" variant="secondary" onClick={() => setEditando(true)}>Editar</Button>}
        <button type="button" onClick={onFechar} aria-label="Fechar dados do cliente" className="grid h-9 w-9 place-items-center rounded-ui-md text-tinta-2 hover:bg-hover hover:text-tinta">
          <IconClose size={20} />
        </button>
      </div>
      {editando ? (
        <EdicaoDoCliente conversation={conversation} override={override} onSalvo={aoSalvar} onCancelar={() => setEditando(false)} />
      ) : (
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="flex items-center gap-3 border-b border-linha px-4 py-4">
            <ContactAvatar contactId={conversation.contactId} avatarPath={conversation.contactAvatarPath} displayName={nome} phoneNumber={conversation.contactPhoneNumber} size={52} />
            <div className="min-w-0">
              <p className="truncate text-titulo font-semibold text-tinta">{nome}</p>
              <p className="text-rotulo text-tinta-2">{estadoDaConversa(conversation)}</p>
            </div>
          </div>
          {nota && (
            <Secao titulo="Nota interna">
              <p className="whitespace-pre-wrap break-words text-corpo text-tinta">{nota}</p>
            </Secao>
          )}
          <Secao titulo="Atendimento">
            <dl>
              {conversation.contactPhoneNumber && <Linha rotulo="Telefone"><span className="tabular-nums">{formatPhone(conversation.contactPhoneNumber)}</span></Linha>}
              {conversation.channelName && <Linha rotulo="Canal">{conversation.channelName}</Linha>}
              {conversation.protocolNumber && <Linha rotulo="Protocolo"><span className="tabular-nums">{conversation.protocolNumber}</span></Linha>}
              {local && <Linha rotulo="Cidade">{local}</Linha>}
              <SetorDaConversa conversation={conversation} override={override} onOverride={(parte) => onOverride({ ...(overrideRef.current || {}), ...parte })} />
              <Linha rotulo="Atendente">{conversation.assignedAgentName || 'Não atribuído'}</Linha>
              {encerradoEm && <Linha rotulo="Encerrado em">{encerradoEm}</Linha>}
            </dl>
          </Secao>
          {conversation.aiTriageCompletedAt && (
            <Secao titulo="Triagem por IA">
              <dl>
                <Linha rotulo="Motivo">{conversation.aiTriageReasonName || 'Não definido'}</Linha>
                <Linha rotulo="Setor da IA">{setorDaIa}</Linha>
                <Linha rotulo="Identificação">{IDENTIFICACAO[conversation.aiTriageIdentifiedBy] || 'não identificado'}</Linha>
                <Linha rotulo="Confiança">{conversation.aiTriageLowConfidence ? `${confianca} · baixa` : confianca}</Linha>
                {conversation.aiTriageResolvedByAi && <Linha rotulo="Resultado">Resolvido pela IA</Linha>}
              </dl>
              {conversation.aiTriageSummary && <p className="mt-2 whitespace-pre-wrap break-words text-corpo text-tinta-2">{conversation.aiTriageSummary}</p>}
            </Secao>
          )}
        </div>
      )}
    </aside>
  );
}

export default PainelCliente;
```

**[Prova na cópia, 24/09/2026]** O painel, a linha do setor e o formulário leem o override por `campoDoContato`, não por `??`. Com `??`, a nota e a cidade apagadas, que chegam `null`, voltavam; e o formulário reabria com a cidade antiga — salvar de novo a gravaria de volta.

- [ ] **Step 4: Ligar na `ConversationView`**

Na `ConversationView.jsx`:

- `CustomerPanel` (`:198-247`), `editingContact`/`setEditingContact` (`:282` e a linha dele no reset de `:373-386`), o `EditContactModal` (`:975-988`) e o import (`:16`) saem. `contactOverride` continua, agora alimentado por `onOverride`.
- O nome/avatar do cabeçalho de hoje (`:579-583`) deixa de abrir a edição e passa a abrir e fechar o painel — N5: o texto prometia "ver os dados" e abria edição:

```jsx
        <button
          onClick={() => {
            ultimoGatilhoRef.current = gatilhoClienteRef;
            if (customerPanelOpen && !customerPanelDismissed) {
              setCustomerPanelOpen(false);
              setCustomerPanelDismissed(true);
              return;
            }
            setSgpPanelOpen(false);
            setCustomerPanelOpen(true);
            setCustomerPanelDismissed(false);
          }}
          aria-label={`Dados do cliente: ${headerLabel}`}
          aria-expanded={customerPanelOpen && !customerPanelDismissed}
          className="…a mesma classe de hoje…"
        >
```

  (o conteúdo do botão fica como está; a Task 4 troca o cabeçalho inteiro.)
- `painelAberto` (`:312`) perde o `workspace &&`: o painel Cliente existe também no modal. Até a Task 4, o modal mostra o painel Cliente **e** o painel de informações antigo lado a lado quando aberto — estado intermediário, a branch não é publicada antes do fim da E2.
- O slot (`:1019-1022`) monta o `PainelCliente` **só aberto**, na mesa e no modal:

```jsx
      ) : customerPanelOpen && !customerPanelDismissed ? (
        <div id="conv-painel-cliente" className={classeDoSlot}>
          <PainelCliente
            conversation={conversation}
            override={contactOverride}
            onOverride={setContactOverride}
            onFechar={() => { setCustomerPanelOpen(false); setCustomerPanelDismissed(true); }}
          />
        </div>
      ) : null}
```

  (A montagem só aberta já veio da Task 1; aqui muda o conteúdo e sai o `workspace &&`.)
- **[Prova na cópia, 24/09/2026]** O cabeçalho lê o override **campo a campo**. Hoje ele lê o objeto inteiro (`contactOverride ? contactOverride.displayName : …`). Isso servia quando o override vinha só do modal de edição, com todos os campos. Agora a troca de setor manda só `{ sectorId, sectorName }`, e trocar o setor apagava o nome do cabeçalho: virava "Conversa". O import passa a `import PainelCliente, { campoDoContato } from './PainelCliente';`, e o `displayName`/`cityName` (`:408-414`) passam a:

```jsx
  // O override do painel Cliente é parcial (o setor chega sozinho): cada campo
  // é lido por si, senão trocar o setor apagava o nome daqui.
  const displayName = campoDoContato(contactOverride, 'displayName', conversation.contactDisplayName);
  // "Barão de Tromaí · Cândido Mendes" com localidade; só o município sem ela.
  const cityName = nomeDoLocal(
    campoDoContato(contactOverride, 'localityName', conversation.contactLocalityName),
    campoDoContato(contactOverride, 'cityName', conversation.contactCityName)
  );
```

  A nota passa a vir do override também (CV-EDC-11), porque o painel lê `internalNote` por `campoDoContato`. O reset de `:373-386` continua zerando `contactOverride`.

Apagar `EditContactModal.jsx` e `EditContactModal.test.jsx` (rótulos, carga literal, município → localidade: portados para `PainelCliente.test.jsx`). **[Prova na cópia, 24/09/2026]** Em `overlays.css`, a `.dialog-contact-fields` era só dele e sai: as duas regras soltas (`.dialog-contact-fields {…}` e `.dialog-contact-fields > :nth-child(n+3) {…}`) e, dentro do `@media(max-width:600px)` que também tem regras de canais, só o trecho `.dialog-contact-fields{grid-template-columns:1fr}.dialog-contact-fields>*{grid-column:1!important}`. Conferir com `grep -n "dialog-contact" src/components/overlays.css` → nada.

Em `ConversationView.test.jsx`:

- acrescentar `import { useSectors } from '../hooks/useSectors';`, `vi.mock('../hooks/useSectors');` e, no `beforeEach`, `useSectors.mockReturnValue({ sectors: [{ id: 's1', name: 'Financeiro' }], status: 'ready' });` — o painel agora chama o hook quando abre;
- **[Prova na cópia, 24/09/2026]** "mostra apenas os dados disponíveis do cliente no painel contextual": `within(panel).getByText('Financeiro')` acha dois elementos quando o atendente é o dono — a linha Setor e a `<option>` de "Alterar setor". Passa a `expect(within(panel).getByText('Setor').nextElementSibling).toHaveTextContent('Financeiro');`;
- "the edit-contact trigger's accessible name includes the contact name…" e "clicking the contact name/avatar opens the edit-contact modal" passam a:

```jsx
  test('o nome/avatar do cabeçalho abre o painel Cliente', async () => {
    render(<ConversationView conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactDisplayName: 'Maria' }} onTransferClick={vi.fn()} workspace />);
    const identidade = screen.getByRole('button', { name: /^Dados do cliente: Maria/ });
    await userEvent.click(identidade);
    expect(identidade).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('complementary', { name: 'Dados do cliente' })).toBeInTheDocument();
  });
```

- **[Prova na cópia, 24/09/2026]** "saving in the edit-contact modal updates the header immediately" e "does not carry a contact-name override over to a different conversation" (CLASSE-01 — **o invariante fica, só muda o gatilho**) passam a abrir o painel pelo nome/avatar e editar nele. O nome novo aparece no cabeçalho **e** no painel, então a conferência é pelo nome do botão do cabeçalho:

```jsx
  test('saving in the edit-contact modal updates the header immediately', async () => {
    api.updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Carlos Editado', cityId: null });
    render(
      <ConversationView
        conversation={{ id: 'c1', contactId: 'contact-1', status: 'waiting', assignedAgentId: null, contactDisplayName: 'Carlos' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^Dados do cliente: Carlos/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    await userEvent.clear(screen.getByLabelText(/nome/i));
    await userEvent.type(screen.getByLabelText(/nome/i), 'Carlos Editado');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /^Dados do cliente: Carlos Editado/ })).toBeInTheDocument());
  });

  test('does not carry a contact-name override over to a different conversation', async () => {
    api.updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Carlos Editado', cityId: null });
    const { rerender } = render(
      <ConversationView
        conversation={{ id: 'c1', contactId: 'contact-1', status: 'waiting', assignedAgentId: null, contactDisplayName: 'Carlos' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^Dados do cliente: Carlos/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    await userEvent.clear(screen.getByLabelText(/nome/i));
    await userEvent.type(screen.getByLabelText(/nome/i), 'Carlos Editado');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Dados do cliente: Carlos Editado/ })).toBeInTheDocument());

    rerender(
      <ConversationView
        conversation={{ id: 'c2', contactId: 'contact-2', status: 'waiting', assignedAgentId: null, contactDisplayName: 'Maria' }}
        onTransferClick={vi.fn()}
      />
    );

    expect(screen.getByText('Maria')).toBeInTheDocument();
    expect(screen.queryByText('Carlos Editado')).not.toBeInTheDocument();
  });
```

- **[Prova na cópia, 24/09/2026]** e acrescentar o teste do defeito do override parcial:

```jsx
  // Achado da prova em cópia (24/09/2026): o override do setor é parcial, e o
  // cabeçalho lia o objeto inteiro — trocar o setor virava "Conversa".
  test('trocar o setor no painel não apaga o nome do cabeçalho', async () => {
    useSectors.mockReturnValue({ sectors: [{ id: 's1', name: 'Financeiro' }, { id: 's2', name: 'Suporte' }], status: 'ready' });
    render(<ConversationView conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactDisplayName: 'Maria', contactCityName: 'Cândido Mendes', sectorId: 's1', sectorName: 'Financeiro' }} onTransferClick={vi.fn()} workspace />);
    await userEvent.click(screen.getByRole('button', { name: /^Dados do cliente: Maria/ }));
    await userEvent.selectOptions(screen.getByLabelText('Alterar setor'), 's2');
    await waitFor(() => expect(screen.getByText('Setor').nextElementSibling).toHaveTextContent('Suporte'));
    expect(screen.getByRole('button', { name: /^Dados do cliente: Maria/ })).toBeInTheDocument();
  });
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/PainelCliente.test.jsx src/components/ConversationView src/components/ConversationModal.test.jsx src/pages/DashboardPage.test.jsx src/pages/SupervisionPage.test.jsx`
Expected: PASS.

- [ ] **Step 6: Provar a guarda por mutação**

Em `aoSalvar`, trocar `conversaAtualRef.current` por `conversation.id`. Rodar `PainelCliente.test.jsx`.
Expected: FAIL em "salvamento que termina depois da troca de conversa não vale para a nova" — é exatamente o erro de quem compara com o id do fechamento. Desfazer.

**[Prova na cópia, 24/09/2026]** E o override parcial: na `ConversationView`, voltar o `displayName` para `contactOverride ? contactOverride.displayName : conversation.contactDisplayName`. Rodar `ConversationView.test.jsx -t "trocar o setor"`.
Expected: FAIL (o botão vira "Dados do cliente: Conversa"). Desfazer. No `PainelCliente`, trocar a `nota` por `(override || {}).internalNote ?? conversation.contactInternalNote`. Rodar `PainelCliente.test.jsx -t "override parcial"`.
Expected: FAIL (a nota apagada volta). Desfazer.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src/components/PainelCliente.jsx frontend/src/components/PainelCliente.test.jsx frontend/src/components/ConversationView.jsx frontend/src/components/ConversationView.test.jsx frontend/src/components/EditContactModal.jsx frontend/src/components/EditContactModal.test.jsx frontend/src/components/overlays.css
git commit -m "E2.4: painel Cliente com dados, edicao no proprio painel e troca de setor; sai o modal de edicao"
```

---

### Task 4: Cabeçalho em 2 linhas, o painel lateral na pilha e o modal de conversa

**Files:**
- Create: `frontend/src/components/CabecalhoDaConversa.jsx`
- Modify: `frontend/src/components/ConversationView.jsx:141-154` (`channelLine`, `conversationStatus` saem), `:156-196` (`ACTION*`, `HeaderChip`, `HeaderIconButton` saem), `:320-341` (ESC do painel), `:561-695` (cabeçalho e barra de contexto), `:996-1002` ("Voltar à conversa")
- Modify: `frontend/src/components/ConversationModal.jsx` (× no cabeçalho da conversa; sai o `ConversationInfoPanel`)
- Delete: `frontend/src/components/ConversationInfoPanel.jsx`, `ConversationInfoPanel.test.jsx`
- Modify: `frontend/src/components/ConversationView.test.jsx`, `frontend/src/components/ConversationModal.test.jsx`, `frontend/src/pages/SupervisionPage.test.jsx`, `frontend/src/pages/DashboardPage.test.jsx`
- Modify: `frontend/src/pages/DashboardPage.jsx` (a `ConversationView` da mesa ganha `onEncerrado={avisarNaMesa}`) **[Prova na cópia, 24/09/2026]**

Spec 6.3: cabeçalho de 64 px em 2 linhas — avatar 40 **neutro** (sai o disco laranja→cobre, `dark`), linha 1 nome (16/600), linha 2 em texto corrido por prioridade com `@container`: estado (P5) · setor · telefone · protocolo · localidade. Ações à direita: Assumir (primário — só sem responsável), Transferir (secundário, ícone + rótulo), Encerrar (secundário **neutro**: o vermelho vai para a confirmação), divisória, botões de ícone Histórico (`aria-haspopup="dialog"`), SGP e Cliente (`aria-expanded`, fundo selecionado quando abertos). **A barra de contexto sai** (o setor aparecia nela pela 3ª vez). No modal (Supervisão, Encerrados), o × vira o último botão do cabeçalho, "Fechar conversa", e a seta "Voltar para a lista" não aparece (anexo C §2.3). O clique no nome/avatar abre o painel Cliente (N5: o texto prometia "ver os dados" e abria edição). O painel lateral entra na pilha como **camada leve** (sai o ouvinte de ESC próprio de `:331-341`, que desistia sempre que havia `[data-dialog]` — dentro do modal, sempre). E o modal de conversa perde o painel de informações: o painel Cliente (Task 3) o substitui, aberto pelo botão "Dados do cliente" do cabeçalho — fechado por padrão (D4).

- [ ] **Step 1: Atualizar e escrever os testes**

Em `ConversationView.test.jsx`, acrescentar:

```jsx
describe('cabeçalho (spec 6.3)', () => {
  const conversa = { id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactDisplayName: 'Maria', contactPhoneNumber: '+5598985004187', sectorName: 'Financeiro', protocolNumber: '20260924-0007', contactCityName: 'Cândido Mendes' };

  test('duas linhas: nome; estado · setor · telefone · protocolo · localidade — e sem barra de contexto', () => {
    const { container } = render(<ConversationView conversation={conversa} onTransferClick={vi.fn()} workspace />);
    const linha2 = container.querySelector('[data-cabecalho-linha2]');
    expect(linha2).toHaveTextContent(/Em atendimento.*Financeiro.*98.*20260924-0007.*Cândido Mendes/);
    expect(container.querySelector('.chat-workspace-context')).toBeNull();
    expect(screen.getAllByText('Financeiro')).toHaveLength(1);
  });

  test('Encerrar é secundário neutro; o vermelho fica na confirmação', () => {
    render(<ConversationView conversation={conversa} onTransferClick={vi.fn()} workspace />);
    expect(screen.getByRole('button', { name: 'Encerrar atendimento' }).className).not.toMatch(/perigo|error/);
  });

  test('Histórico declara que abre diálogo; SGP e Cliente alternam painel', async () => {
    render(<ConversationView conversation={conversa} onTransferClick={vi.fn()} workspace />);
    expect(screen.getByRole('button', { name: 'Ver atendimentos anteriores' })).toHaveAttribute('aria-haspopup', 'dialog');
    const sgp = screen.getByRole('button', { name: 'Consultar SGP' });
    expect(sgp).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(sgp);
    expect(sgp).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Dados do cliente' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('no modal: "Fechar conversa" é o último botão do cabeçalho e não há "Voltar para a lista"', async () => {
    const onFechar = vi.fn();
    render(<ConversationView conversation={conversa} onTransferClick={vi.fn()} onFechar={onFechar} />);
    expect(screen.queryByRole('button', { name: 'Voltar para a lista' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar conversa' }));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });
});
```

E o ESC dentro do modal (CVM-MOD-10), em `ConversationModal.test.jsx`:

```jsx
  test('ESC com o painel SGP aberto fecha o painel; o segundo ESC fecha o modal', async () => {
    const onClose = vi.fn();
    render(<ConversationModal conversation={{ id: 'c1', status: 'closed', contactDisplayName: 'Ana', contactSgpDocument: '12345678909' }} onClose={onClose} />);
    expect(screen.getByRole('region', { name: 'Consulta SGP' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Consulta SGP' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
```

(`ConversationModal.test.jsx` passa a simular `useSgpLookup` — `vi.mock('../hooks/useSgpLookup')` com o retorno vazio que `ConversationView.test.jsx` usa; na prova em cópia, bastou — e `useSectors`, com `{ sectors: [], status: 'ready' }`, porque o painel Cliente abre dentro do modal.) Os testes de `ConversationModal.test.jsx` "o botão fechar existe e não depende da largura da tela" e "closing via the conversation view's back button calls onClose" passam a achar "Fechar conversa" no cabeçalho da conversa (sem `data-dialog-close`) e a afirmar que não há "Voltar para a lista".

Em `ConversationModal.jsx`, só o necessário para o × morar no cabeçalho (o resto do modal é da E2.5, Task 7): `dismissible` → `dismissible={false}` (a prop controla só o ×; o ESC continua chamando `onClose`), e a `ConversationView` recebe `onFechar={onClose}` no lugar de `onBack={onClose}`:

```jsx
        <ConversationView conversation={conversation} onTransferClick={onTransferClick} onFechar={onClose} />
```

e sai o painel de informações: o `import ConversationInfoPanel` e o `<ConversationInfoPanel conversation={conversation} />`; `orientation="row"` fica (a conversa + o slot do painel, dentro da própria `ConversationView`). Apagar `ConversationInfoPanel.jsx` e `ConversationInfoPanel.test.jsx` — os 9 testes foram portados na Task 3 para `PainelCliente.test.jsx` (nota, protocolo, bloco de triagem, identificação, as 4 regras do setor).

Em `ConversationModal.test.jsx`:

- "renders the conversation inside a dialog" ganha o D4: o `complementary` "Dados do cliente" **não** existe antes do clique; depois de clicar em "Dados do cliente" (o botão de ícone do cabeçalho), ele existe e tem o nome do contato e o estado ("Em atendimento", do vocabulário único).
- A linha 39 tem dois caracteres de *backspace* (0x08) literais dentro da regex (`/\b(hidden|md:flex|…)\b/` foi gravado com o `\b` virado byte): o `not.toMatch` passava sempre. Reescrever com `\b` de verdade — ou, como o × mudou de lugar, trocar a asserção pela desta tarefa ("Fechar conversa" no cabeçalho, sem `data-dialog-close`).

Testes de outras páginas que dependiam do cabeçalho antigo (a prova em cópia achou três):

- `SupervisionPage.test.jsx`, "clicking a card opens the conversation in a popup": o painel nasce fechado no modal (D4) — clicar em "Dados do cliente" dentro do diálogo antes de procurar o nome do contato.
- `SupervisionPage.test.jsx`, "closing the conversation popup returns to the dashboard view": clicar em "Fechar conversa" no lugar de "Voltar para a lista".
- `DashboardPage.test.jsx`: todo teste que acha a conversa aberta pelo `title` do nome/telefone no cabeçalho (`getByTitle('5511…')`) passa a `getByRole('button', { name: /^Dados do cliente: <nome>/ })` — o `title` saiu com o cabeçalho antigo.

**[Prova na cópia, 24/09/2026]** O aviso de encerrado na mesa (E.3) não tinha teste nem quem o ligasse: a E2.3 (Task 9) deixava a ligação "para a E2.4 (Task 4)", e esta tarefa dizia "(E2.3 Task 9)". Fica aqui. Em `ConversationView.test.jsx`, acrescentar:

```jsx
  test('encerrar com motivo avisa a mesa com o nome do cliente', async () => {
    api.closeConversation.mockResolvedValue({});
    const onEncerrado = vi.fn();
    render(<ConversationView conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactDisplayName: 'Maria' }} onTransferClick={vi.fn()} onEncerrado={onEncerrado} />);
    await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));
    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /encerrar atendimento/i }));
    await waitFor(() => expect(onEncerrado).toHaveBeenCalledWith('Atendimento de Maria encerrado.'));
  });
```

Em `DashboardPage.test.jsx`, depois dos outros `vi.mock`:

```jsx
// O motivo do Encerrar vem daqui; só o diálogo de motivo o chama.
vi.mock('../hooks/useReasons', () => ({
  useReasons: () => ({ reasons: [{ id: 'r1', name: 'Troca de senha', active: true }], loading: false, refresh: vi.fn() }),
}));
```

e, junto do teste de transferir:

```jsx
  test('encerrar pela conversa: a mesa vazia confirma (E.3)', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c2', contactDisplayName: 'Maria', status: 'assigned', assignedAgentId: 'agent-1' }], status: 'ready' });
    renderDashboard();
    await userEvent.click(screen.getByText('Maria'));
    await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));
    await userEvent.click(screen.getByLabelText('Troca de senha'));
    // Como o socket faz de verdade: a conversa encerrada sai de "Meus".
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /encerrar atendimento/i }));
    expect(await screen.findByText('Atendimento de Maria encerrado.')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ConversationView.test.jsx src/components/ConversationModal.test.jsx src/pages/DashboardPage.test.jsx`
Expected: FAIL nos novos.

- [ ] **Step 3: Implementar**

`frontend/src/components/CabecalhoDaConversa.jsx`:

```jsx
import ContactAvatar from './ContactAvatar';
import { formatPhone } from '../utils/phone';
import { IconArrowLeft, IconCheckCircle, IconClaim, IconClose, IconHistory, IconSearch, IconTransfer, IconUser } from './icons/IconesTrabalho';

const ACAO = 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-ui-md px-3 text-corpo font-medium transition duration-120 active:translate-y-px motion-reduce:active:translate-y-0';
const SECUNDARIO = `${ACAO} border border-linha text-tinta hover:bg-hover`;
const PRIMARIO = `${ACAO} bg-accent text-on-accent hover:bg-accent-strong`;
const ICONE = 'grid h-9 w-9 shrink-0 place-items-center rounded-ui-md text-tinta-2 transition-colors duration-120 hover:bg-hover hover:text-tinta';

function Separador() {
  return <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-tinta-3" />;
}

// Cabeçalho em 2 linhas (spec 6.3). A linha 2 encolhe por prioridade pela
// LARGURA DO PRÓPRIO CABEÇALHO (@container), não da janela: estado · setor ·
// telefone · protocolo · localidade. A barra de contexto saiu — o setor
// aparecia nela pela terceira vez na tela.
function CabecalhoDaConversa({
  conversation,
  nomeDoContato,
  local,
  estado,
  podeAssumir,
  podeTransferirEEncerrar,
  onVoltar,
  onAssumir,
  onTransferir,
  onEncerrar,
  onHistorico,
  sgpAberto,
  onSgp,
  clienteAberto,
  onCliente,
  gatilhoSgpRef,
  gatilhoClienteRef,
  onFechar,
}) {
  const telefone = conversation.contactPhoneNumber ? formatPhone(conversation.contactPhoneNumber) : null;
  const rotuloIdentidade = local ? `${nomeDoContato} - ${local}` : nomeDoContato;
  return (
    <div className="@container flex h-16 shrink-0 items-center gap-2 border-b border-linha bg-painel px-2 md:px-4">
      {onVoltar && (
        <button type="button" onClick={onVoltar} aria-label="Voltar para a lista" className={`${ICONE} lg:hidden`}>
          <IconArrowLeft size={20} />
        </button>
      )}
      <button
        type="button"
        onClick={onCliente}
        aria-label={`Dados do cliente: ${rotuloIdentidade}`}
        aria-expanded={clienteAberto}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-ui-md px-1 py-1 text-left transition-colors duration-120 hover:bg-hover"
      >
        <ContactAvatar contactId={conversation.contactId} avatarPath={conversation.contactAvatarPath} displayName={nomeDoContato} phoneNumber={conversation.contactPhoneNumber} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-titulo font-semibold text-tinta">{nomeDoContato}</span>
          <span data-cabecalho-linha2="" className="flex min-w-0 items-center gap-1.5 overflow-hidden text-rotulo text-tinta-2">
            <span className="shrink-0">{estado}</span>
            {conversation.sectorName && <><Separador /><span className="hidden min-w-0 truncate @min-[480px]:inline">{conversation.sectorName}</span></>}
            {telefone && <><Separador /><span className="hidden shrink-0 tabular-nums @min-[600px]:inline">{telefone}</span></>}
            {conversation.protocolNumber && <><Separador /><span className="hidden shrink-0 tabular-nums @min-[720px]:inline">{conversation.protocolNumber}</span></>}
            {local && <><Separador /><span className="hidden min-w-0 truncate @min-[840px]:inline">{local}</span></>}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-2">
        {podeAssumir && (
          <button type="button" onClick={onAssumir} className={PRIMARIO}>
            <IconClaim size={18} />
            Assumir
          </button>
        )}
        {podeTransferirEEncerrar && (
          <>
            <button type="button" onClick={onTransferir} aria-label="Transferir atendimento" className={`${SECUNDARIO} w-9 px-0 @min-[520px]:w-auto @min-[520px]:px-3`}>
              <IconTransfer size={18} />
              <span className="hidden @min-[520px]:inline">Transferir</span>
            </button>
            <button type="button" onClick={onEncerrar} aria-label="Encerrar atendimento" className={`${SECUNDARIO} w-9 px-0 @min-[520px]:w-auto @min-[520px]:px-3`}>
              <IconCheckCircle size={18} />
              <span className="hidden @min-[520px]:inline">Encerrar</span>
            </button>
          </>
        )}
        <span aria-hidden="true" className="mx-1 h-6 w-px bg-linha" />
        <button type="button" onClick={onHistorico} aria-label="Ver atendimentos anteriores" aria-haspopup="dialog" className={ICONE}>
          <IconHistory size={20} />
        </button>
        <button type="button" ref={gatilhoSgpRef} onClick={onSgp} aria-label="Consultar SGP" aria-expanded={sgpAberto} aria-controls={sgpAberto ? 'conv-painel-sgp' : undefined} className={`${ICONE} ${sgpAberto ? 'bg-selecionado text-tinta' : ''}`}>
          <IconSearch size={20} />
        </button>
        <button type="button" ref={gatilhoClienteRef} onClick={onCliente} aria-label="Dados do cliente" aria-expanded={clienteAberto} aria-controls={clienteAberto ? 'conv-painel-cliente' : undefined} className={`${ICONE} ${clienteAberto ? 'bg-selecionado text-tinta' : ''}`}>
          <IconUser size={20} />
        </button>
        {onFechar && (
          <>
            <span aria-hidden="true" className="mx-1 h-6 w-px bg-linha" />
            <button type="button" onClick={onFechar} aria-label="Fechar conversa" className={ICONE}>
              <IconClose size={20} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default CabecalhoDaConversa;
```

Na `ConversationView.jsx`:

- Props: `function ConversationView({ conversation, onTransferClick, onBack, painelModo = 'coluna', onPainelAbertoChange, workspace = false, onEncerrado, onFechar })`.
- `ACTION`, `ACTION_SECONDARY`, `ACTION_PRIMARY`, `ACTION_DANGER`, `HeaderChip` e `HeaderIconButton` saem (`:156-196`).
- `conversationStatus` (`:148-154`) sai — o cabeçalho novo usa `estadoDaConversa` (Task 1). Com o cabeçalho antigo saem também o que só servia a ele: `channelLine` (`:141-147`), `phoneLine`, `secondLine`, `statusPhone`, e os imports que ficarem sem uso (`IconHistory`, `IconTransfer`, `IconCheckCircle`, `IconClaim`, `IconSearch`, `IconInfo`, `IconChevronDown`, `ContactAvatar`, `formatPhone` — conferir cada um com `grep` no arquivo depois de apagar).
- `const clienteAberto = customerPanelOpen && !customerPanelDismissed;` (o painel já existe no modal desde a Task 3).
- O efeito de ESC do painel (`:331-341`) sai e entra, no lugar dele: `useCamadaLeve(painelAberto, fecharPaineisEDevolverFoco);` (import de `./ui/camadaLeve`). `fecharPaineis` (`:353-357`, morta) sai.
- `aria-expanded` do Cliente mentia com o SGP por cima (dossiê, surpresa 4): abrir o SGP fecha o Cliente (`alternarSgp`, abaixo).
- O cabeçalho e a barra de contexto (`:561-695`) viram:

```jsx
      <CabecalhoDaConversa
        conversation={conversation}
        nomeDoContato={nameLabel}
        local={cityName}
        estado={estadoDaConversa(conversation)}
        podeAssumir={isUnassigned}
        podeTransferirEEncerrar={isMine || isUnassigned || isAdmin}
        onVoltar={onFechar ? undefined : onBack}
        onAssumir={handleClaim}
        onTransferir={() => onTransferClick(conversation.id)}
        onEncerrar={() => setClosingReason(true)}
        onHistorico={() => setShowingHistory(true)}
        sgpAberto={sgpPanelOpen}
        onSgp={alternarSgp}
        clienteAberto={clienteAberto}
        onCliente={alternarCliente}
        gatilhoSgpRef={gatilhoSgpRef}
        gatilhoClienteRef={gatilhoClienteRef}
        onFechar={onFechar}
      />
```

com, no corpo:

```jsx
  // Abrir um painel fecha o outro: sem isto o `aria-expanded` do Cliente
  // continuava "true" com o SGP por cima dele (dossiê da conversa, surpresa 4).
  // A Task 5 acrescenta a memória da escolha em abrir/fechar o SGP.
  function alternarSgp() {
    ultimoGatilhoRef.current = gatilhoSgpRef;
    if (sgpPanelOpen) {
      setSgpPanelOpen(false);
      return;
    }
    setCustomerPanelOpen(false);
    setSgpPanelOpen(true);
  }
  function alternarCliente() {
    ultimoGatilhoRef.current = gatilhoClienteRef;
    if (clienteAberto) {
      setCustomerPanelOpen(false);
      setCustomerPanelDismissed(true);
      return;
    }
    setSgpPanelOpen(false);
    setCustomerPanelOpen(true);
    setCustomerPanelDismissed(false);
  }
```

- `handleConfirmClose` (`:531-534`) avisa a mesa: depois do `closeConversation`, `if (onEncerrado) onEncerrado(\`Atendimento de ${nameLabel} encerrado.\`);`. **[Prova na cópia, 24/09/2026]** Na `DashboardPage.jsx`, a `ConversationView` da mesa ganha `onEncerrado={avisarNaMesa}`. A função vem da E2.3 (Task 9); a ligação é desta tarefa.
- "Voltar à conversa" (`:996-1002`) troca `chat-painel-voltar` por `flex h-11 shrink-0 items-center gap-2 border-b border-linha bg-painel px-4 text-rotulo font-semibold text-accent-soft` (a regra sai de `dashboard.css` na Task 1).

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/ConversationView src/components/ConversationModal.test.jsx src/components/PainelCliente.test.jsx src/pages/DashboardPage.test.jsx src/pages/SupervisionPage.test.jsx src/estilo`
Expected: PASS — inclui os de assumir/transferir/encerrar por nome, "Voltar para a lista na mesa", os modos largo/trilho/alternado da `DashboardPage` ("Dados do cliente" exato continua único: a identidade tem nome mais longo).

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/components/CabecalhoDaConversa.jsx frontend/src/components/ConversationView.jsx frontend/src/components/ConversationView.test.jsx frontend/src/components/ConversationModal.jsx frontend/src/components/ConversationModal.test.jsx frontend/src/components/ConversationInfoPanel.jsx frontend/src/components/ConversationInfoPanel.test.jsx frontend/src/pages/SupervisionPage.test.jsx frontend/src/pages/DashboardPage.test.jsx frontend/src/pages/DashboardPage.jsx
git commit -m "E2.4: cabecalho em duas linhas sem barra de contexto; painel lateral pela camada leve; modal sem o painel de informacoes"
```

---

### Task 5: Painel SGP numa superfície, QR sob demanda e o aviso de encerrado

**Files:**
- Modify: `frontend/src/components/SgpLookupPanel.jsx:1-2,31-88,102-121,141-150,232-243,259,288-345`
- Modify: `frontend/src/utils/armazenamentoLocal.js` (sessão), `frontend/src/setupTests.js` (limpa a sessão entre testes)
- Modify: `frontend/src/components/ConversationView.jsx` (abertura automática com memória; `encerrada` para o painel)
- Modify: `frontend/src/components/SgpLookupPanel.test.jsx`, `frontend/src/components/ConversationView.test.jsx`
- Modify: `frontend/src/components/overlays.css:189-192` (sai `.dialog-sgp-panel …`)

Spec 6.4: uma superfície só (sai o aninhamento de até 4 camadas: slot → `aside` → `Block` com borda → ação com borda); seções separadas por linha; ações Pix/boleto/PDF/link como linhas de ação com ícone (saem as cores literais dos ícones e o "enviado" verde). `qrcode` passa a `import()` sob demanda. **Abertura automática lembra a escolha na sessão** (decisão do proprietário): se o atendente fechou o SGP, as próximas conversas abrem sem ele até ele reabrir — em `sessionStorage`, pelo utilitário protegido. **Decisão 4:** conversa encerrada mostra, no topo do painel, "Atendimento encerrado — a cobrança vai direto ao cliente"; nada é bloqueado. (O backend aceita Pix, QR, código de barras e PDF numa encerrada do próprio atendente e recusa o texto com 409 — o "Link Fatura" falha com o erro de hoje, "Não foi possível enviar. Tente de novo.", em `role="alert"`.)

Seção 9, um `role="status"` por tela: o painel tem hoje quatro ("Buscando no SGP…", "Cliente não encontrado…", "Consultando o SGP…", "{ação} enviado para o cliente"), somados ao da conversa. Passam a morar em dois contêineres `aria-live="polite"` sem `role`, **sempre montados** e envolvendo o próprio texto visível (um no corpo do painel, outro na seção Financeiro). Não pode ser a região da casca: dentro do modal de conversa (`aria-modal`), o leitor de tela ignora o resto da página. E não pode ser uma região `sr-only` à parte: o texto apareceria duas vezes e os `getByText` de `SgpLookupPanel.test.jsx:66,227` achariam dois elementos. Erros continuam `role="alert"`.

- [ ] **Step 1: Escrever os testes**

Em `SgpLookupPanel.test.jsx`, "clicking 'Ver QR' generates and shows a QR code image…" passa a esperar a geração em `waitFor` (o import é assíncrono):

```jsx
    await waitFor(() => expect(QRCode.toDataURL).toHaveBeenCalledWith('000201...'));
```

e, no fim do arquivo:

```jsx
describe('E2.4: encerrada, anúncios e superfície', () => {
  function comFatura(props = {}) {
    useSgpLookup.mockReturnValue({
      ...BASE_HOOK,
      client: CLIENT,
      contracts: [CONTRACT_A],
      duplicateState: { 17402: { loading: false, error: null, hasOpenInvoice: true, duplicates: [DUPLICATE] } },
    });
    render(
      <SgpLookupPanel
        onSendMessage={vi.fn().mockResolvedValue({})}
        onSendPdf={vi.fn().mockResolvedValue({})}
        onSendPix={vi.fn().mockResolvedValue([])}
        onSendPixQr={vi.fn().mockResolvedValue([])}
        onSendBarcode={vi.fn().mockResolvedValue([])}
        {...props}
      />
    );
  }

  test('atendimento encerrado: aviso no topo, e os envios continuam disponíveis (decisão 4)', () => {
    comFatura({ encerrada: true });
    expect(screen.getByText('Atendimento encerrado — a cobrança vai direto ao cliente')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cód pix/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^link fatura$/i })).toBeEnabled();
  });

  test('conversa aberta: sem o aviso', () => {
    comFatura();
    expect(screen.queryByText(/Atendimento encerrado/)).not.toBeInTheDocument();
  });

  test('Link Fatura recusado numa encerrada (409): o erro de hoje, em alerta', async () => {
    const onSendMessage = vi.fn().mockRejectedValue({ status: 409, body: { error: 'Conversation is not currently assigned to you, or is closed' } });
    comFatura({ encerrada: true, onSendMessage });
    await userEvent.click(screen.getByRole('button', { name: /^link fatura$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível enviar. Tente de novo.');
  });

  test('enviado: o texto nasce dentro de um aria-live já montado, e o painel não tem role="status"', async () => {
    comFatura();
    await userEvent.click(screen.getByRole('button', { name: /cód pix/i }));
    const enviado = await screen.findByText('Cód Pix enviado para o cliente');
    expect(enviado.closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Consulta SGP' }).querySelectorAll('[role="status"]')).toHaveLength(0);
  });

  test('cliente não encontrado: dentro do aria-live do corpo, sem role="status"', () => {
    useSgpLookup.mockReturnValue({ ...BASE_HOOK, error: 'not_found' });
    render(<SgpLookupPanel onSendMessage={vi.fn()} onSendPdf={vi.fn()} />);
    const texto = screen.getByText(/cliente não encontrado/i);
    expect(texto.closest('[aria-live="polite"]')).not.toBeNull();
    expect(texto.closest('[role="status"]')).toBeNull();
  });

  test('uma superfície só: nenhuma seção nem ação com moldura', () => {
    comFatura();
    const painel = screen.getByRole('region', { name: 'Consulta SGP' });
    expect(painel.querySelectorAll('section[class*="border "], section[class*="rounded"], button[class*="border "]')).toHaveLength(0);
  });
});
```

Em `ConversationView.test.jsx`, acrescentar:

```jsx
describe('memória do SGP na sessão (spec 6.4)', () => {
  const a = { id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactSgpDocument: '12345678909' };
  const b = { id: 'c2', status: 'assigned', assignedAgentId: 'agent-1', contactSgpDocument: '98765432100' };

  test('fechado à mão numa conversa com CPF, a próxima abre sem ele; reabrir volta a abrir sozinho', async () => {
    const { rerender } = render(<ConversationView conversation={a} onTransferClick={vi.fn()} workspace />);
    expect(screen.getByRole('region', { name: 'Consulta SGP' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar consulta SGP' }));

    rerender(<ConversationView conversation={b} onTransferClick={vi.fn()} workspace />);
    expect(screen.queryByRole('region', { name: 'Consulta SGP' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Consultar SGP' }));
    rerender(<ConversationView conversation={a} onTransferClick={vi.fn()} workspace />);
    expect(screen.getByRole('region', { name: 'Consulta SGP' })).toBeInTheDocument();
  });

  test('fechar pelo ESC também conta como escolha', async () => {
    const { rerender } = render(<ConversationView conversation={a} onTransferClick={vi.fn()} workspace />);
    await userEvent.keyboard('{Escape}');
    rerender(<ConversationView conversation={b} onTransferClick={vi.fn()} workspace />);
    expect(screen.queryByRole('region', { name: 'Consulta SGP' })).not.toBeInTheDocument();
  });

  test('conversa encerrada passa o aviso ao painel', () => {
    render(<ConversationView conversation={{ ...a, status: 'closed', closedAt: '2026-09-24T15:30:00.000Z' }} onTransferClick={vi.fn()} />);
    expect(screen.getByText('Atendimento encerrado — a cobrança vai direto ao cliente')).toBeInTheDocument();
  });
});
```

O teste de CLASSE-01 "o painel fecha na troca sem CPF" continua valendo sem mudança (conversa sem CPF nunca abre sozinha).

Em `frontend/src/setupTests.js`, no fim — a memória do SGP vive na sessão da aba, e o jsdom mantém a mesma janela entre os testes de um arquivo: sem isto, um teste que fecha o SGP faria o seguinte achar o painel fechado:

```js
import { afterEach } from 'vitest';

// A sessão da aba (memória do painel SGP) não pode vazar de um teste para o
// outro: o jsdom mantém a mesma janela durante o arquivo inteiro.
afterEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    // sem sessionStorage, nada a limpar
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/SgpLookupPanel.test.jsx src/components/ConversationView.test.jsx`
Expected: FAIL nos novos.

- [ ] **Step 3: Implementar a memória e o aviso na `ConversationView`**

`utils/armazenamentoLocal.js`, acrescentar (mesmo contrato das funções de `localStorage`: toda falha vira "não tem nada guardado"):

```js
// O mesmo cuidado para a sessão da aba (a memória do painel SGP vale até a aba
// fechar — decisão do proprietário, spec 6.4).
export function lerSessao(chave) {
  try {
    return sessionStorage.getItem(chave);
  } catch {
    return null;
  }
}

export function gravarSessao(chave, valor) {
  try {
    sessionStorage.setItem(chave, valor);
    return true;
  } catch {
    return false;
  }
}
```

`ConversationView.jsx`:

```jsx
import { lerSessao, gravarSessao } from '../utils/armazenamentoLocal';

// '1' = o atendente fechou o SGP nesta aba; as próximas conversas abrem sem ele
// até ele reabrir. Trocar para o painel Cliente não conta: é troca de painel,
// não recusa do SGP.
const CHAVE_SGP = 'dw_sgp_fechado_na_sessao';
```

No efeito de troca de conversa, a linha da abertura automática passa a:

```jsx
    setSgpPanelOpen(Boolean(conversation.contactSgpDocument) && lerSessao(CHAVE_SGP) !== '1');
```

O `alternarSgp` da Task 4 passa a gravar a escolha, e o × do painel e o ESC também:

```jsx
  function abrirSgp() {
    gravarSessao(CHAVE_SGP, '0');
    setCustomerPanelOpen(false);
    setSgpPanelOpen(true);
  }
  function fecharSgp() {
    gravarSessao(CHAVE_SGP, '1');
    setSgpPanelOpen(false);
  }
  function alternarSgp() {
    ultimoGatilhoRef.current = gatilhoSgpRef;
    if (sgpPanelOpen) fecharSgp();
    else abrirSgp();
  }
```

em `fecharPaineisEDevolverFoco` (ESC e "Voltar à conversa") **acrescentar**, como nova primeira linha, antes do `setSgpPanelOpen(false)` que já está lá, `if (sgpPanelOpen) gravarSessao(CHAVE_SGP, '1');` — o resto da função fica igual; e o painel recebe `onClose={fecharSgp}` e `encerrada={estaEncerrada(conversation)}`.

- [ ] **Step 4: Implementar o painel**

`SgpLookupPanel.jsx`:

- `:2` `import QRCode from 'qrcode';` sai; `handleToggleQr` (`:102-109`) passa a:

```jsx
  async function handleToggleQr(pixCode) {
    if (qrDataUrl) {
      setQrDataUrl(null);
      return;
    }
    // Sob demanda (spec 6.4): o gerador de QR só baixa quando alguém pede "Ver
    // QR" — antes vinha no trecho da conversa para todo atendimento.
    const { default: QRCode } = await import('qrcode');
    setQrDataUrl(await QRCode.toDataURL(pixCode));
  }
```

- `Block` e `SectionLabel` (`:31-42`) passam a seções separadas por linha, sem moldura:

```jsx
// Uma superfície só (spec 6.4): seção separada por linha, sem moldura nem
// fundo próprio — eram até 4 camadas sob o texto.
function Block({ children }) {
  return <section className="border-b border-linha px-4 py-3">{children}</section>;
}

function SectionLabel({ children }) {
  return <h3 className="px-4 pb-1 pt-3 text-rotulo font-semibold text-tinta-2">{children}</h3>;
}
```

- `Chip`/`StatusChip` (`:44-65`) passam a — a mesma regra de hoje (`status === 'Ativo'`), o verde trocado por forma:

```jsx
// Sem verde (não existe cor de sucesso, 5.2.2): o estado do contrato é dito
// por FORMA — ponto cheio para "Ativo", vazado para o resto (P8).
const TONS = {
  neutral: 'bg-hover text-tinta-2',
  warn: 'bg-aviso-fundo text-aviso',
};

function Chip({ children, tone = 'neutral' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-meta font-medium ${TONS[tone] || TONS.neutral}`}>
      {children}
    </span>
  );
}

function StatusChip({ status }) {
  const active = status === 'Ativo';
  return (
    <Chip>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-tinta' : 'ring-1 ring-inset ring-tinta-3'}`} />
      {status}
    </Chip>
  );
}
```

  (o `<Chip tone="warn">Em aberto</Chip>` da fatura e o `<Chip>` do plano continuam como estão.)
- `SendAction` (`:68-88`) vira linha de ação, sem borda e sem cor literal no ícone:

```jsx
// Ação de envio: uma LINHA com ícone e rótulo, como uma linha de menu. O
// "enviado" não é verde (não existe cor de sucesso): troca o ícone por um check.
function SendAction({ label, icon, onClick, busy, done, pressed }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={pressed}
      className={`flex h-10 w-full items-center gap-3 rounded-ui-md px-3 text-left text-corpo text-tinta transition-colors duration-120 hover:bg-hover disabled:opacity-50 ${pressed ? 'bg-selecionado' : ''}`}
    >
      <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center text-tinta-2">
        {busy ? <IconSpinner size={18} /> : done ? <IconCheck size={18} /> : icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
```

  Os chamadores (`:170-222`) param de passar `color`; a grade `.sgp-acoes` vira `<div className="flex flex-col">` (a regra `.sgp-acoes` saiu na Task 1).
- Na `FinanceiroSection`, o "Consultando o SGP…" (`:140-145`) e o retorno do envio (`:232-243`) passam a um contêiner vivo sempre montado; o erro do envio sai dele e fica `role="alert"`:

```jsx
      {/* Sempre montado: o texto que nasce aqui dentro é anunciado. Sem
          role="status" — a conversa já tem o dela (seção 9). */}
      <div aria-live="polite">
        {state && state.loading && (
          <p className="flex items-center gap-2 px-4 py-2 text-rotulo text-tinta-2">
            <IconSpinner size={16} />
            Consultando o SGP…
          </p>
        )}
        {feedback && feedback.kind === 'sent' && (
          <p className="flex items-center gap-1.5 px-4 pt-2 text-rotulo text-tinta-2">
            <IconCheck size={14} />
            {feedback.text}
          </p>
        )}
      </div>
      {feedback && feedback.kind === 'error' && (
        <p role="alert" className="mx-4 mt-2 rounded-ui-md bg-perigo-fundo px-3 py-2 text-rotulo text-perigo">{feedback.text}</p>
      )}
```

  (o contêiner fica no topo do retorno da `FinanceiroSection`, logo depois do `SectionLabel`, e os dois blocos antigos saem dos lugares de hoje.)
- No `SgpLookupPanel`, o mesmo para "Buscando no SGP…" e "Cliente não encontrado…" (`:328-338`):

```jsx
        <div aria-live="polite">
          {loading && (
            <p className="flex items-center gap-2 px-4 py-2 text-rotulo text-tinta-2">
              <IconSpinner size={16} />
              Buscando no SGP…
            </p>
          )}
          {error === 'not_found' && (
            <p className="px-4 py-2 text-corpo text-tinta-2">Cliente não encontrado. Confira o documento e busque de novo.</p>
          )}
        </div>
```

- A assinatura (`:259`) ganha `encerrada = false`. O cabeçalho (`:288-306`) vira título de painel com o × da família, e o aviso de encerrado logo abaixo:

```jsx
    <aside role="region" aria-label="Consulta SGP" className="conv-painel flex h-full w-full min-h-0 flex-col bg-painel">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-linha px-4">
        <h2 className="min-w-0 flex-1 truncate font-display text-titulo font-semibold text-tinta">Consultar SGP</h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Fechar consulta SGP" className="grid h-9 w-9 place-items-center rounded-ui-md text-tinta-2 hover:bg-hover hover:text-tinta">
            <IconClose size={20} />
          </button>
        )}
      </div>
      {encerrada && (
        <div className="flex items-start gap-2 border-b border-linha bg-aviso-fundo px-4 py-2 text-rotulo text-tinta">
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-aviso"><IconWarning size={16} /></span>
          Atendimento encerrado — a cobrança vai direto ao cliente
        </div>
      )}
```

  (o título deixa de ser `span` e vira `h2`; saem o `IconIdCard` decorativo, `dialog-sgp-panel`, `bg-wa-surface-soft` e `font-wa`; os nomes acessíveis da região e do × não mudam — o harness os usa.)
- O corpo (`:308`) troca `space-y-2.5 p-2.5` por `pb-3`; o formulário vira `mx-4 mt-3 flex gap-2`, com o campo `h-9 min-w-0 flex-1 rounded-ui-md bg-campo px-3 text-corpo text-tinta outline-none placeholder:text-tinta-3` e o "Buscar" `grid h-9 w-9 shrink-0 place-items-center rounded-ui-md bg-accent text-on-accent hover:bg-accent-strong` (nome acessível "Buscar", sem `title`). O erro geral (`:339-343`) fica `role="alert"`, em `mx-4 mt-2 rounded-ui-md bg-perigo-fundo px-3 py-2 text-rotulo text-perigo`. A prévia do QR mantém `bg-white` — o QR precisa de fundo branco para ser lido.
- Imports de ícone: `IconIdCard` sai e entra `IconWarning` (os dois de `./icons/IconesTrabalho`).
- Apagar de `overlays.css` as regras `.dialog-sgp-panel …` (`:189-192`).

- [ ] **Step 5: Rodar e ver passar; o QR fora do trecho da conversa**

Run: `cd frontend && npx vitest run src/components/SgpLookupPanel.test.jsx src/components/ConversationView src/hooks/useSgpLookup.test.jsx src/pages/DashboardPage.test.jsx`
Expected: PASS.

Run: `cd frontend && npx vite build && grep -l "No input text" dist/assets/*.js && grep -c 'import("./' dist/assets/ConversationView-*.js`
Expected: o texto interno da biblioteca ("No input text") aparece num arquivo só, que **não** é o `ConversationView-*.js` nem o `index-*.js` (na prova: `browser-*.js`, 24,5 kB); e o trecho da conversa tem o `import(` dele. (`toDataURL` aparece nos dois — a chamada fica na conversa —, por isso não serve de critério.) Anotar o peso de `/` antes e depois (`node ../ferramentas/medicao/pesos.mjs dist`) no registro da Task 8.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/SgpLookupPanel.jsx frontend/src/components/SgpLookupPanel.test.jsx frontend/src/utils/armazenamentoLocal.js frontend/src/setupTests.js frontend/src/components/ConversationView.jsx frontend/src/components/ConversationView.test.jsx frontend/src/components/overlays.css
git commit -m "E2.4: painel SGP numa superficie, QR sob demanda, memoria na sessao e aviso de encerrado"
```

---

### Task 6: Compositor — popovers ancorados e inserção no cursor

**Files:**
- Modify: `frontend/src/components/MessageInput.jsx:61-82` (`ComposerButton`), `:84` (props), `:140-201` (foco, navegação, ESC e clique fora), `:233-251` (troca de conversa), `:344-347` (`appendEmoji`), `:388-630` (render)
- Modify: `frontend/src/components/ConversationView.jsx` (repassa erro e `refresh` das respostas rápidas)
- Modify: `frontend/src/components/MessageInput.test.jsx`
- Modify: `frontend/src/components/overlays.css:199-204` (saem `.dialog-popover-heading`, `.dialog-quick-replies*`, `.dialog-emoji-picker`), `frontend/src/components/recording-preview.css` (literais → tokens)

Spec 6.3 e E.2 (Emojis, Respostas rápidas): emoji, anexar e respostas rápidas **à esquerda, dentro do campo**, nessa ordem (hoje: anexar, respostas, emoji); o campo cresce até o teto homologado; microfone com o campo vazio, Enviar (acento) com texto ou anexo — um botão só no lugar (já é assim). Popovers pela `Popover` da E2.2: sem o cabeçalho visível (`<p class="dialog-popover-heading">`), altura pelo espaço livre acima do gatilho, ESC pela camada leve (sai o ouvinte próprio no `document`, que fechava também o modal de conversa por baixo — CVM-MOD-10), fecham na troca de conversa (MSG-CMP-23). Os dois popovers continuam **filhos do campo** (o contêiner `relative`), alinhados à borda esquerda dele: presos a cada gatilho, o menu de respostas (3º botão, ~88 px da borda) com 340 px passaria da tela de 360 px.

**Emoji:** insere **no cursor**, substituindo a seleção, e o cursor fica depois do emoji (hoje vai sempre para o fim); clique devolve o foco ao campo; **Enter/Espaço mantêm o foco na grade** — hoje o 1º Enter escolhe e leva o foco ao campo, e o 2º Enter envia a mensagem (N6); clicar no campo não fecha o seletor. **Respostas rápidas (decisão 9):** campo vazio → preenche; com texto → insere no cursor; os estados (carregando, vazio, erro + "Tentar de novo") viram itens do menu — o menu nunca fica sem item focável, e sai o `role="status"` do `AsyncState` lá dentro (N8); busca por letra (type-ahead, padrão WAI-ARIA de menu); clicar no campo fecha o menu. **"Descartar gravação"** passa a descartar de verdade (hoje chama `stopRecording`, que guarda o áudio como anexo).

- [ ] **Step 1: Escrever/atualizar os testes**

Em `MessageInput.test.jsx`, o teste que termina em `expect(screen.queryByText('Encerramento')).not.toBeInTheDocument();` (hoje: digitar "rascunho", escolher "Boas-vindas", o campo fica só com a resposta) passa a afirmar a decisão 9 — o rascunho fica, a resposta entra no cursor — e muda de nome para `'resposta rápida com texto digitado entra no cursor, sem apagar o rascunho'`:

```jsx
    await userEvent.type(screen.getByPlaceholderText(/digite uma mensagem/i), 'rascunho');
    await userEvent.click(screen.getByRole('button', { name: /respostas rápidas/i }));
    await userEvent.click(screen.getByText('Boas-vindas'));

    expect(screen.getByPlaceholderText(/digite uma mensagem/i)).toHaveValue('rascunhoOlá! Como posso ajudar?');
    expect(screen.queryByText('Encerramento')).not.toBeInTheDocument();
```

"em carregamento não mostra 'Nenhuma resposta rápida cadastrada'" troca a última linha (`getByRole('status')`) por:

```jsx
    const menu = screen.getByRole('menu', { name: 'Respostas rápidas' });
    expect(menu).toHaveAttribute('aria-busy', 'true');
    expect(within(menu).getByRole('menuitem', { name: 'Carregando…' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).queryByRole('status')).not.toBeInTheDocument();
```

(`within` entra no import de `@testing-library/react`.) E, no fim do arquivo:

```jsx
const RESPOSTAS = [
  { id: 'qr-1', title: 'Boas-vindas', content: 'Olá! Como posso ajudar?' },
  { id: 'qr-2', title: 'Encerramento', content: 'Foi um prazer atender você!' },
];

describe('E2.4: popovers do compositor', () => {
  test('resposta rápida com o campo vazio preenche, e o cursor fica no fim', async () => {
    render(<MessageInput conversationId="c1" onSend={vi.fn()} quickReplies={RESPOSTAS} />);
    const campo = screen.getByPlaceholderText(/digite uma mensagem/i);
    await userEvent.click(screen.getByRole('button', { name: 'Respostas rápidas' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Boas-vindas/ }));
    expect(campo).toHaveValue('Olá! Como posso ajudar?');
    expect(campo).toHaveFocus();
    expect(campo.selectionStart).toBe('Olá! Como posso ajudar?'.length);
  });

  test('resposta rápida com texto insere no cursor, substituindo só a seleção (decisão 9)', async () => {
    render(<MessageInput conversationId="c1" onSend={vi.fn()} quickReplies={RESPOSTAS} />);
    const campo = screen.getByPlaceholderText(/digite uma mensagem/i);
    await userEvent.type(campo, 'Bom dia. XXX Até logo.');
    campo.setSelectionRange(9, 12);
    await userEvent.click(screen.getByRole('button', { name: 'Respostas rápidas' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Boas-vindas/ }));
    expect(campo).toHaveValue('Bom dia. Olá! Como posso ajudar? Até logo.');
    expect(campo.selectionStart).toBe('Bom dia. Olá! Como posso ajudar?'.length);
  });

  test('emoji por clique entra no cursor, e o cursor fica depois do emoji inteiro', async () => {
    render(<MessageInput conversationId="c1" onSend={vi.fn()} />);
    const campo = screen.getByPlaceholderText(/digite uma mensagem/i);
    await userEvent.type(campo, 'ab');
    campo.setSelectionRange(1, 1);
    await userEvent.click(screen.getByRole('button', { name: 'Emojis' }));
    await userEvent.click(screen.getByRole('button', { name: '✌️' }));
    expect(campo).toHaveValue('a✌️b');
    expect(campo).toHaveFocus();
    // ✌️ tem seletor de variação: são 2 unidades UTF-16, e o cursor vai depois das duas.
    expect(campo.selectionStart).toBe(1 + '✌️'.length);
  });

  // O Safari não foca um botão ao clicar: o foco continua no campo. É o caso em
  // que só o setSelectionRange do efeito põe o cursor depois do emoji (no
  // outro, o onFocus do campo também o põe) — sem este teste, apagar aquela
  // linha passava despercebido (achado da prova em cópia).
  test('emoji por clique com o foco ainda no campo: cursor depois do emoji', async () => {
    render(<MessageInput conversationId="c1" onSend={vi.fn()} />);
    const campo = screen.getByPlaceholderText(/digite uma mensagem/i);
    await userEvent.type(campo, 'ab');
    await userEvent.click(screen.getByRole('button', { name: 'Emojis' }));
    campo.focus();
    campo.setSelectionRange(1, 1);
    fireEvent.click(screen.getByRole('button', { name: '✌️' }), { detail: 1 });
    expect(campo).toHaveValue('a✌️b');
    expect(campo.selectionStart).toBe(1 + '✌️'.length);
  });

  test('Enter num emoji mantém o foco na grade, e o Enter seguinte NÃO envia a mensagem (N6)', async () => {
    const onSend = vi.fn();
    render(<MessageInput conversationId="c1" onSend={onSend} />);
    await userEvent.type(screen.getByPlaceholderText(/digite uma mensagem/i), 'oi');
    await userEvent.click(screen.getByRole('button', { name: 'Emojis' }));
    expect(screen.getByRole('button', { name: '😀' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '😃' })).toHaveFocus();
    // Pelo teclado as inserções seguem em ordem, uma depois da outra.
    expect(screen.getByPlaceholderText(/digite uma mensagem/i)).toHaveValue('oi😀😃');
  });

  test('sem cabeçalho visível; o nome fica no papel', async () => {
    render(<MessageInput conversationId="c1" onSend={vi.fn()} quickReplies={RESPOSTAS} />);
    await userEvent.click(screen.getByRole('button', { name: 'Emojis' }));
    const emojis = screen.getByRole('dialog', { name: 'Emojis' });
    expect(emojis).not.toHaveAttribute('aria-modal');
    expect(emojis.querySelector('p')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Respostas rápidas' }));
    expect(screen.getByRole('menu', { name: 'Respostas rápidas' }).querySelector('p')).toBeNull();
  });

  test('vazio: o aviso é um item do menu', async () => {
    render(<MessageInput conversationId="c1" onSend={vi.fn()} quickReplies={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Respostas rápidas' }));
    expect(screen.getByRole('menuitem', { name: 'Nenhuma resposta rápida cadastrada.' })).toHaveFocus();
  });

  test('erro: o motivo e "Tentar de novo" como itens do menu', async () => {
    const onRetry = vi.fn();
    render(<MessageInput conversationId="c1" onSend={vi.fn()} quickReplies={[]} quickRepliesStatus="error" quickRepliesError="Sem conexão com o servidor." onRetryQuickReplies={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Respostas rápidas' }));
    expect(screen.getByRole('menuitem', { name: 'Sem conexão com o servidor.' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Tentar de novo' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('busca por letra: "e" leva ao primeiro título com E', async () => {
    render(<MessageInput conversationId="c1" onSend={vi.fn()} quickReplies={RESPOSTAS} />);
    await userEvent.click(screen.getByRole('button', { name: 'Respostas rápidas' }));
    expect(screen.getByRole('menuitem', { name: /^Boas-vindas/ })).toHaveFocus();
    await userEvent.keyboard('e');
    expect(screen.getByRole('menuitem', { name: /^Encerramento/ })).toHaveFocus();
  });

  test('clicar no campo fecha o menu de respostas; o de emojis fica', async () => {
    render(<MessageInput conversationId="c1" onSend={vi.fn()} quickReplies={RESPOSTAS} />);
    const campo = screen.getByPlaceholderText(/digite uma mensagem/i);
    await userEvent.click(screen.getByRole('button', { name: 'Respostas rápidas' }));
    await userEvent.click(campo);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Emojis' }));
    await userEvent.click(campo);
    expect(screen.getByRole('dialog', { name: 'Emojis' })).toBeInTheDocument();
  });

  test('ESC fecha o popover e devolve o foco ao gatilho', async () => {
    render(<MessageInput conversationId="c1" onSend={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Emojis' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Emojis' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Emojis' })).toHaveFocus();
  });

  test('troca de conversa fecha os popovers (MSG-CMP-23)', async () => {
    const { rerender } = render(<MessageInput conversationId="c1" onSend={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Emojis' }));
    rerender(<MessageInput conversationId="c2" onSend={vi.fn()} />);
    expect(screen.queryByRole('dialog', { name: 'Emojis' })).not.toBeInTheDocument();
  });

  test('ordem dentro do campo: emoji, anexar, respostas rápidas', () => {
    render(<MessageInput conversationId="c1" onSend={vi.fn()} />);
    const nomes = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    const i = (nome) => nomes.indexOf(nome);
    expect(i('Emojis')).toBeLessThan(i('Anexar arquivo'));
    expect(i('Anexar arquivo')).toBeLessThan(i('Respostas rápidas'));
  });

  test('"Descartar gravação" descarta: não sobra prévia nem anexo', async () => {
    render(<MessageInput conversationId="c1" onSend={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /gravar áudio/i }));
    await screen.findByRole('button', { name: /parar gravação/i });
    await userEvent.click(screen.getByRole('button', { name: 'Descartar gravação' }));
    expect(screen.queryByText(/gravação de áudio/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /gravar áudio/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/MessageInput.test.jsx`
Expected: FAIL nos novos e nos dois reescritos (inclusive "Descartar gravação": hoje o áudio vira anexo).

- [ ] **Step 3: Implementar a inserção no cursor**

Props (`:84`): acrescentar `quickRepliesError = null, onRetryQuickReplies`. `useLayoutEffect` entra no import de `react`. `appendEmoji` (`:344-347`) sai, e entram:

```jsx
  // Onde inserir (decisão 9 e MSG-EMO-03): na seleção do campo, substituindo-a.
  // O campo é controlado, então a posição do cursor só pode ser posta DEPOIS do
  // render — antes, o React a devolve ao fim. Com o foco fora do campo (emoji
  // escolhido pelo teclado, foco parado na grade) a próxima inserção vai logo
  // depois da anterior, em ordem. selectionStart conta unidades UTF-16, o mesmo
  // que String.length: emoji com seletor de variação (✌️) fica coerente.
  const insercaoRef = useRef(null); // { posicao, focar, aplicar }

  useLayoutEffect(() => {
    const pendente = insercaoRef.current;
    const campo = textInputRef.current;
    if (!pendente || !pendente.aplicar || !campo) return;
    pendente.aplicar = false;
    if (pendente.focar) campo.focus();
    if (document.activeElement === campo) {
      campo.setSelectionRange(pendente.posicao, pendente.posicao);
      insercaoRef.current = null;
    }
  });

  function inserirNoCursor(texto, focar) {
    const campo = textInputRef.current;
    const pendente = insercaoRef.current;
    const foraDoCampo = Boolean(pendente) && document.activeElement !== campo;
    const fimDoTexto = contentRef.current.length;
    const inicio = foraDoCampo ? pendente.posicao : campo ? campo.selectionStart ?? fimDoTexto : fimDoTexto;
    const fim = foraDoCampo ? inicio : campo ? campo.selectionEnd ?? inicio : inicio;
    setContent((atual) => atual.slice(0, inicio) + texto + atual.slice(fim));
    insercaoRef.current = { posicao: inicio + texto.length, focar, aplicar: true };
  }

  // Voltar ao campo (Tab, clique) com uma inserção pelo teclado ainda pendente:
  // o cursor vai para depois dela. No clique, o navegador põe o cursor onde a
  // pessoa clicou logo em seguida — e vale o clique.
  function aoFocarOCampo() {
    const pendente = insercaoRef.current;
    if (!pendente || pendente.aplicar) return;
    textInputRef.current.setSelectionRange(pendente.posicao, pendente.posicao);
    insercaoRef.current = null;
  }

  function escolherEmoji(emoji, pelotTeclado) {
    // Clique devolve o foco ao campo (como hoje); pelo teclado o foco fica na
    // grade — senão o Enter seguinte cai no campo e ENVIA a mensagem (N6).
    inserirNoCursor(emoji, !pelotTeclado);
  }

  function escolherResposta(resposta) {
    setShowingQuickReplies(false);
    // Campo vazio: preenche. Com texto: entra no cursor (decisão 9) — apagar o
    // que a pessoa escreveu era destruir trabalho sem confirmação.
    if (!contentRef.current.trim()) {
      setContent(resposta.content);
      insercaoRef.current = { posicao: resposta.content.length, focar: true, aplicar: true };
      return;
    }
    inserirNoCursor(resposta.content, true);
  }
```

(`contentRef` já existe e acompanha `content` — `:217`.) O botão de cada emoji chama `onClick={(evento) => escolherEmoji(emoji, evento.detail === 0)}`: clique gerado pelo teclado (Enter/Espaço) chega com `detail` 0 no navegador e no user-event 14; clique de mouse, com 1 ou mais. O `textarea` ganha `onFocus={aoFocarOCampo}`.

- [ ] **Step 4: Implementar os popovers**

O efeito de ESC/clique fora (`:181-201`) e o `popoverRef` **saem**: a `Popover` cuida dos dois (camada leve e `pointerdown` fora). O foco inicial (`:144-146`) passa a depender também de `quickRepliesStatus` — o primeiro item muda quando "Carregando…" vira a lista ou o erro:

```jsx
  useEffect(() => {
    if (showingQuickReplies && primeiroItemRef.current) primeiroItemRef.current.focus();
  }, [showingQuickReplies, quickReplies.length, quickRepliesStatus]);
```

A troca de conversa (`:233-251`) acrescenta `setShowingEmojis(false); setShowingQuickReplies(false); insercaoRef.current = null;`. O botão "Descartar gravação" (`:457`) passa a `onClick={stopRecordingAndDiscard}`.

`navegarNoMenu` (`:161-170`) ganha a busca por letra:

```jsx
  function navegarNoMenu(evento) {
    const itens = [...evento.currentTarget.querySelectorAll('[role=menuitem]')];
    const atual = itens.indexOf(document.activeElement);
    if (evento.key.length === 1 && /\S/.test(evento.key) && !evento.ctrlKey && !evento.metaKey && !evento.altKey) {
      // Type-ahead (padrão WAI-ARIA de menu). Só vale com o foco DENTRO do
      // menu, então nunca rouba letra do campo.
      const letra = evento.key.toLocaleLowerCase('pt-BR');
      const ordem = [...itens.slice(atual + 1), ...itens.slice(0, atual + 1)];
      const alvo = ordem.find((item) => item.textContent.trim().toLocaleLowerCase('pt-BR').startsWith(letra));
      if (alvo) {
        evento.preventDefault();
        alvo.focus();
      }
      return;
    }
    const passo = evento.key === 'ArrowDown' ? 1 : evento.key === 'ArrowUp' ? -1 : 0;
    if (!passo || atual === -1) return;
    evento.preventDefault();
    itens[(atual + passo + itens.length) % itens.length].focus();
  }
```

`ItemDoMenu`, no topo do arquivo:

```jsx
// Item do menu de respostas. Os estados (carregando, vazio, erro) também são
// itens — desabilitados, mas focáveis —, para o menu nunca ficar sem item (N8).
function ItemDoMenu({ primeiroRef, desabilitado = false, onClick, children }) {
  return (
    <button
      ref={primeiroRef}
      type="button"
      role="menuitem"
      aria-disabled={desabilitado || undefined}
      onClick={desabilitado ? undefined : onClick}
      className={`block w-full rounded-ui-md px-3 py-2 text-left text-corpo ${desabilitado ? 'cursor-default text-tinta-2' : 'text-tinta hover:bg-hover focus-visible:bg-hover'}`}
    >
      {children}
    </button>
  );
}
```

O campo e os popovers (`:476-593`) passam a — os dois `Popover` como filhos do contêiner `relative` do campo, depois do `textarea`:

```jsx
            <div className="relative flex min-h-12 min-w-0 flex-1 items-end gap-0.5 rounded-ui-lg bg-campo py-1 pl-1 pr-2">
              <ComposerButton label="Emojis" active={showingEmojis} haspopup="dialog" controls="composer-emojis" botaoRef={gatilhoEmojiRef}
                onClick={() => { setShowingEmojis((v) => !v); setShowingQuickReplies(false); }}>
                <IconEmoji size={22} />
              </ComposerButton>
              {/* O seletor é aberto pelo ref, não por <label>: assim o controle
                  é focável e responde a Enter e Espaço como qualquer botão. */}
              <ComposerButton label="Anexar arquivo" onClick={() => fileInputRef.current?.click()}>
                <IconAttach size={22} />
              </ComposerButton>
              <ComposerButton label="Respostas rápidas" active={showingQuickReplies} haspopup="menu" controls="composer-respostas" botaoRef={gatilhoRespostasRef}
                onClick={() => { setShowingQuickReplies((v) => !v); setShowingEmojis(false); }}>
                <IconQuickReply size={22} />
              </ComposerButton>
              <textarea
                ref={textInputRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleComposerKeyDown}
                onPaste={handlePaste}
                onFocus={aoFocarOCampo}
                placeholder="Digite uma mensagem…"
                rows={1}
                style={{ minHeight: COMPOSER_MIN_HEIGHT - 8, maxHeight: tetoDoCampo }}
                className="min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-2.5 text-corpo text-tinta outline-none placeholder:text-tinta-3"
              />

              {/* Não modal: nome acessível, foco inicial no primeiro emoji,
                  setas na grade, ESC devolvendo o foco ao gatilho, Tab saindo
                  normalmente. Clicar no campo NÃO fecha: dá para escolher vários. */}
              <Popover
                aberto={showingEmojis}
                aoFechar={() => fecharPopovers(true)}
                ancoraRef={gatilhoEmojiRef}
                manterAbertoEm={[textInputRef]}
                id="composer-emojis"
                role="dialog"
                ariaLabel="Emojis"
                largura={304}
                className="max-w-[calc(100vw-2rem)]"
                onKeyDown={navegarNaGrade}
              >
                <div className="grid grid-cols-8 gap-1">
                  {EMOJIS.map((emoji, i) => (
                    <button
                      key={emoji}
                      ref={i === 0 ? primeiroEmojiRef : undefined}
                      type="button"
                      onClick={(evento) => escolherEmoji(emoji, evento.detail === 0)}
                      className="rounded-ui-sm py-1 text-[20px] leading-none transition-colors duration-120 hover:bg-hover"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </Popover>

              {/* Comportamento de MENU: setas, busca por letra, Enter escolhe,
                  ESC devolve o foco. Clicar no campo fecha (é clique fora). */}
              <Popover
                aberto={showingQuickReplies}
                aoFechar={() => fecharPopovers(true)}
                ancoraRef={gatilhoRespostasRef}
                id="composer-respostas"
                role="menu"
                ariaLabel="Respostas rápidas"
                aria-busy={quickRepliesStatus === 'loading' || undefined}
                largura={340}
                className="max-w-[calc(100vw-2rem)]"
                onKeyDown={navegarNoMenu}
              >
                {quickRepliesStatus === 'loading' && <ItemDoMenu primeiroRef={primeiroItemRef} desabilitado>Carregando…</ItemDoMenu>}
                {quickRepliesStatus === 'error' && (
                  <>
                    <ItemDoMenu primeiroRef={primeiroItemRef} desabilitado>{quickRepliesError || 'Não foi possível carregar as respostas rápidas.'}</ItemDoMenu>
                    {onRetryQuickReplies && <ItemDoMenu onClick={onRetryQuickReplies}>Tentar de novo</ItemDoMenu>}
                  </>
                )}
                {quickRepliesStatus === 'ready' && quickReplies.length === 0 && (
                  <ItemDoMenu primeiroRef={primeiroItemRef} desabilitado>Nenhuma resposta rápida cadastrada.</ItemDoMenu>
                )}
                {quickRepliesStatus === 'ready' && quickReplies.map((resposta, i) => (
                  <ItemDoMenu key={resposta.id} primeiroRef={i === 0 ? primeiroItemRef : undefined} onClick={() => escolherResposta(resposta)}>
                    <span className="block truncate font-medium text-tinta">{resposta.title}</span>
                    <span className="block truncate text-rotulo text-tinta-2">{resposta.content}</span>
                  </ItemDoMenu>
                ))}
              </Popover>
            </div>
```

(`Popover` de `./ui/Popover`; o import de `AsyncState` sai se não sobrar outro uso no arquivo. `text-[20px]` é o tamanho do glifo do emoji — conteúdo, não escala de interface.)

`fecharPopovers` (`:172-179`) fica como está: devolve o foco ao gatilho. No clique fora, o navegador move o foco para onde a pessoa clicou logo depois do `pointerdown` — o foco no gatilho não fica.

Visual do resto do compositor (troca de cor e superfície — entra no registro como C):

- `ComposerButton` (`:61-82`): `grid h-10 w-10 shrink-0 place-items-center rounded-ui-md text-tinta-2 transition-colors duration-120 hover:bg-hover hover:text-tinta`; ativo: `bg-selecionado text-tinta`; o `title` sai (o nome acessível fica).
- Enviar (`:597-606`): `grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent text-on-accent hover:bg-accent-strong disabled:opacity-50`; Gravar áudio: `grid h-12 w-12 shrink-0 place-items-center rounded-full text-tinta-2 hover:bg-hover hover:text-tinta` (sai o `title`).
- "Respondendo" (`:391-410`): barra `bg-tinta-3`, rótulo `text-tinta` (sai o cobre), `✕` → `<IconClose size={18} />`.
- Prévia de anexo e "Gravando…" (`:416-473`): o cobre e o `#ea4335` saem — o ponto de gravação vira `bg-perigo`; o "Parar" vira `<Button size="sm" onClick={stopRecording} aria-label="Parar gravação">Parar</Button>` (primário; o nome acessível é o de hoje).
- Erro (`:621-625`): `text-perigo`.
- `recording-preview.css`, literal por literal (o arquivo fica sem cor própria; sai de `PENDENCIAS` nesta tarefa):

| Onde | Hoje | Vira |
|---|---|---|
| `.recording-preview` fundo / borda / texto | `--color-ui-surface-overlay` / `#ffffff19` / `#dce5ea` | `var(--color-painel)` / `var(--color-linha)` / `var(--color-tinta)` |
| `.recording-preview-label`, `.recording-preview button`, `.recording-preview-time` (texto) | `#b9c8d1`, `#c7d5de`, `#c4d1d9` | `var(--color-tinta-2)` |
| `button:hover` | `#ffffff14` + `#fff` | `var(--color-hover)` + `var(--color-tinta)` |
| `.recording-preview-play`, `.recording-preview-send` | `#e5a16d` + `#212c33` | `var(--color-accent)` + `var(--color-on-accent)` |
| hover dos dois | `#ffb47d` + `#212c33` | `var(--color-accent-strong)` + `var(--color-on-accent)` |
| trilha do progresso | `#e5a16d` / `#637783` | `var(--color-accent)` / `var(--color-tinta-3)` |
| marcador do progresso (webkit e moz) | `#f2c5a3` | `var(--color-accent)` |

Apagar de `overlays.css` `.dialog-popover-heading`, `.dialog-quick-replies`, `li + li`, `li button`, `.dialog-quick-reply-preview` e `.dialog-emoji-picker` (`:199-204`).

Na `ConversationView`, a chamada do hook passa a `const { quickReplies, status: quickRepliesStatus, error: quickRepliesError, refresh: refreshQuickReplies } = useQuickReplies();` e o `MessageInput` recebe `quickRepliesError={quickRepliesError ? descreverErro(quickRepliesError, 'Não foi possível carregar as respostas rápidas.') : null}` e `onRetryQuickReplies={refreshQuickReplies}`.

- [ ] **Step 5: Rodar e ver passar — teto do campo e troca de conversa**

Run: `cd frontend && npx vitest run src/components/MessageInput.test.jsx src/components/ConversationView src/components/ui/Popover.test.jsx`
Expected: PASS — inclui o teto do compositor ("o campo cresce com o texto": 683×384 → ≤ 173 px; 1080 → 320 px) e os de rascunho, gravação e envio por conversa (CLASSE-01).

- [ ] **Step 6: Provar por mutação**

(a) Em `escolherEmoji`, trocar `inserirNoCursor(emoji, !pelotTeclado)` por `inserirNoCursor(emoji, true)`. Rodar. Expected: FAIL em "Enter num emoji mantém o foco na grade…" (é o N6 de volta). Desfazer.
(b) No `useLayoutEffect`, apagar a linha do `setSelectionRange`. Rodar. Expected: FAIL em "emoji por clique com o foco ainda no campo…" (`expected 4 to be 3`: o cursor volta ao fim). Desfazer.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/MessageInput.jsx frontend/src/components/MessageInput.test.jsx frontend/src/components/ConversationView.jsx frontend/src/components/overlays.css frontend/src/components/recording-preview.css
git commit -m "E2.4: compositor com popovers ancorados, insercao no cursor e estados no menu"
```

---

### Task 7: Faixas acima do compositor, rodapé de encerrada e alertas com contexto

**Files:**
- Modify: `frontend/src/components/AiSuggestionCard.jsx:1,39-71`; `AiSuggestionCard.test.jsx`
- Modify: `frontend/src/components/ui/FaixaDeAviso.jsx` (+ teste) — prop `multilinha`
- Modify: `frontend/src/hooks/useAlert.jsx` — `fechar()`
- Modify: `frontend/src/components/ConversationView.jsx:523-555` (alertas), `:373-386` (reset), `:896-951` (faixas da janela), depois do bloco `isMine` (rodapé de encerrada), `:964-970` (`SendTemplateModal` recebe o motivo)
- Modify: `frontend/src/components/ConversationView.test.jsx`

Spec 6.3: **sugestão da IA** numa faixa acima do compositor — rótulo "Sugestão da IA" **com ícone**, texto, ações Enviar (acento), Editar e Descartar (secundários) numa linha; sai a moldura de cartão (`rounded-2xl border`), e os avisos de ação executada e proposta usam aviso e tinta — saem `amber-*` e `sky-*` da paleta padrão e os caracteres "⚠" e "•" (vira ícone e marcador de lista). **Janela de 24 h** (fechada/indeterminada): faixa de aviso com ícone, texto e "Enviar template" — os **textos atuais ficam palavra por palavra**, inclusive o negrito de abertura; a faixa precisa quebrar linha, por isso a prop `multilinha`. **Conversa encerrada:** a linha "Atendimento encerrado em {data} · somente leitura" no lugar do compositor (hoje o espaço fica vazio — CV-ROD-03). **Alertas** (anexo B §4): o título diz o que falhou e com quem ("Não foi possível assumir o atendimento de Maria"); a descrição é o porquê. E o alerta, o histórico e o envio de template **zeram na troca de conversa** (N9: o alerta de A aparecia com B na tela).

**Interfaces:**
- Produces: `FaixaDeAviso({ texto: node, titulo?, acao?, multilinha?: bool, className })`; `useAlert() → { avisar, fechar, alertDialog }`; estado `motivoDoTemplate: 'fechada' | 'recusada'`, passado ao `SendTemplateModal` como `motivo` (a E2.5, Task 3, escreve a descrição do modal a partir dele — Apêndice E: "descrição conforme o aviso que abriu").

- [ ] **Step 1: Escrever os testes**

Em `ConversationView.test.jsx`:

```jsx
describe('E2.4: rodapé, faixas e alertas (spec 6.3)', () => {
  test('conversa encerrada: "Atendimento encerrado em … · somente leitura" no lugar do compositor', () => {
    render(<ConversationView conversation={{ id: 'c1', status: 'closed', closedAt: '2026-09-24T15:30:00.000Z', assignedAgentId: 'agent-1', contactDisplayName: 'Ana' }} onTransferClick={vi.fn()} />);
    expect(screen.getByText(/^Atendimento encerrado em \d{2}\/\d{2}\/\d{4},? \d{2}:\d{2} · somente leitura$/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/digite uma mensagem/i)).not.toBeInTheDocument();
  });

  test('conversa aberta: sem o rodapé de encerrada', () => {
    render(<ConversationView conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }} onTransferClick={vi.fn()} />);
    expect(screen.queryByText(/somente leitura/)).not.toBeInTheDocument();
  });

  test('falha ao assumir: o título diz com quem, a descrição diz por quê', async () => {
    api.claimConversation.mockRejectedValue({ status: 409, body: { error: 'Conversation already assigned or closed' } });
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', contactDisplayName: 'Maria' }} onTransferClick={vi.fn()} workspace />);
    await userEvent.click(screen.getByRole('button', { name: 'Assumir' }));
    const alerta = await screen.findByRole('alertdialog', { name: 'Não foi possível assumir o atendimento de Maria' });
    expect(alerta).toHaveAccessibleDescription('Este atendimento já foi assumido por outra pessoa ou já foi encerrado.');
  });

  test('o alerta de A não aparece em B (N9)', async () => {
    api.claimConversation.mockRejectedValue({ status: 409, body: { error: 'Conversation already assigned or closed' } });
    const { rerender } = render(<ConversationView conversation={{ id: 'c1', status: 'waiting', contactDisplayName: 'Maria' }} onTransferClick={vi.fn()} workspace />);
    await userEvent.click(screen.getByRole('button', { name: 'Assumir' }));
    await screen.findByRole('alertdialog');
    rerender(<ConversationView conversation={{ id: 'c2', status: 'waiting', contactDisplayName: 'João' }} onTransferClick={vi.fn()} workspace />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
```

(Os testes da janela que já existem — `ConversationView.test.jsx:1108-1212` e `:1434-1511` — procuram os textos por regex e o botão "Enviar template" pelo nome: continuam como estão, e são a prova de que o texto não mudou.)

Em `AiSuggestionCard.test.jsx`:

```jsx
  test('faixa: ícone da IA no rótulo, sem moldura, sem paleta padrão e sem "⚠"/"•" no texto', () => {
    const { container } = render(<AiSuggestionCard suggestion={{ id: 's1', content: 'Olá', acoesExecutadas: ['gerar_pix'], acoesPropostas: ['encerrar_atendimento'] }} onSend={vi.fn()} onEdit={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText('Sugestão da IA').querySelector('svg')).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/amber-|sky-|rounded-2xl|wa-field/);
    expect(container.textContent).not.toMatch(/⚠|•/);
  });
```

Em `frontend/src/components/ui/FaixaDeAviso.test.jsx`:

```jsx
  test('multilinha quebra o texto em vez de cortar', () => {
    const { rerender } = render(<FaixaDeAviso texto="Um texto longo" />);
    expect(screen.getByText('Um texto longo')).toHaveClass('truncate');
    rerender(<FaixaDeAviso texto="Um texto longo" multilinha />);
    expect(screen.getByText('Um texto longo')).not.toHaveClass('truncate');
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ConversationView.test.jsx src/components/AiSuggestionCard.test.jsx src/components/ui/FaixaDeAviso.test.jsx`
Expected: FAIL nos novos.

- [ ] **Step 3: Implementar a faixa multilinha e o `fechar` do alerta**

`FaixaDeAviso.jsx` — assinatura `export function FaixaDeAviso({ texto, titulo, acao, multilinha = false, className = '' })`, o contêiner alinha pelo topo quando quebra e o parágrafo não corta:

```jsx
    <div className={`flex min-h-10 ${multilinha ? 'items-start' : 'items-center'} gap-2 bg-aviso-fundo px-4 py-2 text-rotulo text-tinta ${className}`}>
      <span aria-hidden="true" className={`shrink-0 text-aviso ${multilinha ? 'mt-px' : ''}`}>
        <IconWarning size={16} />
      </span>
      <p className={`min-w-0 flex-1 ${multilinha ? '' : 'truncate'}`} title={titulo || undefined}>
        {texto}
      </p>
```

(o resto — a ação como `Link` ou botão — fica igual.)

`useAlert.jsx`:

```jsx
  const fechar = useCallback(() => setAviso(null), []);
  …
  return { avisar, fechar, alertDialog };
```

- [ ] **Step 4: Implementar a sugestão como faixa**

`AiSuggestionCard.jsx`: import `import { IconSpark, IconWarning } from './icons/IconesTrabalho';`, e o `return` (`:43-71`) passa a:

```jsx
    <div className="border-t border-linha bg-painel px-4 py-3">
      <p className="mb-1 flex items-center gap-1.5 text-rotulo font-semibold text-tinta-2">
        <span aria-hidden="true" className="inline-flex"><IconSpark size={14} /></span>
        Sugestão da IA
      </p>
      {acoes.length > 0 && (
        <ul className="mb-2 space-y-0.5 rounded-ui-md bg-aviso-fundo px-3 py-2 text-rotulo text-tinta">
          {acoes.map((nome) => (
            <li key={nome} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-flex text-aviso"><IconWarning size={14} /></span>
              {ROTULO_ACAO[nome]}
            </li>
          ))}
        </ul>
      )}
      {propostas.length > 0 && (
        <div className="mb-2 rounded-ui-md bg-hover px-3 py-2 text-rotulo text-tinta">
          <p className="mb-1 font-semibold">A IA propôs e NÃO executou — depende de você:</p>
          <ul className="list-disc pl-4">
            {propostas.map((nome) => <li key={nome}>{rotuloDaProposta(nome)}</li>)}
          </ul>
        </div>
      )}
      <p className="mb-2 whitespace-pre-wrap text-corpo text-tinta">{suggestion.content}</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSend(suggestion)}>Enviar</Button>
        <Button size="sm" variant="secondary" onClick={() => onEdit(suggestion)}>Editar</Button>
        <Button size="sm" variant="secondary" onClick={() => onDiscard(suggestion)}>Descartar</Button>
      </div>
    </div>
```

(`ROTULO_ACAO`, `ROTULO_PROPOSTA` e `rotuloDaProposta` não mudam. A regra `.chat-ai-suggestion` de `dashboard.css` saiu na Task 1.)

- [ ] **Step 5: Faixas da janela, rodapé e alertas na `ConversationView`**

Estado novo, junto de `sendingTemplate`: `const [motivoDoTemplate, setMotivoDoTemplate] = useState('fechada');`. As duas faixas (`:896-951`) viram `FaixaDeAviso multilinha`, com o texto **idêntico** ao de hoje — o `IconInfo` em cobre e as classes `chat-*` saem:

```jsx
          {/* Avisa, mas não bloqueia: o nosso relógio pode divergir do da Meta
              por alguns minutos, e impedir um envio que passaria seria pior do
              que deixar tentar. */}
          {janelaFechada && (
            <FaixaDeAviso
              multilinha
              className="border-t border-linha"
              texto={
                <>
                  <strong className="font-semibold">Janela de 24h fechada.</strong> O WhatsApp só entrega texto livre
                  até 24h depois da última mensagem do cliente — e template não reabre essa contagem, só a resposta
                  dele. Enviar agora provavelmente vai falhar; use um template aprovado.
                </>
              }
              acao={{ rotulo: 'Enviar template', aoClicar: () => { setMotivoDoTemplate('fechada'); setSendingTemplate(true); } }}
            />
          )}
          {/* Indeterminado: não bloqueia, não promete que está aberta e não
              anuncia fechada. O caminho do template aparece quando o canal já
              recusou por janela de 24 h: aí a dúvida acabou, e a recusa é dele. */}
          {janelaIndeterminada && (
            <FaixaDeAviso
              multilinha
              className="border-t border-linha"
              texto={
                <>
                  <strong className="font-semibold">Não foi possível conferir a janela de 24h.</strong> A hora da última
                  mensagem do cliente veio ilegível, então não dá para dizer se a janela está aberta ou fechada. Você
                  pode enviar normalmente — quem decide é o WhatsApp.
                  {foiRecusadaPorJanela(messages) && ' Uma mensagem já foi recusada por estar fora da janela:'}
                </>
              }
              acao={foiRecusadaPorJanela(messages) ? { rotulo: 'Enviar template', aoClicar: () => { setMotivoDoTemplate('recusada'); setSendingTemplate(true); } } : undefined}
            />
          )}
```

(`FaixaDeAviso` de `./ui`; o import de `IconInfo` sai se não sobrar uso.) O `SendTemplateModal` (`:964-970`) recebe `motivo={motivoDoTemplate}` — ignorado até a E2.5.

Depois do bloco `{isMine && (…)}`, o rodapé da encerrada (`estaEncerrada` da Task 1; `IconLock` de `./icons/IconesTrabalho`, que o reexporta de `IconesEntrada`):

```jsx
      {/* `isMine` já exclui a encerrada; o `!isMine` garante que rodapé e
          compositor nunca aparecem juntos, nem num estado incoerente. */}
      {!isMine && estaEncerrada(conversation) && (
        <p className="flex h-12 shrink-0 items-center justify-center gap-1.5 border-t border-linha bg-painel px-4 text-rotulo text-tinta-2">
          <span aria-hidden="true" className="inline-flex"><IconLock size={14} /></span>
          {conversation.closedAt
            ? `Atendimento encerrado em ${new Date(conversation.closedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · somente leitura`
            : 'Atendimento encerrado · somente leitura'}
        </p>
      )}
```

Os três alertas (`:523-555`) passam o título — a mensagem continua a mesma (é a descrição):

```jsx
      avisar(descreverErro(err, 'Não foi possível assumir este atendimento.'), { title: `Não foi possível assumir o atendimento de ${nameLabel}` });
```

e `{ title: 'Não foi possível enviar a sugestão da IA' }`, `{ title: 'Não foi possível descartar a sugestão da IA' }` nos outros dois.

`const { avisar, fechar: fecharAlerta, alertDialog } = useAlert();` (`:285`), e o reset da troca de conversa (`:373-386`) acrescenta `setShowingHistory(false); setSendingTemplate(false); fecharAlerta();`.

- [ ] **Step 6: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/ConversationView src/components/AiSuggestionCard.test.jsx src/components/ui src/hooks`
Expected: PASS — inclusive os testes antigos da janela de 24 h, sem mudança.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/AiSuggestionCard.jsx frontend/src/components/AiSuggestionCard.test.jsx frontend/src/components/ConversationView.jsx frontend/src/components/ConversationView.test.jsx frontend/src/components/ui/FaixaDeAviso.jsx frontend/src/components/ui/FaixaDeAviso.test.jsx frontend/src/hooks/useAlert.jsx
git commit -m "E2.4: sugestao da IA e janela de 24h como faixas; rodape de encerrada; alertas com contexto"
```

---

### Task 8: Fechamento da E2.4

- [ ] **Step 1: Pendências do acento e nada de cor fora dos tokens na conversa**

Run: `cd frontend && npx vitest run src/estilo`
Expected: o acento único acusa os arquivos que ficaram limpos — no mínimo `components/ConversationView.jsx`, `components/MessageInput.jsx`, `components/recording-preview.css`, `components/PixCardMessage.jsx` se tratado, `pages/dashboard.css` se só restaram regras da lista já removidas. Tirar da lista até passar. `components/MessageAttachment.jsx` continua (áudio escuro com literais pêssego; o visualizador é da E2.5).

- [ ] **Step 2: Harness — ganchos e prints**

Os nomes que o harness usa na conversa continuam: "Consultar SGP", "Fechar consulta SGP", região "Consulta SGP", "Dados do cliente" (botão e `complementary`), "Fechar dados do cliente", "Carregar mensagens anteriores", `.chat-workspace-timeline`. Rodar o diagnóstico de rolagem da E1.1 contra o build:

Run: `cd frontend && npx vite build && cd .. && MSYS_NO_PATHCONV=1 MEDICAO_DIST=frontend/dist node ferramentas/medicao/diagnostico/rolagem-anteriores.mjs`
Expected: a mensagem do topo fica no lugar, com e sem ancoragem nativa, com fotos (o mesmo resultado da E1.1).

- [ ] **Step 3: Registro S × C**

Acrescentar a seção "E2.4 — conversa e painéis" ao registro: uma linha por item do Apêndice B.3/B.4 e do Apêndice E (Editar cliente, Conversa em modal + painel de informações, Emojis, Respostas rápidas, Alerta). Exemplo:

| Elemento | Antes | Depois | Classe |
|---|---|---|---|
| Cabeçalho | 3 linhas + barra de contexto (setor 3× na tela) | 2 linhas; sem barra | S |
| Editar cliente | modal de 672 px sobre a conversa | modo edição do painel Cliente | S |
| Painel de informações do modal | coluna fixa de 272 px, some < 768 px, "Em andamento" | painel Cliente, disponível em qualquer largura | S |
| Rodapé de conversa encerrada | vazio | "Atendimento encerrado em … · somente leitura" | S |
| Popovers do compositor | cabeçalho visível, âncora no campo, altura fixa | sem cabeçalho, âncora no gatilho, altura pelo espaço | S |
| Resposta rápida | substituía o rascunho | insere no cursor | S |
| Painel SGP | até 4 camadas, ações com borda e cor literal | uma superfície, linhas de ação | S |
| Bolha da IA | lilás com filete | bolha de saída + ícone e rótulo | C |
| Encerrar | vermelho | neutro (vermelho na confirmação) | C |
| Fundo da linha do tempo | gradiente | liso | C |

- [ ] **Step 4: Suíte e commit**

Run: `cd frontend && npx vitest run`

```bash
git add frontend/src/estilo/acentoUnico.test.js docs/superpowers/specs/2026-09-24-redesenho-registro-E2.md
git commit -m "E2.4: pendencias do acento e registro S x C da conversa"
```
