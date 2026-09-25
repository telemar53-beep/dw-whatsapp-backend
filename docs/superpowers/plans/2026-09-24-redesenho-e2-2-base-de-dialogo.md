# E2.2 — Base de diálogo e camadas — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a todo diálogo e popover do produto a base única do Apêndice E.1 — camada leve na pilha para o ESC, cabeçalho sem ícone com o × no fluxo, estado "ocupado", região de erro fixa, nota que alterna motivo × consequência, confirmação estruturada com ação assíncrona, popover base, lista de escolha única e faixa de aviso — sem reestruturar ainda nenhum overlay específico.

**Architecture:** A pilha (`ui/dialogStack.js`) passa a aceitar entradas não modais que só disputam o ESC; `inert`, trava do fundo e foco devolvido continuam olhando só as modais. `ui/Dialog.jsx` ganha a pele nova em tokens (Tailwind) e perde as regras por descendente de `overlays.css`, que viram opt-in (`dw-dialog--legado`) para os diálogos que ainda passam por `WaDialog`. As primitivas novas (`Popover`, `ListaDeEscolha`, `FaixaDeAviso`) nascem aqui e são consumidas nos subplanos E2.3–E2.5.

**Tech Stack:** React 18.3, Vite 5, Tailwind 4.3 (tokens em `@theme`), Vitest 2.1 + Testing Library + jsdom, user-event 14.6.

**Spec:** `docs/superpowers/specs/2026-09-24-redesenho-simplicidade-design.md` (seções 5, 6.6, 9) e `docs/superpowers/specs/2026-09-24-redesenho-apendice-E-overlays.md` (E.1). Plano mestre: `docs/superpowers/plans/2026-09-24-redesenho-e2-mesa-de-atendimento.md`.

> **Provado antes da aprovação (24/09/2026):** as Tasks 1 a 7 foram aplicadas a partir deste texto numa cópia descartável (depois da E2.1): 74 testes da base verdes (os 24 antigos do `Dialog` sem mudar asserção), as duas mutações da Task 1 derrubando o teste previsto, suíte cheia com só as falhas antigas, build ok. Três erros do plano foram achados assim e corrigidos no texto (o `afterEach` que conferia a pilha antes da limpeza do Testing Library; a frase de recusa do backend, que é `Conversation is not currently assigned to you, or is closed`; o nome do rádio da lista, que pegava título + detalhe). Efeito medido: CSS do login +372 B (o Tailwind gera na entrada todo utilitário novo) — dentro da folga que a E2.1 abriu (−4,9 KB).

## Global Constraints

Valem integralmente as do plano mestre (seção "Global Constraints"). As que mais pesam aqui:

- Escopo frontend. Nenhuma rota, payload ou contrato de API muda.
- `ui/Dialog` + `dialogStack`: foco inicial, trap, ESC por pilha, foco devolvido, clique fora à prova de arrasto e `inert` embaixo **não regridem** (spec 9). Os 24 testes atuais de `ui/Dialog.test.jsx` e os 4 de `hooks/useConfirm.test.jsx` continuam verdes, sem mudar asserção, salvo onde esta tarefa diz o contrário e por quê.
- Popover não vira modal: emojis continuam `role="dialog"` não modal, respostas rápidas `role="menu"` (spec 9).
- `WaError`/`WaSuccess` continuam o canal de mensagem: erro com `role="alert"`, confirmação com `role="status"`.
- Valor arbitrário (`-[..]`) proibido em código novo, exceto medida de layout sem token (largura de diálogo, `w-[3px]` da barra) e referência a token (`z-[var(--z-popover)]`).
- CSS sem `@layer` vence utilitário do Tailwind: toda regra antiga que alcança um elemento redesenhado sai **na mesma tarefa**; a prova é estilo computado (E2.6), nunca a classe no DOM.

## Review Focus

- **ESC com duas camadas nascendo no mesmo render.** O painel SGP abre sozinho junto com a conversa dentro do modal da Supervisão: a camada leve do painel precisa ficar ACIMA do modal que a contém (1º ESC fecha o painel, 2º o modal). Teste na Task 1.
- **Diálogo ocupado recebendo ESC.** ESC durante um envio não fecha o diálogo e não chega a nenhuma camada de baixo (a gaveta do menu, um painel). Teste na Task 2.
- **Confirmação com ação que falha.** O diálogo fica aberto, mostra o erro traduzido e deixa tentar de novo ou cancelar; um segundo `confirm()` durante a espera continua resolvendo `false`. Teste na Task 4.
- **Popover na janela baixa.** A 683×384 com o campo do compositor no teto, o popover não passa do topo da janela: a altura máxima é o espaço livre acima do gatilho. Teste na Task 5 (medida simulada) e prova no harness (E2.6).
- **Diálogo de Configurações sem regressão de espaçamento.** Os 11 arquivos que usam `WaDialog` fora da mesa mantêm tipo e rodapé pela classe `dw-dialog--legado`. Teste na Task 2 e print no harness (E2.6).

---

## Arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `frontend/src/components/ui/dialogStack.js` | Modificar | pilha com entradas modais e leves |
| `frontend/src/components/ui/camadaLeve.js` | Criar | hook `useCamadaLeve(aberta, aoFechar)` |
| `frontend/src/components/ui/camadaLeve.test.jsx` | Criar | ordem do ESC entre camadas |
| `frontend/src/components/ui/Dialog.jsx` | Modificar | pele, × no fluxo, `ocupado`, `legado`, `DialogFooter` novo |
| `frontend/src/components/ui/Dialog.test.jsx` | Modificar | testes novos da base |
| `frontend/src/components/overlays.css` | Modificar | base mínima + regras antigas só sob `.dw-dialog--legado` |
| `frontend/src/components/WaDialog.jsx` | Modificar | passa `legado` |
| `frontend/src/components/ui/ConfirmDialog.jsx` | Reescrever | título, corpo, rodapé, ocupado, erro |
| `frontend/src/hooks/useConfirm.jsx` | Modificar | `title`, `acao`, `rotuloOcupado`, `erroPadrao` |
| `frontend/src/hooks/useConfirm.test.jsx` | Modificar | testes da ação assíncrona |
| `frontend/src/components/ui/AlertDialog.jsx` | Reescrever | título que informa, descrição só se difere |
| `frontend/src/components/ui/AlertDialog.test.jsx` | Criar | contrato do alerta |
| `frontend/src/components/ui/Popover.jsx` | Criar | popover base |
| `frontend/src/components/ui/Popover.test.jsx` | Criar | âncora, altura, clique fora, ESC |
| `frontend/src/components/ui/ListaDeEscolha.jsx` | Criar | linha-rádio (E.1-12) |
| `frontend/src/components/ui/ListaDeEscolha.test.jsx` | Criar | contrato da lista |
| `frontend/src/components/ui/FaixaDeAviso.jsx` | Criar | faixa de 1 linha (E.1-13) |
| `frontend/src/components/ui/FaixaDeAviso.test.jsx` | Criar | contrato da faixa |
| `frontend/src/components/ui/index.js` | Modificar | exporta as primitivas novas |
| `frontend/src/components/CloseReasonModal.jsx`, `ConversationHistoryModal.jsx`, `TeamModal.jsx` | Modificar | tiram `icon`/`tone` (a base não os desenha mais) |

## Interfaces

**Consome (E2.1):** utilitários de token `bg-veu`, `bg-elevado`, `bg-campo`, `bg-hover`, `bg-selecionado`, `bg-aviso-fundo`, `border-linha`, `text-tinta`, `text-tinta-2`, `text-tinta-3`, `text-aviso`, `text-perigo`, `bg-accent`, `border-accent`, `outline-focus-ring`, `rounded-ui-sm|md|lg`, `shadow-flutuante`, `shadow-dialogo`, `text-meta|rotulo|corpo|titulo`, `font-display`, `font-sans`, `duration-120`; ícones `IconClose`, `IconWarning` de `components/icons/IconesTrabalho.js`; `Button` com as variantes `primary | secondary | danger | ghost`.

**Produz (para E2.3–E2.5):**

```js
// ui/dialogStack.js — entrada: { fechar(), fecharComEsc: bool, painel: Element|null, modal?: bool (padrão true) }
export function entrar(entrada) // → sair()
export function posicaoDe(entrada) // → { profundidade: number, topo: bool } (só modais contam)
export function topoDaPilha() // → a entrada MODAL do topo, ou null
export function altura() // → total de entradas (modais + leves)

// ui/camadaLeve.js
export function useCamadaLeve(aberta: boolean, aoFechar: () => void): void

// ui/Dialog.jsx — props novas: ocupado?: bool, legado?: bool. Saem: icon, tone.
export function DialogFooter({ nota?: node, motivo?: string|null, motivoId?: string, erro?: string|null, className?, children })

// ui/ConfirmDialog.jsx
export function ConfirmDialog({ open, title?, message, confirmLabel?, cancelLabel?, danger?, ocupado?, rotuloOcupado?, erro?, onConfirm, onCancel })

// hooks/useConfirm.jsx — confirm(message, { title?, danger?, confirmLabel?, cancelLabel?, acao?: () => Promise, rotuloOcupado?, erroPadrao? }) → Promise<boolean>

// ui/AlertDialog.jsx
export function AlertDialog({ open, title = 'Aviso', message, confirmLabel = 'Entendi', onClose })

// ui/Popover.jsx
export function Popover({ aberto, aoFechar, ancoraRef, manterAbertoEm?: Ref[], role = 'dialog', ariaLabel, id, largura?: number, className?, children, ...rest })

// ui/ListaDeEscolha.jsx — opcao: { valor: string, titulo: node, detalhe?: node, icone?: node, fim?: node, desabilitada?: bool }
export function ListaDeEscolha({ legenda, legendaVisivel = true, nome, opcoes, valor, aoEscolher, desabilitada = false, colunas = 1, className })

// ui/FaixaDeAviso.jsx — acao: { rotulo, para?: string, aoClicar?: () => void }
export function FaixaDeAviso({ texto, titulo?, acao?, className })
```

---

### Task 1: Camada leve na pilha

**Files:**
- Modify: `frontend/src/components/ui/dialogStack.js` (arquivo inteiro, 135 linhas)
- Create: `frontend/src/components/ui/camadaLeve.js`
- Test: `frontend/src/components/ui/camadaLeve.test.jsx`

**Interfaces:** Produces `useCamadaLeve(aberta, aoFechar)` e a entrada `{ modal: false }` na pilha.

Por quê: hoje há quatro ouvintes de ESC próprios no `document` (gaveta e menu da conta em `SideNav.jsx:91-93` e `:103-107`, painel da conversa em `ConversationView.jsx:331-341`, popovers do compositor em `MessageInput.jsx:189-194`). O da pilha foi registrado antes e roda primeiro; o `stopPropagation` dele não detém ouvinte no mesmo nó. Resultado: com o SGP aberto dentro do modal da Supervisão, um ESC fecha o modal inteiro (CVM-MOD-10). Esta tarefa cria o mecanismo; os quatro ouvintes migram nas tarefas que reescrevem cada componente: gaveta e menu da conta na E2.3 Task 2; painel da conversa na E2.4 Task 4; popovers do compositor na E2.4 Task 6. (O quinto, o dos filtros da Supervisão — `SupervisionPage.jsx:84` —, é da E5.)

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/components/ui/camadaLeve.test.jsx`:

```jsx
import { describe, test, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogBody } from './Dialog';
import { useCamadaLeve } from './camadaLeve';
import { altura } from './dialogStack';

// Uma camada leve de teste: um "popover" que abre por botão (ou já nasce
// aberto) e diz na tela se está aberto.
function Leve({ nome, nasceAberta = false, aoFechar = () => {} }) {
  const [aberta, setAberta] = useState(nasceAberta);
  useCamadaLeve(aberta, () => {
    setAberta(false);
    aoFechar();
  });
  return (
    <div>
      <button type="button" onClick={() => setAberta(true)}>Abrir {nome}</button>
      <p>{nome} {aberta ? 'aberta' : 'fechada'}</p>
    </div>
  );
}

// A limpeza do Testing Library roda DEPOIS deste afterEach: sem o cleanup()
// explícito, a pilha ainda teria as camadas do teste que acabou (e, se a
// asserção falhar, a limpeza nem roda e o DOM vaza para o teste seguinte).
afterEach(() => {
  cleanup();
  expect(altura()).toBe(0);
});

describe('camada leve na pilha', () => {
  test('ESC fecha só a camada leve do topo', async () => {
    render(
      <>
        <Leve nome="Gaveta" />
        <Leve nome="Menu" />
      </>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Abrir Gaveta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Abrir Menu' }));

    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('Menu fechada')).toBeInTheDocument();
    expect(screen.getByText('Gaveta aberta')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('Gaveta fechada')).toBeInTheDocument();
  });

  test('popover aberto dentro de um diálogo: o 1º ESC fecha o popover, o 2º o diálogo', async () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Conversa" onClose={onClose}>
        <DialogBody>
          <Leve nome="Popover" />
        </DialogBody>
      </Dialog>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Abrir Popover' }));

    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('Popover fechada')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // O painel SGP abre sozinho junto com a conversa (conversa com CPF): a camada
  // leve nasce no MESMO render do diálogo que a contém. Efeito de layout do
  // filho roda antes do do pai; se a camada entrasse na pilha por
  // useLayoutEffect, ficaria ABAIXO do diálogo e o ESC fecharia o modal inteiro.
  test('camada leve que nasce aberta junto com o diálogo fica acima dele', async () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Conversa" onClose={onClose}>
        <DialogBody>
          <Leve nome="Painel" nasceAberta />
        </DialogBody>
      </Dialog>
    );

    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('Painel fechada')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('camada leve aberta não deixa o diálogo que a contém inerte', async () => {
    render(
      <Dialog title="Conversa" onClose={() => {}}>
        <DialogBody>
          <Leve nome="Popover" />
        </DialogBody>
      </Dialog>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Abrir Popover' }));

    const fundo = screen.getByRole('dialog').parentElement;
    expect(fundo).not.toHaveAttribute('inert');
  });

  test('camada leve não trava a rolagem do fundo', async () => {
    render(<Leve nome="Gaveta" />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir Gaveta' }));
    expect(document.body.style.overflow).toBe('');
  });

  test('diálogo aberto por cima de uma camada leve fecha primeiro', async () => {
    function GavetaComPerfil() {
      const [perfil, setPerfil] = useState(false);
      return (
        <>
          <Leve nome="Gaveta" />
          <button type="button" onClick={() => setPerfil(true)}>Meu perfil</button>
          {perfil && <Dialog title="Meu perfil" onClose={() => setPerfil(false)}><DialogBody>perfil</DialogBody></Dialog>}
        </>
      );
    }
    render(<GavetaComPerfil />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir Gaveta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Meu perfil' }));

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Gaveta aberta')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('Gaveta fechada')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ui/camadaLeve.test.jsx`
Expected: FAIL — `Failed to resolve import "./camadaLeve"`.

- [ ] **Step 3: Implementar**

Substituir `frontend/src/components/ui/dialogStack.js` inteiro por:

```js
// Uma pilha só para todos os diálogos modais do produto — e, desde a E2, para
// as camadas leves que disputam o ESC com eles.
//
// Antes cada diálogo tinha o próprio listener de ESC no `document` e o próprio
// z-index escrito à mão. O preço era visível: em "Encerrados → conversa" um
// único ESC fechava os dois de uma vez, e a conversa só aparecia na frente
// porque alguém descobriu na marra que precisava de um número maior que o do
// diálogo que a abriu.
//
// Camada LEVE (`modal: false`): popover do compositor, painel lateral da
// conversa, menu da conta, gaveta do menu. Ela só participa da ORDEM DO ESC — o
// topo da pilha inteira fecha primeiro. Não conta para profundidade, `inert`,
// trava do fundo nem foco devolvido: um popover dentro de um diálogo mora
// dentro dele, e deixar o diálogo inerte por causa dele quebraria o próprio
// popover. Eram quatro ouvintes de ESC avulsos no `document`; com dois abertos,
// um ESC fechava os dois (CVM-MOD-10).
//
// É um módulo, e não um Provider, de propósito: diálogo montado fora do
// AppShell — um teste, um fluxo que ainda não passa pela casca — continua
// entrando na pilha. Não existe caminho em que "faltou o Provider" degrade o
// comportamento em silêncio.

const pilha = [];
const ouvintes = new Set();

// O passo entre diálogos empilhados mora no CSS, junto da base `--z-dialog`.
// O número daqui é apenas o resgate para quando não há CSS (teste em jsdom,
// render no servidor).
const PASSO_PADRAO = 10;
let passoLido = null;

export function passoDeCamada() {
  if (passoLido !== null) return passoLido;
  let lido = NaN;
  if (typeof window !== 'undefined' && document.documentElement) {
    lido = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--z-dialog-step'), 10);
  }
  passoLido = Number.isFinite(lido) && lido > 0 ? lido : PASSO_PADRAO;
  return passoLido;
}

function ehModal(entrada) {
  return entrada.modal !== false;
}

function contarModais() {
  let n = 0;
  for (const entrada of pilha) if (ehModal(entrada)) n += 1;
  return n;
}

function avisar() {
  for (const ouvinte of [...ouvintes]) ouvinte();
}

function aoTeclar(evento) {
  if (evento.key !== 'Escape' || evento.defaultPrevented) return;
  const topo = pilha[pilha.length - 1];
  if (!topo || !topo.fecharComEsc) return;
  // Só o topo responde. Sem isto, dois níveis abertos somem com um ESC só.
  evento.preventDefault();
  evento.stopPropagation();
  topo.fechar();
}

function ligarTeclado() {
  if (pilha.length !== 1) return;
  document.addEventListener('keydown', aoTeclar);
}

function desligarTeclado() {
  if (pilha.length !== 0) return;
  document.removeEventListener('keydown', aoTeclar);
}

// Trava do fundo. Só diálogo MODAL trava; é a pilha que trava e destrava, uma
// vez só. O estilo inline anterior do body é devolvido exatamente como estava.
let fundoTravado = null;

function medirBarraDeRolagem() {
  const raiz = document.documentElement;
  return Math.max(0, window.innerWidth - raiz.clientWidth);
}

function travarFundo() {
  if (contarModais() !== 1 || typeof document === 'undefined' || fundoTravado) return;
  const corpo = document.body;
  fundoTravado = {
    overflow: corpo.style.overflow,
    paddingRight: corpo.style.paddingRight,
  };
  corpo.style.overflow = 'hidden';
  const barra = medirBarraDeRolagem();
  if (barra > 0) corpo.style.paddingRight = `${barra}px`;
}

function destravarFundo() {
  if (contarModais() !== 0 || !fundoTravado) return;
  const corpo = document.body;
  corpo.style.overflow = fundoTravado.overflow;
  corpo.style.paddingRight = fundoTravado.paddingRight;
  if (!corpo.getAttribute('style')) corpo.removeAttribute('style');
  fundoTravado = null;
}

export function inscrever(ouvinte) {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

// Entra no topo. Devolve a função de saída, que é o único jeito de sair.
export function entrar(entrada) {
  pilha.push(entrada);
  ligarTeclado();
  if (ehModal(entrada)) travarFundo();
  avisar();
  return function sair() {
    const posicao = pilha.indexOf(entrada);
    if (posicao === -1) return;
    pilha.splice(posicao, 1);
    desligarTeclado();
    destravarFundo();
    avisar();
  };
}

// Profundidade e topo contam só as camadas MODAIS: é o que decide z-index,
// `inert` e para onde o foco volta.
export function posicaoDe(entrada) {
  if (!ehModal(entrada)) {
    const posicao = pilha.indexOf(entrada);
    return { profundidade: 0, topo: posicao === -1 || posicao === pilha.length - 1 };
  }
  const modais = pilha.filter(ehModal);
  const profundidade = modais.indexOf(entrada);
  return {
    profundidade: profundidade < 0 ? 0 : profundidade,
    topo: profundidade === -1 || profundidade === modais.length - 1,
  };
}

// O diálogo MODAL do topo (camadas leves não recebem foco devolvido).
export function topoDaPilha() {
  for (let i = pilha.length - 1; i >= 0; i -= 1) {
    if (ehModal(pilha[i])) return pilha[i];
  }
  return null;
}

export function altura() {
  return pilha.length;
}
```

Criar `frontend/src/components/ui/camadaLeve.js`:

```js
import { useEffect, useMemo, useRef } from 'react';
import { entrar } from './dialogStack';

// Camada leve: participa SÓ da ordem do ESC (ver dialogStack.js). Não recebe
// `inert`, não trava o fundo, não prende o Tab e não muda para onde o foco
// volta — quem fecha devolve o foco ao próprio gatilho.
//
// Entra na pilha por useEffect, e não por useLayoutEffect, de propósito: o
// painel SGP nasce aberto no MESMO render da conversa em modal. Efeito de
// layout do filho roda antes do do pai; entrando no layout, o painel ficaria
// abaixo do diálogo que o contém e o 1º ESC fecharia o modal inteiro. Efeito
// passivo roda depois de todos os de layout do mesmo commit, e o React 18
// esvazia os passivos pendentes antes de tratar a próxima tecla.
export function useCamadaLeve(aberta, aoFechar) {
  const fecharRef = useRef(aoFechar);
  fecharRef.current = aoFechar;

  const entrada = useMemo(
    () => ({
      modal: false,
      fecharComEsc: true,
      fechar: () => fecharRef.current && fecharRef.current(),
      painel: null,
    }),
    [],
  );

  useEffect(() => {
    if (!aberta) return undefined;
    return entrar(entrada);
  }, [aberta, entrada]);
}
```

- [ ] **Step 4: Rodar e ver passar — os novos e os da pilha antiga**

Run: `cd frontend && npx vitest run src/components/ui/camadaLeve.test.jsx src/components/ui/Dialog.test.jsx src/hooks/useConfirm.test.jsx src/components/MessageAttachment.test.jsx`
Expected: PASS em todos — 77 testes nos quatro arquivos (6 novos + os existentes; `MessageAttachment` cobre "ESC fecha o visualizador pela pilha"). Provado numa cópia descartável em 24/09, com as duas mutações do Step 5 derrubando exatamente o teste previsto.

- [ ] **Step 5: Provar por mutação**

Trocar temporariamente `useEffect` por `useLayoutEffect` em `camadaLeve.js` (e o import). Rodar `npx vitest run src/components/ui/camadaLeve.test.jsx`.
Expected: FAIL só em "camada leve que nasce aberta junto com o diálogo fica acima dele". Desfazer.

Trocar temporariamente, em `posicaoDe`, `pilha.filter(ehModal)` por `pilha`. Rodar de novo.
Expected: FAIL em "camada leve aberta não deixa o diálogo que a contém inerte". Desfazer.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/dialogStack.js frontend/src/components/ui/camadaLeve.js frontend/src/components/ui/camadaLeve.test.jsx
git commit -m "E2.2: camada leve na pilha - ESC em ordem entre popover, painel e dialogo"
```

---

### Task 2: Pele e cabeçalho do diálogo, estado "ocupado" e classe de legado

**Files:**
- Modify: `frontend/src/components/ui/Dialog.jsx:1-5` (imports), `:147-340` (componente `Dialog`)
- Modify: `frontend/src/components/overlays.css:1-36` (base) e `:159-164`, `:234` (confirmação/alerta)
- Modify: `frontend/src/components/WaDialog.jsx:37-42`
- Modify: `frontend/src/components/CloseReasonModal.jsx:77-78`, `frontend/src/components/ConversationHistoryModal.jsx:96`, `frontend/src/components/TeamModal.jsx:113-114`
- Test: `frontend/src/components/ui/Dialog.test.jsx`

**Interfaces:**
- Consumes: tokens e `IconClose` de `components/icons/IconesTrabalho.js` (E2.1).
- Produces: `Dialog` com `ocupado?: bool`, `legado?: bool`; sem `icon`/`tone`. O × tem `data-dialog-close=""` e nome acessível `closeLabel`.

Regras (Apêndice E.1): 1 sem ícone de cabeçalho; 2 × só onde o diálogo decide (a base mantém `dismissible` com padrão `true` — cada overlay da mesa passa `dismissible={false}` quando é diálogo de ação, na E2.5; os de Configurações ficam como estão até a E6); 3 margem única de 24 px; 7 ocupado como guarda única do fechamento; 14 pele (véu sólido sem blur, `--color-elevado`, raio 16, uma sombra, título Sora 16, Inter no resto). O × entra no fluxo do cabeçalho quando há título; num diálogo sem título (hoje só `ConversationModal`, que a E2.5 reestrutura) continua absoluto no canto.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao fim do `describe('base de diálogo', …)` em `frontend/src/components/ui/Dialog.test.jsx`:

```jsx
  test('o × fica no fluxo do cabeçalho, ao lado do título', () => {
    render(<Formulario />);
    const cabecalho = screen.getByRole('dialog').querySelector('.dw-dialog-heading');
    expect(cabecalho).toContainElement(screen.getByRole('button', { name: 'Fechar' }));
    expect(cabecalho).toContainElement(screen.getByRole('heading', { name: 'Editar cliente' }));
  });

  test('não desenha ícone de cabeçalho nem aceita tom', () => {
    render(<Formulario icon={<svg data-testid="icone" />} tone="perigo" />);
    expect(screen.queryByTestId('icone')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog').querySelector('[data-tom]')).toBeNull();
  });

  test('o véu é sólido: sem desfoque em profundidade nenhuma', () => {
    render(<Formulario />);
    const fundo = screen.getByRole('dialog').parentElement;
    expect(fundo.className).not.toMatch(/backdrop-blur/);
    expect(screen.getByRole('dialog').className).not.toMatch(/backdrop-blur/);
  });

  test('ocupado: ESC, × e clique no fundo não fecham, e o ESC não chega a quem está embaixo', async () => {
    const onClose = vi.fn();
    const ouvinteDeBaixo = vi.fn();
    document.addEventListener('keydown', ouvinteDeBaixo);
    const { rerender } = render(<Formulario onClose={onClose} ocupado closeOnBackdrop />);

    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(ouvinteDeBaixo.mock.calls.at(-1)[0].defaultPrevented).toBe(true);

    expect(screen.getByRole('button', { name: 'Fechar' })).toBeDisabled();

    const fundo = screen.getByRole('dialog').parentElement;
    ponteiro(fundo, 'pointerdown', 5, 5);
    ponteiro(fundo, 'pointerup', 5, 5);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');

    rerender(<Formulario onClose={onClose} closeOnBackdrop />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', ouvinteDeBaixo);
  });

  test('legado é opt-in: o Dialog não põe a classe; o WaDialog põe', async () => {
    const { unmount } = render(<Formulario />);
    expect(screen.getByRole('dialog')).not.toHaveClass('dw-dialog--legado');
    unmount();
    const { default: WaDialog } = await import('../WaDialog');
    render(<WaDialog title="Cidade" onClose={() => {}}><DialogBody>campo</DialogBody></WaDialog>);
    expect(screen.getByRole('dialog')).toHaveClass('dw-dialog--legado');
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ui/Dialog.test.jsx`
Expected: FAIL nos 5 novos (o × é irmão do cabeçalho; o ícone é desenhado; `backdrop-blur` no véu; ESC fecha ocupado; sem classe de legado).

- [ ] **Step 3: Implementar o `Dialog`**

Em `frontend/src/components/ui/Dialog.jsx`, trocar o import do ícone (linha 4):

```js
import { IconClose } from '../icons/IconesTrabalho';
```

Substituir a função `Dialog` inteira (linhas 147-340) por:

```jsx
export function Dialog({
  title,
  description,
  labelledBy,
  ariaLabel,
  describedBy,
  role = 'dialog',
  size = 'max-w-md',
  variant = 'standard',
  orientation = 'col',
  onClose,
  closeOnBackdrop = false,
  closeOnEsc = true,
  dismissible = true,
  ocupado = false,
  legado = false,
  initialFocus = 'auto',
  closeLabel = 'Fechar',
  className = '',
  children,
}) {
  const painelRef = useRef(null);
  const abridorRef = useRef(null);
  const descidaRef = useRef(null);
  const fecharRef = useRef(onClose);
  const ocupadoRef = useRef(ocupado);
  const id = useId();
  const tituloId = `${id}-titulo`;
  const descricaoId = `${id}-descricao`;

  fecharRef.current = onClose;
  ocupadoRef.current = ocupado;

  // Guarda ÚNICA do fechamento (E.1-7): ESC, ×, clique no fundo e qualquer
  // caminho futuro passam por aqui. Com envio em curso nada fecha — era assim
  // que se fechava um formulário no meio do POST (família C.4.3). O ESC
  // continua marcado como tratado pela pilha, então não chega a quem está
  // embaixo.
  function fecharSeLivre() {
    if (ocupadoRef.current) return;
    if (fecharRef.current) fecharRef.current();
  }

  // A entrada é estável por instância: é ela que identifica este diálogo na
  // pilha, e os callbacks leem sempre a versão atual pelas refs.
  const entrada = useMemo(
    () => ({
      modal: true,
      fechar: () => {
        if (ocupadoRef.current) return;
        if (fecharRef.current) fecharRef.current();
      },
      fecharComEsc: closeOnEsc,
      painel: null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  entrada.fecharComEsc = closeOnEsc;

  const [camada, setCamada] = useState(() => posicaoDe(entrada));

  useLayoutEffect(() => {
    entrada.painel = painelRef.current;
    const sair = entrar(entrada);
    // A inscrição tem de vir DEPOIS de entrar e ler a posição na sequência: o
    // aviso da própria entrada já passou, e sem esta leitura o diálogo ficaria
    // para sempre achando que é o nível 0.
    setCamada(posicaoDe(entrada));
    const desinscrever = inscrever(() => setCamada(posicaoDe(entrada)));
    return () => {
      desinscrever();
      sair();
    };
  }, [entrada]);

  // Foco: guarda quem abriu, entrega o foco ao diálogo e devolve na saída.
  useEffect(() => {
    const ativo = document.activeElement;
    abridorRef.current = ativo && typeof ativo.focus === 'function' ? ativo : null;
    const painel = painelRef.current;
    if (painel) {
      const alvo = initialFocus === 'dialog' ? painel : alvoDoFocoInicial(painel);
      if (alvo && typeof alvo.focus === 'function') alvo.focus();
    }

    return () => {
      const abridor = abridorRef.current;
      if (abridor && document.contains(abridor)) {
        destravarNivelDeBaixo(abridor);
        abridor.focus();
        return;
      }
      // Quem abriu sumiu junto (uma linha de lista que foi filtrada, por
      // exemplo): o foco volta para o diálogo que passou a ser o topo.
      const topo = topoDaPilha();
      if (topo && topo !== entrada && topo.painel && document.contains(topo.painel)) {
        destravarNivelDeBaixo(topo.painel);
        topo.painel.focus();
      }
    };
  }, [entrada]);

  function prenderTab(evento) {
    if (evento.key !== 'Tab') return;
    const painel = painelRef.current;
    const lista = focaveis(painel);
    if (lista.length === 0) {
      evento.preventDefault();
      painel.focus();
      return;
    }
    const primeiro = lista[0];
    const ultimo = lista[lista.length - 1];
    const ativo = document.activeElement;
    if (evento.shiftKey && (ativo === primeiro || ativo === painel)) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && ativo === ultimo) {
      evento.preventDefault();
      primeiro.focus();
    }
  }

  // Clique fora só conta quando o gesto INTEIRO aconteceu no fundo. Descer o
  // ponteiro dentro do diálogo — selecionando o texto de um campo, por exemplo —
  // e soltar fora não fecha nada. Era assim que se perdia formulário preenchido.
  function aoDescerNoFundo(evento) {
    if (evento.target !== evento.currentTarget || evento.button !== 0) {
      descidaRef.current = null;
      return;
    }
    descidaRef.current = { x: evento.clientX, y: evento.clientY, ponteiro: evento.pointerId };
  }

  function aoSubirNoFundo(evento) {
    const descida = descidaRef.current;
    descidaRef.current = null;
    if (!closeOnBackdrop || !descida) return;
    if (evento.target !== evento.currentTarget) return;
    if (evento.pointerId !== undefined && descida.ponteiro !== undefined && evento.pointerId !== descida.ponteiro) return;
    const andou = Math.hypot(evento.clientX - descida.x, evento.clientY - descida.y);
    if (andou > TOLERANCIA_DE_ARRASTO) return;
    const selecao = typeof window !== 'undefined' && window.getSelection && window.getSelection();
    if (selecao && !selecao.isCollapsed) return;
    fecharSeLivre();
  }

  const nomeado = labelledBy || (title ? tituloId : undefined);

  const botaoFechar = dismissible ? (
    <button
      type="button"
      data-dialog-close=""
      onClick={fecharSeLivre}
      disabled={ocupado}
      aria-label={closeLabel}
      title={closeLabel}
      className={`dw-dialog-close grid h-9 w-9 shrink-0 place-items-center rounded-ui-md text-tinta-2 transition-colors duration-120 hover:bg-hover hover:text-tinta disabled:cursor-not-allowed disabled:opacity-50 ${
        title ? '-mr-2 -mt-1' : 'absolute right-3 top-3 z-10'
      }`}
    >
      <IconClose size={20} />
    </button>
  ) : null;

  return createPortal(
    <div
      className="chat-theme fixed inset-0 flex items-center justify-center bg-veu p-4 font-sans"
      style={{ zIndex: `calc(var(--z-dialog) + ${camada.profundidade * passoDeCamada()})` }}
      data-dialog-depth={camada.profundidade}
      inert={camada.topo ? undefined : ''}
      onPointerDown={aoDescerNoFundo}
      onPointerUp={aoSubirNoFundo}
    >
      <div
        ref={painelRef}
        role={role}
        data-dialog={variant}
        aria-modal="true"
        aria-labelledby={nomeado}
        aria-label={nomeado ? undefined : ariaLabel}
        aria-describedby={describedBy || (title && description ? descricaoId : undefined)}
        aria-busy={ocupado || undefined}
        tabIndex={-1}
        onKeyDown={prenderTab}
        className={`dw-dialog animate-wa-pop relative flex w-full ${size} ${orientation === 'row' ? 'flex-row' : 'flex-col'} overflow-hidden rounded-ui-lg border border-linha bg-elevado text-tinta shadow-dialogo ${
          legado ? 'dw-dialog--legado' : ''
        } ${className}`}
      >
        {title ? (
          <div className="dw-dialog-heading flex shrink-0 items-start gap-4 border-b border-linha px-6 pb-4 pt-6">
            <div className="min-w-0 flex-1">
              <h2 id={tituloId} className="font-display text-titulo font-semibold text-tinta">
                {title}
              </h2>
              {description && (
                <p id={descricaoId} className="mt-1 text-rotulo text-tinta-2">
                  {description}
                </p>
              )}
            </div>
            {botaoFechar}
          </div>
        ) : (
          botaoFechar
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
```

`DialogBody` (linhas 131-137) passa a:

```jsx
export function DialogBody({ className = '', children, ...rest }) {
  return (
    <div className={`dw-dialog-body wa-scroll px-6 py-4 ${className}`} {...rest}>
      {children}
    </div>
  );
}
```

(`DialogFooter` muda na Task 3.)

- [ ] **Step 4: Reescrever a base de `overlays.css`**

Substituir as linhas 1-36 de `frontend/src/components/overlays.css` por:

```css
/* Base do diálogo (E2). A pele mora no JSX de ui/Dialog.jsx, em tokens; aqui
   fica só o que o utilitário não diz: o teto de altura e o eixo único de
   rolagem do corpo. */
.dw-dialog {height:auto;min-height:0;max-height:calc(100dvh - 32px)}
.dw-dialog-body {flex:1 1 auto;min-height:0;overflow-y:auto}
/* LEGADO — opt-in pela classe `dw-dialog--legado`, que o WaDialog põe. Os
   diálogos de Configurações (e os da mesa até a E2.5) mantêm o tipo e o rodapé
   por seletor até a etapa da área deles. Antes estas regras valiam para
   DESCENDENTE de todo diálogo e vazavam para o compositor da conversa aberta em
   modal (13 px, raio 7, alça de redimensionar). */
.dw-dialog--legado :is(input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea) {font-size:13px;line-height:19px;border-radius:7px;padding:7px 10px;min-width:0}
.dw-dialog--legado textarea {resize:vertical}
.dw-dialog--legado label,.dw-dialog--legado legend {font-size:12px}
.dw-dialog--legado button {font-size:12px;line-height:18px}
.dw-dialog--legado button:disabled {opacity:.5}
.dw-dialog--legado form > div:last-child:has(> button),.dw-dialog--legado > div:last-child:has(> button) {border-top:1px solid var(--color-linha);padding:12px 24px;gap:8px;flex:none}
.dw-dialog--legado form > div:last-child:has(> button) button,.dw-dialog--legado > div:last-child:has(> button) button {padding:7px 13px;border-radius:7px}
/* Rodapé montado à mão por Transferir e Encerrar até a E2.5. */
.dw-dialog--legado .dw-dialog-footer:has(.dw-dialog-nota) {justify-content:space-between;gap:14px}
.dw-dialog--legado .dw-dialog-nota {font-size:11.5px;line-height:16px;color:var(--color-tinta-3);min-width:0}
.dw-dialog--legado .dw-dialog-acoes {flex:none;display:flex;align-items:center;gap:8px}
```

Apagar as regras da confirmação e do alerta (a Task 4 reescreve os dois em tokens): as linhas hoje em `:159-164` (de `[data-dialog=confirm],[data-dialog=alert] {max-width:480px}` até `[data-dialog=confirm] .dialog-confirm-body > div,…{grid-column:1/-1;…}`), e, na linha hoje `:234`, tirar só os dois últimos seletores da lista (`,[data-dialog=confirm] > div,[data-dialog=alert] > div`), mantendo o resto da regra.

Conferir que nada mais referencia o que saiu:

Run: `cd frontend && grep -rn "dw-dialog-icon\|data-tom\|dialog-confirm-icon\|dialog-confirm-body" src --include=*.jsx --include=*.js --include=*.css`
Expected: só `src/components/ui/ConfirmDialog.jsx` e `src/components/ui/AlertDialog.jsx` (reescritos na Task 4).

- [ ] **Step 5: `WaDialog` põe o legado; os três chamadores tiram `icon`/`tone`**

`frontend/src/components/WaDialog.jsx`, função `WaDialog` (linhas 37-42):

```jsx
function WaDialog(props) {
  // `closeOnBackdrop` nasce falso: antes QUALQUER clique no fundo fechava
  // qualquer diálogo, inclusive um formulário preenchido. Quem é de leitura
  // pede a permissão de volta explicitamente.
  // `legado`: quem ainda passa por aqui mantém o tipo e o rodapé por seletor de
  // overlays.css até a etapa da área dele. Código novo usa `ui/Dialog` direto.
  return <Dialog legado {...props} />;
}
```

Em `CloseReasonModal.jsx` apagar as props `icon={…}` e `tone="perigo"` (linhas 77-78); em `ConversationHistoryModal.jsx:96` apagar `icon={<IconHistory size={18} />} tone="info"` (e o import de `IconHistory` se ficar sem uso); em `TeamModal.jsx` apagar `icon={…}` e `tone="ok"` (linhas 113-114) e o import do ícone se ficar sem uso.

- [ ] **Step 6: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/ui src/hooks/useConfirm.test.jsx src/components/CloseReasonModal.test.jsx src/components/ConversationHistoryModal.test.jsx src/components/TeamPanel.test.jsx src/components/MessageAttachment.test.jsx`
Expected: PASS (29 da base + os demais inalterados).

- [ ] **Step 7: Provar por mutação**

Trocar em `fecharSeLivre` o `if (ocupadoRef.current) return;` por nada; rodar `npx vitest run src/components/ui/Dialog.test.jsx`.
Expected: FAIL em "ocupado: ESC, × e clique no fundo não fecham…". Desfazer.

- [ ] **Step 8: Suíte inteira e build**

Run: `cd frontend && npx vitest run && npx vite build`
Expected: as 1.604 atuais + as novas passando; as 5 falhas antigas continuam as mesmas (ou zero, se a E0 já as corrigiu); build sem erro.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/ui/Dialog.jsx frontend/src/components/ui/Dialog.test.jsx frontend/src/components/overlays.css frontend/src/components/WaDialog.jsx frontend/src/components/CloseReasonModal.jsx frontend/src/components/ConversationHistoryModal.jsx frontend/src/components/TeamModal.jsx
git commit -m "E2.2: pele unica do dialogo, x no fluxo do cabecalho, estado ocupado e legado opt-in"
```

---

### Task 3: Rodapé com região de erro fixa e nota que alterna

**Files:**
- Modify: `frontend/src/components/ui/Dialog.jsx:139-145` (`DialogFooter`)
- Test: `frontend/src/components/ui/Dialog.test.jsx`

**Interfaces:** Produces `DialogFooter({ nota, motivo, motivoId, erro, className, children })`.

Regras E.1-5 e E.1-6: o erro fica entre o corpo e as ações, fora do eixo de rolagem (hoje, com lista longa, a falha ficava abaixo da dobra e "nada acontecia"); com a ação principal desabilitada, a nota diz o que falta e o botão aponta para ela por `aria-describedby`; disponível, a nota volta a ser a consequência.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `Dialog.test.jsx` (no mesmo `describe`), com o import de `Button` no topo do arquivo (`import { Button } from './Button';`):

```jsx
  function RodapeComMotivo({ escolhido = false, erro = null }) {
    return (
      <Dialog title="Transferir atendimento" onClose={() => {}}>
        <DialogBody>
          <p>lista longa</p>
        </DialogBody>
        <DialogFooter
          erro={erro}
          nota="A transferência fica registrada no histórico."
          motivo={escolhido ? null : 'Escolha quem vai receber o atendimento.'}
          motivoId="motivo-transferir"
        >
          <Button variant="secondary">Cancelar</Button>
          <Button disabled={!escolhido} aria-describedby={escolhido ? undefined : 'motivo-transferir'}>Transferir</Button>
        </DialogFooter>
      </Dialog>
    );
  }

  test('sem escolha, a nota diz o que falta e o botão desabilitado aponta para ela', () => {
    render(<RodapeComMotivo />);
    const botao = screen.getByRole('button', { name: 'Transferir' });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAccessibleDescription('Escolha quem vai receber o atendimento.');
    expect(screen.queryByText('A transferência fica registrada no histórico.')).not.toBeInTheDocument();
  });

  test('com escolha, a nota volta a ser a consequência', () => {
    render(<RodapeComMotivo escolhido />);
    expect(screen.getByText('A transferência fica registrada no histórico.')).toBeInTheDocument();
    expect(screen.queryByText('Escolha quem vai receber o atendimento.')).not.toBeInTheDocument();
  });

  test('o erro fica fora do corpo rolável e antes das ações', () => {
    render(<RodapeComMotivo escolhido erro="Não foi possível transferir. Tente de novo." />);
    const painel = screen.getByRole('dialog');
    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Não foi possível transferir. Tente de novo.');
    expect(painel.querySelector('.dw-dialog-body').contains(alerta)).toBe(false);
    const rodape = painel.querySelector('.dw-dialog-footer');
    expect(alerta.compareDocumentPosition(rodape) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ui/Dialog.test.jsx`
Expected: FAIL nos 3 novos (o `DialogFooter` atual ignora `nota`, `motivo` e `erro`).

- [ ] **Step 3: Implementar**

Substituir `DialogFooter` (linhas 139-145) por:

```jsx
// Rodapé único (E.1-2, -5, -6): [nota à esquerda] … [Cancelar][ação principal].
// Com a ação desabilitada, `motivo` ocupa o lugar da nota e diz o que falta; o
// botão aponta para ele por `aria-describedby={motivoId}` (quem chama liga).
// O erro fica ACIMA das ações e FORA do corpo rolável: com lista longa, a falha
// no fim do corpo ficava abaixo da dobra e o clique parecia não ter feito nada.
// `role="alert"` é o mesmo contrato do WaError (não importado daqui porque o
// WaDialog importa este arquivo).
export function DialogFooter({ nota, motivo = null, motivoId, erro = null, className = '', children, ...rest }) {
  const texto = motivo || nota;
  return (
    <>
      {erro ? (
        <p role="alert" className="dw-dialog-erro mx-6 mt-3 shrink-0 rounded-ui-md bg-perigo-fundo px-3 py-2 text-rotulo text-perigo">
          {erro}
        </p>
      ) : null}
      <div className={`dw-dialog-footer flex shrink-0 items-center justify-end gap-4 border-t border-linha px-6 py-4 ${className}`} {...rest}>
        {texto ? (
          <p id={motivo ? motivoId : undefined} className={`dw-dialog-nota mr-auto min-w-0 text-rotulo ${motivo ? 'text-tinta' : 'text-tinta-2'}`}>
            {texto}
          </p>
        ) : null}
        <div className="dw-dialog-acoes flex shrink-0 items-center gap-2">{children}</div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/ui/Dialog.test.jsx src/components/SendTemplateModal.test.jsx`
Expected: PASS (inclui "o corpo é o único eixo de rolagem" e "o rodapé segue a ordem [secundária][primária]", que continuam valendo com o `dw-dialog-acoes` por dentro; `SendTemplateModal` é o único overlay da mesa que já usa `DialogFooter`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Dialog.jsx frontend/src/components/ui/Dialog.test.jsx
git commit -m "E2.2: rodape com erro fixo fora do corpo e nota que diz o que falta"
```

---

### Task 4: Confirmação estruturada e alerta que informa

**Files:**
- Rewrite: `frontend/src/components/ui/ConfirmDialog.jsx`
- Modify: `frontend/src/hooks/useConfirm.jsx`
- Rewrite: `frontend/src/components/ui/AlertDialog.jsx`
- Test: `frontend/src/hooks/useConfirm.test.jsx`, `frontend/src/components/ui/AlertDialog.test.jsx` (novo)

**Interfaces:**
- Consumes: `Dialog`, `DialogBody`, `DialogFooter` (Tasks 2-3), `Button`, `descreverErro` de `utils/errorMessages.js`.
- Produces: `confirm(message, { title, danger, confirmLabel, cancelLabel, acao, rotuloOcupado, erroPadrao })` — a API atual dos 14 chamadores não muda; `title` e `acao` são opcionais.

Regra E.1-11: título, o objeto, a consequência e ação assíncrona. Hoje `useConfirm` não repassa `title`, e sem título o `ConfirmDialog` usa a mensagem como nome **e** como descrição: o leitor de tela lê a frase duas vezes. Com `acao`, o diálogo fica aberto até a resposta, trava as saídas (ocupado) e mostra o erro no próprio diálogo — o "Finalizar sem motivo" de hoje fecha antes do resultado e engole a falha (`DashboardPage.jsx:91`).

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `frontend/src/hooks/useConfirm.test.jsx`:

```jsx
function DemoComAcao({ acao }) {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const ok = await confirm('Maria Souza sai da fila e o atendimento entra no Relatório como "Sem motivo".', {
            title: 'Finalizar sem motivo?',
            danger: true,
            confirmLabel: 'Finalizar',
            rotuloOcupado: 'Finalizando…',
            acao,
          });
          document.title = ok ? 'sim' : 'nao';
        }}
      >
        Abrir
      </button>
      {confirmDialog}
    </div>
  );
}

describe('confirmação estruturada', () => {
  test('com título: o nome é o título e a descrição é a mensagem (lida uma vez só)', async () => {
    render(<DemoComAcao acao={() => Promise.resolve()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialogo = screen.getByRole('alertdialog', { name: 'Finalizar sem motivo?' });
    expect(dialogo).toHaveAccessibleDescription('Maria Souza sai da fila e o atendimento entra no Relatório como "Sem motivo".');
  });

  test('sem título: a mensagem é o nome e não vira descrição', async () => {
    render(<Demo />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialogo = screen.getByRole('alertdialog', { name: 'Excluir o canal "X"?' });
    expect(dialogo).not.toHaveAttribute('aria-describedby');
  });

  test('com acao: fica aberto e ocupado até a resposta; no sucesso fecha e resolve true', async () => {
    let terminar;
    const acao = vi.fn(() => new Promise((resolve) => { terminar = resolve; }));
    render(<DemoComAcao acao={acao} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar' }));

    expect(acao).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Finalizando…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    terminar();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(document.title).toBe('sim');
  });

  test('com acao que falha: mostra o erro traduzido, continua aberto e deixa cancelar', async () => {
    // Frase real do backend ao fechar conversa que não é mais sua (traduzida em utils/errorMessages.js:33).
    const acao = vi.fn(() => Promise.reject({ status: 409, body: { error: 'Conversation is not currently assigned to you, or is closed' } }));
    render(<DemoComAcao acao={acao} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Este atendimento não está com você, ou já foi encerrado.');
    expect(screen.getByRole('button', { name: 'Finalizar' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(document.title).toBe('nao'));
  });
});
```

(No topo do arquivo, trocar o import para `import { describe, test, expect, vi } from 'vitest';`.)

Criar `frontend/src/components/ui/AlertDialog.test.jsx`:

```jsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertDialog } from './AlertDialog';

describe('AlertDialog', () => {
  test('o título diz o que falhou; a descrição é o porquê', () => {
    render(
      <AlertDialog
        open
        title="Não foi possível assumir o atendimento de Maria Souza"
        message="Este atendimento já foi assumido por outra pessoa."
        onClose={() => {}}
      />
    );
    const alerta = screen.getByRole('alertdialog', { name: 'Não foi possível assumir o atendimento de Maria Souza' });
    expect(alerta).toHaveAccessibleDescription('Este atendimento já foi assumido por outra pessoa.');
  });

  test('mensagem igual ao título não é repetida como descrição', () => {
    render(<AlertDialog open title="Não foi possível enviar a sugestão da IA." message="Não foi possível enviar a sugestão da IA." onClose={() => {}} />);
    expect(screen.getByRole('alertdialog')).not.toHaveAttribute('aria-describedby');
    expect(screen.getAllByText('Não foi possível enviar a sugestão da IA.')).toHaveLength(1);
  });

  test('o foco vai para "Entendi" e não há ×', () => {
    render(<AlertDialog open title="Aviso" message="Algo deu errado." onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Entendi' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
  });

  test('ESC fecha; clique no fundo não fecha', async () => {
    const onClose = vi.fn();
    render(<AlertDialog open title="Aviso" message="Algo deu errado." onClose={onClose} />);
    const fundo = screen.getByRole('alertdialog').parentElement;
    fireEvent(fundo, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 3, clientY: 3 }));
    fireEvent(fundo, new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 3, clientY: 3 }));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/hooks/useConfirm.test.jsx src/components/ui/AlertDialog.test.jsx`
Expected: FAIL nos 4 novos de confirmação (título ignorado, `acao` ignorada) e em 2 do alerta (descrição repetida; mensagem duplicada).

- [ ] **Step 3: Implementar**

`frontend/src/components/ui/ConfirmDialog.jsx` inteiro:

```jsx
import { useId } from 'react';
import { Dialog, DialogBody, DialogFooter } from './Dialog';
import { Button } from './Button';

// A API externa (useConfirm) não mudou. Por dentro, a confirmação segue a base
// (E.1-11): título, o objeto e a consequência no corpo, ações no rodapé, sem
// ícone e sem × — Cancelar já é a saída, e dois jeitos de dizer não criam
// dúvida. O perigo fica só no botão que executa a ação destrutiva.
// Sem título, a mensagem é o NOME do diálogo e não vira descrição: antes ela era
// as duas coisas e o leitor de tela lia a mesma frase duas vezes.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  ocupado = false,
  rotuloOcupado,
  erro = null,
  onConfirm,
  onCancel,
}) {
  const messageId = useId();

  if (!open) return null;

  return (
    <Dialog
      role="alertdialog"
      variant="confirm"
      size="max-w-[480px]"
      // Sem título, a própria mensagem é o título visível (e o nome acessível), e
      // não há descrição: antes ela era nome E descrição e era lida duas vezes.
      title={title || message}
      describedBy={title ? messageId : undefined}
      dismissible={false}
      ocupado={ocupado}
      onClose={onCancel}
      // Confirmação não fecha por clique no fundo: é decisão, não leitura.
      closeOnBackdrop={false}
    >
      {title ? (
        <DialogBody>
          <p id={messageId} className="text-corpo text-tinta-2">{message}</p>
        </DialogBody>
      ) : null}
      <DialogFooter erro={erro}>
        {/* O foco inicial é a saída segura, nunca a ação destrutiva. */}
        <Button data-autofocus="" variant="secondary" onClick={onCancel} disabled={ocupado}>
          {cancelLabel}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={ocupado}>
          {ocupado && rotuloOcupado ? rotuloOcupado : confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
```

`frontend/src/hooks/useConfirm.jsx` inteiro:

```jsx
import { useState, useCallback, useRef } from 'react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { descreverErro } from '../utils/errorMessages';

// confirm(message, opções) → Promise<boolean>. Opções: title, danger,
// confirmLabel, cancelLabel e — novidade da E2 — `acao`: uma função que devolve
// promessa. Com `acao`, o diálogo fica aberto e ocupado até a resposta; no
// sucesso fecha e resolve true; na falha mostra o erro traduzido e continua
// aberto (tentar de novo ou cancelar). Sem `acao`, o comportamento é o de
// sempre: resolve true no clique e quem chamou executa.
export function useConfirm() {
  const [state, setState] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((message, options = {}) => {
    // Se já há uma confirmação pendente, resolve false imediatamente sem alterar o diálogo aberto
    if (resolver.current) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      resolver.current = resolve;
      setState({ message, ...options, ocupado: false, erro: null });
    });
  }, []);

  function settle(value) {
    const resolve = resolver.current;
    resolver.current = null;
    setState(null);
    if (resolve) resolve(value);
  }

  async function confirmar() {
    if (!state || state.ocupado) return;
    if (!state.acao) {
      settle(true);
      return;
    }
    const { acao, erroPadrao } = state;
    setState((atual) => (atual ? { ...atual, ocupado: true, erro: null } : atual));
    try {
      await acao();
      settle(true);
    } catch (err) {
      setState((atual) =>
        atual ? { ...atual, ocupado: false, erro: descreverErro(err, erroPadrao || 'Não foi possível concluir. Tente de novo.') } : atual,
      );
    }
  }

  function cancelar() {
    if (state && state.ocupado) return;
    settle(false);
  }

  const confirmDialog = (
    <ConfirmDialog
      open={Boolean(state)}
      title={state?.title}
      message={state?.message}
      danger={state?.danger}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      ocupado={Boolean(state?.ocupado)}
      rotuloOcupado={state?.rotuloOcupado}
      erro={state?.erro}
      onConfirm={confirmar}
      onCancel={cancelar}
    />
  );

  return { confirm, confirmDialog };
}
```

`frontend/src/components/ui/AlertDialog.jsx` inteiro:

```jsx
import { useId } from 'react';
import { Dialog, DialogBody, DialogFooter } from './Dialog';
import { Button } from './Button';

// Substitui o `window.alert`: modal, exige reconhecimento explícito, sem × e sem
// fechar no fundo. O título diz O QUE falhou e COM QUEM ("Não foi possível
// assumir o atendimento de Maria"); a mensagem, o porquê — só quando diz algo
// além do título. Antes eram 3 faixas para uma frase: "Aviso" + ícone + texto.
export function AlertDialog({ open, title = 'Aviso', message, confirmLabel = 'Entendi', onClose }) {
  const messageId = useId();

  if (!open) return null;

  const temDescricao = Boolean(message) && message !== title;

  return (
    <Dialog
      role="alertdialog"
      variant="alert"
      size="max-w-[480px]"
      title={title}
      describedBy={temDescricao ? messageId : undefined}
      onClose={onClose}
      dismissible={false}
      closeOnBackdrop={false}
    >
      {temDescricao ? (
        <DialogBody>
          <p id={messageId} className="text-corpo text-tinta-2">{message}</p>
        </DialogBody>
      ) : null}
      <DialogFooter>
        <Button data-autofocus="" onClick={onClose}>{confirmLabel}</Button>
      </DialogFooter>
    </Dialog>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/hooks/useConfirm.test.jsx src/components/ui src/components/ConversationListItem.test.jsx src/components/CitiesAdminTab.test.jsx src/components/SectorsAdminTab.test.jsx src/components/ReasonsAdminTab.test.jsx src/components/TemplatesAdminTab.test.jsx src/components/TriageAdminTab.test.jsx src/components/PlansAdminTab.test.jsx`
Expected: PASS. Os chamadores de Configurações continuam achando o diálogo por `alertdialog` e os botões pelo nome. Se algum teste procurava o texto da mensagem com `getByText` e agora a acha também no título (sem título, a mensagem vira o título), o teste continua passando — é o mesmo texto uma vez só na tela.

- [ ] **Step 5: Provar por mutação**

Em `useConfirm.jsx`, trocar o `catch` por `catch (err) { settle(false); }`; rodar `npx vitest run src/hooks/useConfirm.test.jsx`.
Expected: FAIL em "com acao que falha…". Desfazer.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/ConfirmDialog.jsx frontend/src/components/ui/AlertDialog.jsx frontend/src/components/ui/AlertDialog.test.jsx frontend/src/hooks/useConfirm.jsx frontend/src/hooks/useConfirm.test.jsx
git commit -m "E2.2: confirmacao com titulo e acao assincrona; alerta que diz o que falhou"
```

---

### Task 5: Popover base

**Files:**
- Create: `frontend/src/components/ui/Popover.jsx`
- Test: `frontend/src/components/ui/Popover.test.jsx`

**Interfaces:**
- Consumes: `useCamadaLeve` (Task 1).
- Produces: `Popover({ aberto, aoFechar, ancoraRef, manterAbertoEm, role, ariaLabel, id, largura, className, children, ...rest })`. O chamador envolve gatilho + popover num contêiner `relative`; o popover abre para cima, alinhado à esquerda do contêiner.

Regra E.1-10: âncora no gatilho; altura limitada ao espaço livre (a 683×384, com o campo no teto, o popover de altura fixa passava do topo e a casca `h-dvh overflow-hidden` cortava — N7); clique fora = fora do popover e do gatilho; o papel é de cada popover. Sem portal: dentro de um diálogo, um portal no `<body>` ficaria fora da armadilha de Tab.

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/components/ui/Popover.test.jsx`:

```jsx
import { describe, test, expect, vi, afterEach } from 'vitest';
import { useRef, useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Popover } from './Popover';
import { altura } from './dialogStack';

function Composicao({ topoDoGatilho = 300, aoFechar: espiao = () => {} }) {
  const ancoraRef = useRef(null);
  const campoRef = useRef(null);
  const [aberto, setAberto] = useState(false);
  return (
    <div>
      <textarea ref={campoRef} aria-label="Mensagem" />
      <span className="relative">
        <button
          type="button"
          ref={(el) => {
            ancoraRef.current = el;
            if (el) el.getBoundingClientRect = () => ({ top: topoDoGatilho, bottom: topoDoGatilho + 36, left: 20, right: 56, width: 36, height: 36 });
          }}
          onClick={() => setAberto((v) => !v)}
        >
          Emojis
        </button>
        <Popover
          aberto={aberto}
          aoFechar={() => { setAberto(false); espiao(); }}
          ancoraRef={ancoraRef}
          manterAbertoEm={[campoRef]}
          ariaLabel="Emojis"
          largura={304}
        >
          <button type="button">😀</button>
        </Popover>
      </span>
      <button type="button">Fora</button>
    </div>
  );
}

// A limpeza do Testing Library roda DEPOIS deste afterEach: sem o cleanup()
// explícito, a pilha ainda teria as camadas do teste que acabou (e, se a
// asserção falhar, a limpeza nem roda e o DOM vaza para o teste seguinte).
afterEach(() => {
  cleanup();
  expect(altura()).toBe(0);
});

describe('Popover base', () => {
  test('abre com o papel e o nome de quem usa, e a largura pedida', async () => {
    render(<Composicao />);
    await userEvent.click(screen.getByRole('button', { name: 'Emojis' }));
    const popover = screen.getByRole('dialog', { name: 'Emojis' });
    expect(popover).not.toHaveAttribute('aria-modal');
    expect(popover.style.width).toBe('304px');
  });

  test('a altura máxima é o espaço livre acima do gatilho', async () => {
    render(<Composicao topoDoGatilho={150} />);
    await userEvent.click(screen.getByRole('button', { name: 'Emojis' }));
    expect(screen.getByRole('dialog', { name: 'Emojis' }).style.maxHeight).toBe('134px');
  });

  test('clique fora fecha; clique dentro, no gatilho e no campo liberado não fecham', async () => {
    const aoFechar = vi.fn();
    render(<Composicao aoFechar={aoFechar} />);
    await userEvent.click(screen.getByRole('button', { name: 'Emojis' }));

    fireEvent.pointerDown(screen.getByRole('button', { name: '😀' }));
    fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Mensagem' }));
    expect(aoFechar).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Fora' }));
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Emojis' })).not.toBeInTheDocument();
  });

  test('ESC fecha pelo caminho da pilha', async () => {
    render(<Composicao />);
    await userEvent.click(screen.getByRole('button', { name: 'Emojis' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Emojis' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ui/Popover.test.jsx`
Expected: FAIL — `Failed to resolve import "./Popover"`.

- [ ] **Step 3: Implementar**

`frontend/src/components/ui/Popover.jsx`:

```jsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCamadaLeve } from './camadaLeve';

// Base de todo popover (emojis, respostas rápidas, menu da conta — E.1-10).
// Mora DENTRO do contêiner `relative` do gatilho, sem portal: dentro de um
// diálogo, um portal no <body> ficaria fora da armadilha de Tab. Abre para
// cima, alinhado à esquerda do contêiner, e a altura máxima é o espaço livre
// ACIMA do gatilho — a 683×384 com o campo no teto, o popover de altura fixa
// passava do topo da janela e a casca cortava (N7). ESC pela camada leve.
// O papel (`dialog` não modal nos emojis, `menu` nas respostas) é de quem usa.
const MARGEM = 8;
const ALTURA_MINIMA = 120;

export function Popover({
  aberto,
  aoFechar,
  ancoraRef,
  manterAbertoEm = [],
  role = 'dialog',
  ariaLabel,
  id,
  largura,
  className = '',
  children,
  ...rest
}) {
  const painelRef = useRef(null);
  const aoFecharRef = useRef(aoFechar);
  aoFecharRef.current = aoFechar;
  const liberadosRef = useRef(manterAbertoEm);
  liberadosRef.current = manterAbertoEm;
  const [alturaMaxima, setAlturaMaxima] = useState(null);

  useCamadaLeve(aberto, aoFechar);

  useLayoutEffect(() => {
    if (!aberto) return undefined;
    function medir() {
      const ancora = ancoraRef && ancoraRef.current;
      if (!ancora) return;
      const topo = ancora.getBoundingClientRect().top;
      setAlturaMaxima(Math.max(ALTURA_MINIMA, Math.floor(topo - MARGEM * 2)));
    }
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [aberto, ancoraRef]);

  useEffect(() => {
    if (!aberto) return undefined;
    function aoDescer(evento) {
      const alvo = evento.target;
      const dentro = [painelRef, ancoraRef, ...liberadosRef.current].some((ref) => ref && ref.current && ref.current.contains(alvo));
      if (!dentro) aoFecharRef.current();
    }
    document.addEventListener('pointerdown', aoDescer);
    return () => document.removeEventListener('pointerdown', aoDescer);
  }, [aberto, ancoraRef]);

  if (!aberto) return null;

  return (
    <div
      ref={painelRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      className={`absolute bottom-full left-0 z-[var(--z-popover)] mb-2 overflow-y-auto rounded-ui-lg border border-linha bg-elevado p-1 text-tinta shadow-flutuante ${className}`}
      style={{ width: largura, maxHeight: alturaMaxima ?? undefined }}
      {...rest}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/ui/Popover.test.jsx`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Popover.jsx frontend/src/components/ui/Popover.test.jsx
git commit -m "E2.2: popover base ancorado no gatilho, com altura pelo espaco livre"
```

---

### Task 6: Lista de escolha única

**Files:**
- Create: `frontend/src/components/ui/ListaDeEscolha.jsx`
- Test: `frontend/src/components/ui/ListaDeEscolha.test.jsx`

**Interfaces:** Produces `ListaDeEscolha({ legenda, legendaVisivel, nome, opcoes, valor, aoEscolher, desabilitada, colunas, className })`; `opcao = { valor, titulo, detalhe?, icone?, fim?, desabilitada? }`.

Regra E.1-12: uma linha-rádio no lugar dos quatro padrões de hoje (botão `role=radio` no Transferir, rádio em cartão no Encerrar, botão `aria-pressed` no Enviar template, `<select>` no Iniciar). Rádio NATIVO escondido dentro do `<label>`: setas, Espaço e o anúncio vêm do navegador, e o foco inicial do `Dialog` já vai para o marcado (`Dialog.jsx:77-80`). Escolhida: `--color-selecionado` + barra de 3 px do acento + marca cheia (forma, P8). Duas colunas por `@container` (corpo ≥ 520 px), nunca por viewport.

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/components/ui/ListaDeEscolha.test.jsx`:

```jsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListaDeEscolha } from './ListaDeEscolha';

const OPCOES = [
  { valor: 'r1', titulo: 'Financeiro', detalhe: 'Boletos, pagamentos, faturas' },
  { valor: 'r2', titulo: 'Instalação' },
  { valor: 'r3', titulo: 'Mudança de endereço', desabilitada: true },
];

describe('ListaDeEscolha', () => {
  test('é um grupo de rádio nomeado pela legenda visível', () => {
    render(<ListaDeEscolha legenda="Motivo do contato" nome="motivo" opcoes={OPCOES} valor="" aoEscolher={() => {}} />);
    const grupo = screen.getByRole('radiogroup', { name: 'Motivo do contato' });
    expect(grupo).toBeInTheDocument();
    expect(screen.getByText('Motivo do contato')).toBeVisible();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  test('o detalhe descreve a opção; escolher chama aoEscolher com o valor', async () => {
    const aoEscolher = vi.fn();
    render(<ListaDeEscolha legenda="Motivo do contato" nome="motivo" opcoes={OPCOES} valor="" aoEscolher={aoEscolher} />);
    const financeiro = screen.getByRole('radio', { name: 'Financeiro' });
    expect(financeiro).toHaveAccessibleDescription('Boletos, pagamentos, faturas');
    await userEvent.click(screen.getByText('Instalação'));
    expect(aoEscolher).toHaveBeenCalledWith('r2');
  });

  test('a marcada é a do valor, e o estado vem do rádio (não só da cor)', () => {
    render(<ListaDeEscolha legenda="Motivo do contato" nome="motivo" opcoes={OPCOES} valor="r1" aoEscolher={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Financeiro' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Instalação' })).not.toBeChecked();
  });

  test('opção desabilitada e lista desabilitada (ocupada)', () => {
    const { rerender } = render(<ListaDeEscolha legenda="Motivo" nome="motivo" opcoes={OPCOES} valor="" aoEscolher={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Mudança de endereço' })).toBeDisabled();
    rerender(<ListaDeEscolha legenda="Motivo" nome="motivo" opcoes={OPCOES} valor="" aoEscolher={() => {}} desabilitada />);
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
  });

  test('legenda escondida continua nomeando o grupo', () => {
    render(<ListaDeEscolha legenda="Atendentes" legendaVisivel={false} nome="agente" opcoes={OPCOES} valor="" aoEscolher={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Atendentes' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ui/ListaDeEscolha.test.jsx`
Expected: FAIL — `Failed to resolve import "./ListaDeEscolha"`.

- [ ] **Step 3: Implementar**

`frontend/src/components/ui/ListaDeEscolha.jsx`:

```jsx
import { useId } from 'react';

// Escolha de 1 entre N (E.1-12) — a mesma linha para Transferir, Encerrar,
// Enviar template e Iniciar conversa. Rádio nativo escondido dentro do <label>:
// teclado e anúncio vêm do navegador. Escolhida = fundo selecionado + barra de
// 3 px do acento + marca cheia (forma, P8), nunca só a cor.
export function ListaDeEscolha({
  legenda,
  legendaVisivel = true,
  nome,
  opcoes,
  valor,
  aoEscolher,
  desabilitada = false,
  colunas = 1,
  className = '',
}) {
  const id = useId();
  const legendaId = `${id}-legenda`;
  const grade = colunas === 2 ? 'grid-cols-1 @min-[520px]:grid-cols-2' : 'grid-cols-1';

  return (
    <div className={`@container min-w-0 ${className}`}>
      <p id={legendaId} className={legendaVisivel ? 'mb-2 text-rotulo font-medium text-tinta-2' : 'sr-only'}>
        {legenda}
      </p>
      <div role="radiogroup" aria-labelledby={legendaId} className={`grid gap-1 ${grade}`}>
        {opcoes.map((opcao, indice) => {
          const marcada = opcao.valor === valor;
          const bloqueada = desabilitada || Boolean(opcao.desabilitada);
          const tituloId = `${id}-titulo-${indice}`;
          const detalheId = opcao.detalhe ? `${id}-detalhe-${indice}` : undefined;
          return (
            <label
              key={opcao.valor}
              className={`relative flex min-h-12 items-center gap-3 rounded-ui-md py-2 pl-4 pr-3 transition-colors duration-120 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring ${
                marcada ? 'bg-selecionado' : 'hover:bg-hover'
              } ${bloqueada ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            >
              {marcada ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent" /> : null}
              <input
                type="radio"
                name={nome}
                value={opcao.valor}
                checked={marcada}
                disabled={bloqueada}
                onChange={() => aoEscolher(opcao.valor)}
                // O nome é só o título: sem isto o rótulo inteiro (título +
                // detalhe) viraria o nome, e o detalhe seria lido duas vezes.
                aria-labelledby={tituloId}
                aria-describedby={detalheId}
                className="sr-only"
              />
              {opcao.icone ? <span aria-hidden="true" className="shrink-0 text-tinta-2">{opcao.icone}</span> : null}
              <span className="min-w-0 flex-1">
                <span id={tituloId} className="block truncate text-corpo font-semibold text-tinta">{opcao.titulo}</span>
                {opcao.detalhe ? (
                  <span id={detalheId} className="block truncate text-rotulo text-tinta-2">{opcao.detalhe}</span>
                ) : null}
              </span>
              {opcao.fim}
              <span
                aria-hidden="true"
                className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${marcada ? 'border-accent' : 'border-tinta-3'}`}
              >
                {marcada ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/ui/ListaDeEscolha.test.jsx`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/ListaDeEscolha.jsx frontend/src/components/ui/ListaDeEscolha.test.jsx
git commit -m "E2.2: lista de escolha unica (linha-radio) no lugar dos quatro padroes"
```

---

### Task 7: Faixa de aviso e exportação das primitivas

**Files:**
- Create: `frontend/src/components/ui/FaixaDeAviso.jsx`
- Test: `frontend/src/components/ui/FaixaDeAviso.test.jsx`
- Modify: `frontend/src/components/ui/index.js`

**Interfaces:**
- Consumes: `IconWarning` de `components/icons/IconesTrabalho.js`; `Link` de `react-router-dom`.
- Produces: `FaixaDeAviso({ texto, titulo, acao, className })`, `acao = { rotulo, para } | { rotulo, aoClicar }`.

Regra E.1-13: uma primitiva para "canal desconectado" (E2.3 Task 6), "Reconectando…" no celular (E2.3 Task 3) e a janela de 24 h (E2.4 Task 7). Ícone + texto + ação, uma linha, `--color-aviso`. Quem usa decide a região viva — a faixa não tem `role` próprio (um `role="status"` por tela, spec 9).

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/components/ui/FaixaDeAviso.test.jsx`:

```jsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { FaixaDeAviso } from './FaixaDeAviso';

describe('FaixaDeAviso', () => {
  test('texto com ação de navegação', () => {
    render(
      <MemoryRouter>
        <FaixaDeAviso texto="Canal Loja desconectado" acao={{ rotulo: 'Conectar', para: '/configuracoes/canais/ch1/conexao' }} />
      </MemoryRouter>
    );
    expect(screen.getByText('Canal Loja desconectado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Conectar' })).toHaveAttribute('href', '/configuracoes/canais/ch1/conexao');
  });

  test('ação de botão', async () => {
    const aoClicar = vi.fn();
    render(<FaixaDeAviso texto="Não foi possível conferir os canais" acao={{ rotulo: 'Tentar de novo', aoClicar }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });

  test('sem papel próprio de região viva, e o ícone é decorativo', () => {
    const { container } = render(<FaixaDeAviso texto="Reconectando…" />);
    expect(container.querySelector('[role="status"],[role="alert"],[aria-live]')).toBeNull();
    expect(container.querySelector('svg').closest('[aria-hidden="true"]')).not.toBeNull();
  });

  test('o texto inteiro fica no title quando a faixa trunca', () => {
    render(<FaixaDeAviso texto="2 canais sem conexão: Loja, Suporte" titulo="2 canais sem conexão: Loja, Suporte" />);
    expect(screen.getByText('2 canais sem conexão: Loja, Suporte')).toHaveAttribute('title', '2 canais sem conexão: Loja, Suporte');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ui/FaixaDeAviso.test.jsx`
Expected: FAIL — `Failed to resolve import "./FaixaDeAviso"`.

- [ ] **Step 3: Implementar**

`frontend/src/components/ui/FaixaDeAviso.jsx`:

```jsx
import { Link } from 'react-router-dom';
import { IconWarning } from '../icons/IconesTrabalho';

// Faixa de aviso de UMA linha (E.1-13): ícone + texto + ação opcional, na cor
// de aviso. Uma forma para canal desconectado, reconexão no celular e janela de
// 24 h. Não é região viva: quem usa decide onde a frase é anunciada (um
// role="status" por tela).
export function FaixaDeAviso({ texto, titulo, acao, className = '' }) {
  return (
    <div className={`flex min-h-10 items-center gap-2 bg-aviso-fundo px-4 py-2 text-rotulo text-tinta ${className}`}>
      <span aria-hidden="true" className="shrink-0 text-aviso">
        <IconWarning size={16} />
      </span>
      <p className="min-w-0 flex-1 truncate" title={titulo || undefined}>
        {texto}
      </p>
      {acao && acao.para ? (
        <Link to={acao.para} className="shrink-0 font-semibold text-aviso underline-offset-2 hover:underline">
          {acao.rotulo}
        </Link>
      ) : null}
      {acao && !acao.para ? (
        <button type="button" onClick={acao.aoClicar} className="shrink-0 font-semibold text-aviso underline-offset-2 hover:underline">
          {acao.rotulo}
        </button>
      ) : null}
    </div>
  );
}
```

Em `frontend/src/components/ui/index.js`, depois da linha de `Dialog`:

```js
export { Popover } from './Popover';
export { ListaDeEscolha } from './ListaDeEscolha';
export { FaixaDeAviso } from './FaixaDeAviso';
```

(`useCamadaLeve` **não** entra no barril: o barril é importado pelo `RotaLazy` no chunk de entrada, e o hook só serve à casca e à mesa.)

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/ui`
Expected: PASS em toda a pasta.

- [ ] **Step 5: O barril não pode puxar o `react-router-dom` nem ícones para o login**

`FaixaDeAviso` importa `Link` e `IconWarning`. O `RotaLazy` (chunk de entrada) importa `AsyncState` do barril `./ui`. Conferir que o build não passou a carregar os módulos novos na entrada:

Run: `cd frontend && npx vite build && node -e "const m=require('./dist/.vite/manifest.json');const e=Object.values(m).find(x=>x.isEntry);console.log(e.file, (e.imports||[]).join(' '))" && grep -c "Tentar de novo\|Conectar" dist/assets/index-*.js`
Expected: a entrada não importa chunk de ícones; o `grep` conta 0 ocorrências de texto da faixa no JS de entrada. Se contar mais que 0, trocar o `RotaLazy` para importar `AsyncState` direto de `./ui/AsyncState` (e não do barril) e medir de novo.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/FaixaDeAviso.jsx frontend/src/components/ui/FaixaDeAviso.test.jsx frontend/src/components/ui/index.js
git commit -m "E2.2: faixa de aviso de uma linha e exportacao das primitivas novas"
```

---

### Task 8: Fechamento do subplano

**Files:**
- Modify: `docs/superpowers/specs/2026-09-24-redesenho-registro-E2.md` (criado na E2.1 Task 7; aqui acrescenta a seção "E2.2")

- [ ] **Step 1: Suíte inteira**

Run: `cd frontend && npx vitest run`
Expected: tudo verde, exceto as falhas antigas que a E0 ainda não tiver corrigido (listar quais, pelo nome).

- [ ] **Step 2: Nenhum uso restante das props que saíram**

Run: `cd frontend && grep -rn "tone=\"perigo\"\|tone=\"info\"\|tone=\"ok\"\|dw-dialog-icon" src --include=*.jsx`
Expected: nenhuma ocorrência em diálogo (os `tone=` de `Card`, `Chip`, `Section` e `StatusBadge` são de outros componentes e ficam).

- [ ] **Step 3: Registro S × C**

Acrescentar ao registro da E2 a seção "E2.2 — base de diálogo", uma linha por mudança visível da base (o registro conta a base UMA vez, Apêndice E.5):

| Elemento | Antes | Depois | Classe |
|---|---|---|---|
| Ícone de cabeçalho | ladrilho 34 px em 5 tons | nenhum | S |
| × do diálogo com título | absoluto no canto, sobre o cabeçalho | no fluxo do cabeçalho | S |
| Margem lateral | 20/22/24 px | 24 px em cabeçalho, corpo e rodapé | S |
| Erro de formulário | fim do corpo rolável | região fixa acima das ações | S |
| Nota do rodapé | sempre a consequência | o que falta, enquanto a ação está desabilitada | S |
| Confirmação | sem título, ícone em coluna, botões dentro do corpo | título + objeto + consequência, rodapé | S |
| Alerta | 3 faixas ("Aviso" + ícone + frase) | 2 (título que diz o que falhou + rodapé) | S |
| Véu | translúcido + blur 6 px | `--color-veu` sólido | C |
| Painel | 96% + blur 28 px, raio 18 (22 no token morto), 3 sombras | `--color-elevado`, raio 16, 1 sombra | C |
| Título | 18 px Segoe UI | Sora 16/600 | C |

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-24-redesenho-registro-E2.md
git commit -m "E2.2: registro S x C da base de dialogo"
```
