# E2.3 — Moldura, menu e coluna da lista — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar a moldura flutuante, pôr o menu em trilho único de 64 px com o ativo por barra + fundo, dar à casca uma região viva única (conexão e transferências), reduzir a faixa do canal a uma linha, e redesenhar a coluna da lista — cabeçalho, busca, abas sublinhadas, item de 2 linhas por aba, marca de transferência, "Finalizar sem motivo" com um diálogo por lista, "Nossa equipe" dentro da coluna e a mesa vazia.

**Architecture:** A casca (`AppShell`) passa a prover duas coisas para a árvore: `RegiaoVivaProvider` (um `aria-live` sempre montado, `anunciar(frase)`) e `TransferenciasProvider` (ouve `conversation:assigned` com a chave `transferredBy`, guarda as marcas por conversa, toca o sino, anuncia). O menu é um componente só (`SideNav`) em utilitários de token, sem `side-nav.css`; a gaveta do celular continua com rótulos. A linha da lista (`ConversationListItem`, variantes `compact` e `rail`) é reescrita em 2 linhas com o conteúdo da linha 2 decidido pela aba, e o nome acessível completo por texto `sr-only`. As regras da lista em `dashboard.css` (fora de `@layer`, vencendo os utilitários) saem na mesma tarefa que redesenha o elemento.

**Tech Stack:** React 18.3, React Router 6, Tailwind 4.3 (tokens da E2.1), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-24-redesenho-simplicidade-design.md` (6.1, 6.2, 6.5, 9, 14.1 decisões 6 e 11), Apêndice B (B.1, B.2, B.5), Apêndice E (E.2: Nossa equipe, Finalizar sem motivo, Menu da conta, Aviso de transferência, Faixa do canal, Avisos de conexão) e anexo `grupo-C.md` (§1, §4–§7). Plano mestre: `docs/superpowers/plans/2026-09-24-redesenho-e2-mesa-de-atendimento.md`.

> **Provado antes da aprovação (24/09/2026):** as Tasks 1 a 9 e o que não depende do harness da Task 10 foram aplicadas a partir deste texto numa cópia descartável do frontend com a E2.1 (Tasks 1, 2, 3, 5 e 6) e a E2.2 aplicadas (`scratchpad/e23-prova/`, fora do repositório), por um auditor, e os pontos que mudaram o texto foram conferidos de novo contra o código. Resultado: suíte e build fecham no mesmo estado da linha de base da cópia. Erros do plano achados assim e corrigidos no texto: o "Finalizar" ficava sem confirmação da Task 5 à Task 7 (a confirmação agora sai do item só na Task 7); o `DashboardPage.test.jsx` deixava de carregar inteiro na Task 4; nada provava que a casca monta o provedor de transferências (teste novo, com mutação); a lista da equipe parava de se atualizar com a vista "Nossa equipe" aberta (os eventos subiram para a mesa) e o foco não voltava à barra; seis testes da `TeamPanel`, sete da dica do trilho, três da marca do menu e os de modo trilho/alternado que dependiam de classes ou do DOM antigos; o `require` dentro do `vi.mock`; o critério do build da casca; o esqueleto com contraste abaixo de 1,5:1 no código; a fixture da transferência (`conv-t`, não `c2`); o import de `useCompanyName` tirado cedo demais; o comentário aberto no corte de `dashboard.css`.

## Global Constraints

Valem as do plano mestre. As que mais pesam aqui:

- **Invariantes da seção 9 que esta etapa toca:** "Abrir menu" sempre alcançável (`AppShell.test.jsx` "mostra o botão de abrir o menu no mobile"); `conversationOpen` = "a conversa ocupa a tela inteira" (`DashboardPage.test.jsx` 1280/400); ordem de sacrifício e limiares do `useWorkspaceLayout` (os 8 casos de `useWorkspaceLayout.test.js` não mudam); `aria-live` ≠ `role="status"`, um só `role="status"` por tela; ação da linha e ação do botão são irmãos.
- **Ganhos protegidos:** o memo da lista (guarda `src/guardas/memoLista.test.jsx` da E0, que conta renders pelo `ContactAvatar` — a linha nova mantém o `ContactAvatar`); o `AgentsContext` (os 8 testes de `AgentsContext.test.jsx` e os gatilhos de `refresh` da equipe).
- **Nenhuma funcionalidade some:** cada item que sai da vista tem destino no Apêndice B (B.1, B.2, B.5). Cidade e setor continuam achados pela busca e pelo nome acessível.
- **A Supervisão usa a mesma linha compacta** (`SupervisionPage.jsx:150`, com cidade, setor e responsável já anulados): a linha nova vale lá também, sem perder dado. O restyle da Supervisão é da E5.
- Toda regra de `dashboard.css`/`side-nav.css` que alcança um elemento redesenhado sai na mesma tarefa (CSS sem `@layer` vence o utilitário).

## Review Focus

- **Transferência com a mesa fechada.** O atendente está em Relatórios quando recebe uma transferência: o sino toca, a região viva anuncia, e ao voltar à mesa a conversa aparece marcada. Teste na Task 4 (o provedor mora na casca).
- **Transferência sem nome.** O backend manda `transferredBy: null` quando não acha o nome (`src/api/conversations.routes.js:518-521`): ainda assim é transferência — marca "Transferido para você". Hoje é descartada (ATD-AVT-07). Teste na Task 4.
- **Busca sem resultado.** Hoje diz "Nenhum atendimento em espera." (S4): o atendente conclui que a fila está vazia. Passa a "Nada encontrado para “termo”" + "Limpar busca". Teste na Task 6.
- **Item que sai da fila com a confirmação aberta.** Com o diálogo no dono da lista, a confirmação não some; o backend devolve 409 e o diálogo mostra a frase traduzida. Teste na Task 7.
- **ESC com a gaveta e um diálogo abertos.** "Meu perfil" aberto a partir da gaveta: o 1º ESC fecha o perfil, o 2º a gaveta (camada leve). Teste na Task 2.

---

## Arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `frontend/src/contexts/RegiaoVivaContext.jsx` (+ `.test.jsx`) | Criar | região viva única da casca |
| `frontend/src/hooks/useEstadoDaConexao.js` | Criar | `'ok' \| 'caiu' \| 'voltou'` (3 s) |
| `frontend/src/components/FaixaDaConexao.jsx` | Criar | anúncios + faixa do celular |
| `frontend/src/components/AppShell.jsx` | Modificar | sem moldura, halos e toast; provedores |
| `frontend/src/components/AppShell.connection.test.jsx` | Reescrever | queda/volta pela região viva e pela faixa do celular |
| `frontend/src/components/SideNav.jsx` | Reescrever | trilho único |
| `frontend/src/components/side-nav.css` | Apagar | |
| `frontend/src/components/DicaFlutuante.jsx` | Modificar | estilo em tokens (sai `.chat-rail-tip` de `dashboard.css`) |
| `frontend/src/hooks/useNavCollapsed.js` (+ teste) | Apagar | |
| `frontend/src/hooks/useWorkspaceLayout.js:39,49-50` | Modificar | palpite sem moldura (65) |
| `frontend/src/utils/papeis.js` | Criar | rótulo do papel (sai de `AgentsAdminTab`) |
| `frontend/src/components/ChannelStatusBanner.jsx` (+ teste) | Reescrever | uma linha |
| `frontend/src/contexts/TransferenciasContext.jsx` (+ `.test.jsx`) | Criar | marcas de transferência |
| `frontend/src/components/TransferNotice.jsx`, `hooks/useTransferNotice.js` (+ testes) | Apagar | |
| `frontend/src/components/ConversationListItem.jsx` | Modificar | variantes `compact` e `rail` |
| `frontend/src/components/ConversationListItem.linha.test.jsx` | Criar | a linha da mesa (hoje sem teste) |
| `frontend/src/components/QueueList.jsx`, `MyConversationsList.jsx` | Modificar | `aba`, marcas, estados |
| `frontend/src/components/ui/Tabs.jsx` | Modificar | visual `sublinhado`; sai `segmented` |
| `frontend/src/pages/DashboardPage.jsx` | Modificar | coluna, marcas, confirmação, equipe, mesa vazia |
| `frontend/src/pages/dashboard.css` | Modificar | saem as regras da lista, do trilho e da dica |
| `frontend/src/pages/SupervisionPage.jsx` | Modificar | confirmação do "Finalizar" no dono da lista |
| `frontend/src/components/TeamPanel.jsx` | Reescrever | barra de 44 px |
| `frontend/src/components/NossaEquipe.jsx` (+ `.test.jsx`) | Criar | vista na coluna |
| `frontend/src/components/TeamModal.jsx` | Apagar | |
| `frontend/src/components/MesaVazia.jsx` | Criar | mesa vazia + confirmação de sucesso |

## Interfaces

**Consome:** tokens e ícones (E2.1); `useCamadaLeve`, `Popover`, `FaixaDeAviso`, `useConfirm({ acao })` (E2.2).

**Produz:**

```js
// contexts/RegiaoVivaContext.jsx
export function RegiaoVivaProvider({ children })
export function useAnunciar(): (frase: string) => void   // sem provedor: função que não faz nada

// hooks/useEstadoDaConexao.js
export const TEMPO_DO_CONECTADO_MS = 3000
export function useEstadoDaConexao(): 'ok' | 'caiu' | 'voltou'

// contexts/TransferenciasContext.jsx
export function TransferenciasProvider({ children })
export function useTransferencias(): { marcas: Map<conversationId, string|null>, limpar(conversationId): void }
//   valor null = transferência sem nome ("Transferido para você")

// components/ConversationListItem.jsx — props da variante compact:
//   conversation, onSelect(id), onQuickClose?(id, nome), unread: bool, selected: bool,
//   aba: 'atendimento' | 'espera' | 'automacao' (padrão 'atendimento'),
//   transferidoPor: string | null  ('' = sem nome; null = sem marca), showArrivalTime: bool
// Ganchos estáveis para o harness (classes sem CSS): linha-avatar, linha-nome, linha-hora, linha-previa, linha-nao-lida

// components/MesaVazia.jsx
export default function MesaVazia({ aviso: string | null })

// pages/DashboardPage.jsx (interno, usado pela E2.4/E2.5)
//   avisarNaMesa(frase) — mostra a confirmação de sucesso na mesa vazia por 6 s
//   passado à ConversationView como `onEncerrado(frase)` e ao TransferModal como `onTransferido(frase)`

// utils/papeis.js
export const ROTULO_DO_PAPEL = { admin: 'Administrador', manager: 'Gerente', agent: 'Atendente' }
```

---

### Task 1: Casca sem moldura, região viva e conexão

**Files:**
- Create: `frontend/src/contexts/RegiaoVivaContext.jsx`, `frontend/src/contexts/RegiaoVivaContext.test.jsx`
- Create: `frontend/src/hooks/useEstadoDaConexao.js`
- Create: `frontend/src/components/FaixaDaConexao.jsx`
- Modify: `frontend/src/components/AppShell.jsx` (inteiro), `frontend/src/App.jsx:86-94,144` (`Shell` sem `dense`)
- Rewrite: `frontend/src/components/AppShell.connection.test.jsx`

Spec 6.1 (sem moldura: saem `p-3`, `gap-3`, cantos e halos, `AppShell.jsx:90-92`) e anexo C §7: hoje há dois indicadores para a mesma queda (faixa flutuante de 3 s no canto, sobre a conversa, e o indicador do menu), até três `role="status"` juntos, e no celular a queda some em 3 s sem deixar sinal. Passa a: uma região viva na casca (`aria-live`, sem `role`, sempre montada) que recebe as duas frases; no celular, `FaixaDeAviso` de uma linha no topo do conteúdo **enquanto** reconecta e "Conectado" por 3 s; no desktop o indicador fica no trilho (Task 2).

- [ ] **Step 1: Escrever os testes que falham**

`frontend/src/contexts/RegiaoVivaContext.test.jsx`:

```jsx
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { RegiaoVivaProvider, useAnunciar } from './RegiaoVivaContext';

function Anunciador({ frase }) {
  const anunciar = useAnunciar();
  return <button type="button" onClick={() => anunciar(frase)}>anunciar</button>;
}

afterEach(() => vi.useRealTimers());

describe('região viva da casca', () => {
  test('uma região aria-live sem role, sempre montada, recebe a frase', () => {
    vi.useFakeTimers();
    const { container } = render(<RegiaoVivaProvider><Anunciador frase="Conexão restabelecida." /></RegiaoVivaProvider>);
    const regiao = container.querySelector('[data-regiao-viva]');
    expect(regiao).toHaveAttribute('aria-live', 'polite');
    expect(regiao).not.toHaveAttribute('role');
    expect(regiao).toHaveTextContent('');

    act(() => screen.getByRole('button').click());
    act(() => vi.advanceTimersByTime(60));
    expect(regiao).toHaveTextContent('Conexão restabelecida.');
  });

  test('a mesma frase duas vezes é anunciada de novo (esvazia antes)', () => {
    vi.useFakeTimers();
    const { container } = render(<RegiaoVivaProvider><Anunciador frase="Transferido." /></RegiaoVivaProvider>);
    const regiao = container.querySelector('[data-regiao-viva]');
    act(() => screen.getByRole('button').click());
    act(() => vi.advanceTimersByTime(60));
    act(() => screen.getByRole('button').click());
    expect(regiao).toHaveTextContent('');
    act(() => vi.advanceTimersByTime(60));
    expect(regiao).toHaveTextContent('Transferido.');
  });

  test('sem provedor, anunciar não quebra (componente testado sozinho)', () => {
    render(<Anunciador frase="x" />);
    expect(() => screen.getByRole('button').click()).not.toThrow();
  });
});
```

Substituir `frontend/src/components/AppShell.connection.test.jsx` inteiro:

```jsx
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppShell from './AppShell';
import { useSocketConnection } from '../contexts/SocketContext';

vi.mock('../contexts/SocketContext', async () => {
  const real = await vi.importActual('../contexts/SocketContext');
  return { ...real, useSocketConnection: vi.fn(), useSocket: () => null };
});
vi.mock('./SideNav', () => ({ default: () => <nav data-testid="sidenav" /> }));
vi.mock('./ProfileModal', () => ({ default: () => null }));

const renderShell = () => render(<MemoryRouter><AppShell /></MemoryRouter>);
const regiao = () => document.querySelector('[data-regiao-viva]');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe('conexão na casca', () => {
  test('na queda: a região viva anuncia e a faixa do celular fica enquanto reconecta (sem prazo)', () => {
    useSocketConnection.mockReturnValue('connected');
    const { rerender } = renderShell();
    expect(screen.queryByText(/reconectando/i)).not.toBeInTheDocument();

    useSocketConnection.mockReturnValue('reconnecting');
    rerender(<MemoryRouter><AppShell /></MemoryRouter>);
    act(() => vi.advanceTimersByTime(60));
    expect(regiao()).toHaveTextContent('Reconectando… as mensagens novas podem demorar a aparecer.');
    expect(screen.getByTestId('faixa-conexao')).toHaveTextContent(/reconectando/i);

    act(() => vi.advanceTimersByTime(30000));
    expect(screen.getByTestId('faixa-conexao')).toHaveTextContent(/reconectando/i);
  });

  test('na volta: "Conexão restabelecida." na região viva e "Conectado" por 3 s', () => {
    useSocketConnection.mockReturnValue('reconnecting');
    const { rerender } = renderShell();

    useSocketConnection.mockReturnValue('connected');
    rerender(<MemoryRouter><AppShell /></MemoryRouter>);
    act(() => vi.advanceTimersByTime(60));
    expect(regiao()).toHaveTextContent('Conexão restabelecida.');
    expect(screen.getByTestId('faixa-conexao')).toHaveTextContent('Conectado');

    act(() => vi.advanceTimersByTime(3100));
    expect(screen.queryByTestId('faixa-conexao')).not.toBeInTheDocument();
  });

  test('conexão saudável desde o início: nenhuma faixa, nenhum anúncio, nenhum role="status"', () => {
    useSocketConnection.mockReturnValue('connected');
    renderShell();
    expect(screen.queryByTestId('faixa-conexao')).not.toBeInTheDocument();
    expect(regiao()).toHaveTextContent('');
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  test('sem moldura flutuante: a raiz não tem halos nem respiro em volta das colunas', () => {
    useSocketConnection.mockReturnValue('connected');
    const { container } = renderShell();
    expect(container.querySelector('[class*="blur-[150px]"]')).toBeNull();
    expect(container.innerHTML).not.toMatch(/md:p-3|gap-3 p-0/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/contexts/RegiaoVivaContext.test.jsx src/components/AppShell.connection.test.jsx`
Expected: FAIL (módulo inexistente; faixa sem `data-testid`; toast some em 3 s).

- [ ] **Step 3: Implementar**

`frontend/src/contexts/RegiaoVivaContext.jsx`:

```jsx
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Uma região viva só, na casca (spec 9: um role="status" por tela; aria-live
// sem role). Recebe as frases que antes cada aviso anunciava por conta própria,
// em lugares diferentes e com role="status" montado junto com o texto (o
// anúncio se perdia): queda e volta da conexão, transferência recebida, canal
// desconectado. Sem provedor (componente testado sozinho), anunciar não faz nada.
const AnunciarContext = createContext(() => {});

export function RegiaoVivaProvider({ children }) {
  const [frase, setFrase] = useState('');
  const temporizador = useRef(null);

  const anunciar = useCallback((texto) => {
    // Esvazia e escreve no quadro seguinte: a mesma frase repetida (duas
    // transferências do mesmo cliente) também é anunciada.
    setFrase('');
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setFrase(texto), 50);
  }, []);

  useEffect(() => () => clearTimeout(temporizador.current), []);

  return (
    <AnunciarContext.Provider value={anunciar}>
      {children}
      <p aria-live="polite" className="sr-only" data-regiao-viva="">
        {frase}
      </p>
    </AnunciarContext.Provider>
  );
}

export function useAnunciar() {
  return useContext(AnunciarContext);
}
```

`frontend/src/hooks/useEstadoDaConexao.js`:

```js
import { useEffect, useRef, useState } from 'react';
import { useSocketConnection } from '../contexts/SocketContext';

export const TEMPO_DO_CONECTADO_MS = 3000;

// 'caiu' enquanto o socket reconecta (sem prazo: é estado, não alerta);
// 'voltou' por 3 s depois que a conexão volta; 'ok' no resto do tempo.
export function useEstadoDaConexao() {
  const estado = useSocketConnection();
  const anteriorRef = useRef(estado);
  const [voltou, setVoltou] = useState(false);

  useEffect(() => {
    const anterior = anteriorRef.current;
    anteriorRef.current = estado;
    if (estado === 'reconnecting') {
      setVoltou(false);
      return undefined;
    }
    if (estado === 'connected' && anterior === 'reconnecting') {
      setVoltou(true);
      const t = setTimeout(() => setVoltou(false), TEMPO_DO_CONECTADO_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [estado]);

  if (estado === 'reconnecting') return 'caiu';
  return voltou ? 'voltou' : 'ok';
}
```

`frontend/src/components/FaixaDaConexao.jsx`:

```jsx
import { useEffect } from 'react';
import { useEstadoDaConexao } from '../hooks/useEstadoDaConexao';
import { useAnunciar } from '../contexts/RegiaoVivaContext';
import { FaixaDeAviso } from './ui/FaixaDeAviso';
import { IconCheck } from './icons/IconesTrabalho';

const FRASE_QUEDA = 'Reconectando… as mensagens novas podem demorar a aparecer.';
const FRASE_VOLTA = 'Conexão restabelecida.';

// Dono do anúncio da conexão (região viva) e, no celular, da faixa de uma
// linha no topo do conteúdo. No desktop o sinal visível é o indicador do trilho
// (SideNav). A faixa fica ENQUANTO reconecta: antes o celular perdia todo sinal
// da queda depois de 3 s.
function FaixaDaConexao() {
  const fase = useEstadoDaConexao();
  const anunciar = useAnunciar();

  useEffect(() => {
    if (fase === 'caiu') anunciar(FRASE_QUEDA);
    if (fase === 'voltou') anunciar(FRASE_VOLTA);
  }, [fase, anunciar]);

  if (fase === 'ok') return null;
  return (
    <div data-testid="faixa-conexao" className="md:hidden">
      {fase === 'caiu' ? (
        <FaixaDeAviso texto="Reconectando… as mensagens novas podem demorar a aparecer." />
      ) : (
        <div className="flex min-h-10 items-center gap-2 bg-painel px-4 py-2 text-rotulo text-tinta">
          <span aria-hidden="true" className="text-tinta-2"><IconCheck size={16} /></span>
          Conectado
        </div>
      )}
    </div>
  );
}

export default FaixaDaConexao;
```

`frontend/src/components/AppShell.jsx` inteiro:

```jsx
import { useState, useCallback, useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import SideNav from './SideNav';
import ProfileModal from './ProfileModal';
import FaixaDaConexao from './FaixaDaConexao';
import { RegiaoVivaProvider } from '../contexts/RegiaoVivaContext';
import { TransferenciasProvider } from '../contexts/TransferenciasContext';
import { IconChats } from './icons/IconesTrabalho';

// Casca de todas as páginas autenticadas. Sem moldura flutuante (spec 6.1):
// menu, lista e conversa encostam, separados por linha de 1 px — eram 12 px de
// respiro, 12 de vão e halos borrados atrás de tudo.
// `conversationOpen` vem do Atendimento e significa "a conversa OCUPA A TELA
// INTEIRA" — não apenas "existe conversa selecionada". Só nesse caso o botão de
// abrir o menu pode sumir.
function AppShell() {
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [profileVersion, setProfileVersion] = useState(0);

  const openProfile = useCallback(() => setProfileOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  // A gaveta do menu não é um diálogo, então ninguém guardava quem a abriu: ao
  // fechar com ESC o foco ficava largado no conteúdo. O botão é desta casca,
  // logo é ela que o devolve.
  const gatilhoDoMenu = useRef(null);
  const estavaAberta = useRef(false);
  useEffect(() => {
    if (mobileNavOpen) {
      estavaAberta.current = true;
      return;
    }
    if (!estavaAberta.current) return;
    estavaAberta.current = false;
    const botao = gatilhoDoMenu.current;
    if (botao && document.contains(botao)) botao.focus();
  }, [mobileNavOpen]);

  return (
    <RegiaoVivaProvider>
      <TransferenciasProvider>
        <div className="chat-theme flex h-dvh overflow-hidden bg-fundo font-sans text-tinta">
          <SideNav onProfileClick={openProfile} mobileOpen={mobileNavOpen} onMobileClose={closeMobileNav} />
          {/* `inert` no conteúdo enquanto a gaveta está aberta: o Tab não sai da
              gaveta — a mesma técnica que a pilha de diálogos usa no nível de baixo. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={mobileNavOpen ? '' : undefined}>
            <FaixaDaConexao />
            <button
              ref={gatilhoDoMenu}
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Abrir menu"
              aria-controls="sidenav"
              aria-expanded={mobileNavOpen}
              data-testid="open-mobile-nav"
              className={`m-2 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-painel text-tinta transition-colors duration-120 hover:bg-hover ${conversationOpen ? 'hidden' : 'md:hidden'}`}
            >
              <IconChats size={22} />
            </button>
            <Outlet context={{ profileVersion, setConversationOpen }} />
          </div>
          {profileOpen && (
            <ProfileModal onClose={() => setProfileOpen(false)} onProfileUpdated={() => setProfileVersion((v) => v + 1)} />
          )}
        </div>
      </TransferenciasProvider>
    </RegiaoVivaProvider>
  );
}

export default AppShell;
```

(`openProfile` e `closeMobileNav` saem do contexto do `Outlet`: não tinham consumidor — dossiê de casca, surpresa 4. Conferir com `grep -rn "useOutletContext" frontend/src` que só a `DashboardPage` e as abas de canais o leem, e que nenhuma lê esses dois campos. `test-utils/renderInShell.jsx` replica os quatro: tirar os dois de lá também.)

`App.jsx`: em `Shell` (`:86-94`), tirar o parâmetro `dense` e o `dense={dense}` repassado; na rota da `:144`, `<Shell dense />` vira `<Shell />`.

Enquanto a Task 4 não existir, o import de `TransferenciasProvider` quebra: **a Task 4 é pré-requisito do Step 4 desta**. Se as tarefas forem executadas na ordem, criar nesta tarefa um `contexts/TransferenciasContext.jsx` mínimo — `export function TransferenciasProvider({ children }) { return children; }` e `export function useTransferencias() { return { marcas: new Map(), limpar: () => {} }; }` — que a Task 4 substitui.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/contexts/RegiaoVivaContext.test.jsx src/components/AppShell.connection.test.jsx src/components/AppShell.test.jsx`
Expected: PASS — inclui "a raiz usa h-dvh" (o primeiro nó do contêiner continua sendo a `div` da casca: os provedores não desenham nada antes dela) e "mostra o botão de abrir o menu no mobile".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/contexts/RegiaoVivaContext.jsx frontend/src/contexts/RegiaoVivaContext.test.jsx frontend/src/hooks/useEstadoDaConexao.js frontend/src/components/FaixaDaConexao.jsx frontend/src/components/AppShell.jsx frontend/src/components/AppShell.connection.test.jsx frontend/src/App.jsx frontend/src/test-utils/renderInShell.jsx frontend/src/contexts/TransferenciasContext.jsx
git commit -m "E2.3: casca sem moldura, regiao viva unica e conexao sem toast"
```

---

### Task 2: Menu em trilho único de 64 px

**Files:**
- Rewrite: `frontend/src/components/SideNav.jsx`
- Delete: `frontend/src/components/side-nav.css`, `frontend/src/hooks/useNavCollapsed.js`, `frontend/src/hooks/useNavCollapsed.test.jsx`
- Create: `frontend/src/utils/papeis.js`; Modify: `frontend/src/components/AgentsAdminTab.jsx:14` (usa `ROTULO_DO_PAPEL`)
- Modify: `frontend/src/components/DicaFlutuante.jsx:60-68`; `frontend/src/pages/dashboard.css:273-278` (sai `.chat-rail-tip`); `frontend/src/components/ConversationListItem.test.jsx:740-792` (`.chat-rail-tip` → `[data-dica]`)
- Modify: `frontend/src/hooks/useWorkspaceLayout.js:39` (`MENU_E_RESPIROS = 65`) e o comentário `:49-50`; `frontend/src/pages/DashboardPage.jsx:58-59` (comentário "196px para 64px")
- Modify tests: `frontend/src/components/SideNav.test.jsx`, `SideNav.branding.test.jsx`, `SideNav.connection.test.jsx`

Decisão 6 (14.1): trilho único de 64 px em qualquer rota no desktop, sem modo expandido; gaveta de 216 px com rótulos no celular. Decisão 3: ativo por barra de 3 px + fundo + ícone no acento. Ordem (spec 6.1): marca 32 px, Atendimento, Encerrados (só atendente), Supervisão, Campanhas, Relatórios; base: Configurações, Som da fila, indicador de conexão, Conta. Rótulo na `DicaFlutuante` (sai o `title` nativo; o toque revela pela gaveta) e no nome acessível. ESC da gaveta e do menu da conta pela camada leve (saem os dois ouvintes do `document`, `SideNav.jsx:91-93` e `:103-107`). Encerrados passa a `lazy` (spec 7(b)): sai a `ConversationView` de 131 KB do trecho da casca.

- [ ] **Step 1: Atualizar os testes que travam o comportamento antigo e escrever os novos**

Em `frontend/src/components/SideNav.test.jsx`:

- Apagar "recolher esconde os nomes e mantém o rótulo acessível" e "chat defaults to compact while administration defaults to expanded".
- Acrescentar:

```jsx
describe('trilho único (decisão 6)', () => {
  test('mesmo trilho em / e em /relatorios: sem botão de recolher, sem título de grupo, nada no localStorage', () => {
    const admin = { id: 'a1', name: 'Ana', role: 'admin' };
    for (const rota of ['/', '/relatorios']) {
      const { unmount } = renderNav(admin, rota);
      expect(screen.queryByRole('button', { name: /recolher menu|expandir menu/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('group', { name: /trabalho|acompanhamento|administração/i })).not.toBeInTheDocument();
      unmount();
    }
    expect(Object.keys(localStorage).filter((k) => k.startsWith('dw_nav_collapsed'))).toEqual([]);
  });

  test('ordem: marca, destinos e, na base, Configurações, som e conta', () => {
    renderNav({ id: 'a1', name: 'Ana', role: 'admin' }, '/');
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    const nomes = within(nav).getAllByRole('link').map((l) => l.getAttribute('aria-label'));
    expect(nomes).toEqual(['Atendimento', 'Supervisão', 'Campanhas', 'Relatórios', 'Configurações']);
  });

  test('atendente: Encerrados logo depois de Atendimento', () => {
    renderNav({ id: 'a2', name: 'Bia', role: 'agent' }, '/');
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    const ordem = within(nav).getAllByRole('link').concat(within(nav).getAllByRole('button', { name: /encerrados/i }))
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map((el) => el.getAttribute('aria-label'));
    expect(ordem.slice(0, 2)).toEqual(['Atendimento', 'Atendimentos encerrados']);
  });

  test('o item ativo tem aria-current e a barra de 3 px (forma, não só cor)', () => {
    renderNav({ id: 'a1', name: 'Ana', role: 'admin' }, '/relatorios');
    const ativo = screen.getByRole('link', { name: 'Relatórios' });
    expect(ativo).toHaveAttribute('aria-current', 'page');
    expect(ativo.querySelector('[data-barra-ativo]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Atendimento' }).querySelector('[data-barra-ativo]')).toBeNull();
  });

  test('o rótulo aparece na dica ao focar o item', async () => {
    renderNav({ id: 'a1', name: 'Ana', role: 'admin' }, '/');
    screen.getByRole('link', { name: 'Campanhas' }).focus();
    expect(await screen.findByText('Campanhas', { selector: '[data-dica]' })).toBeInTheDocument();
  });

  test('menu da conta: cabeçalho com nome e papel, divisória, ESC fecha e devolve o foco ao avatar', async () => {
    renderNav({ id: 'a1', name: 'Ana Souza', role: 'manager' }, '/');
    const gatilho = screen.getByRole('button', { name: 'Conta: Ana Souza' });
    await userEvent.click(gatilho);
    const menu = screen.getByRole('dialog', { name: 'Conta' });
    expect(within(menu).getByText('Ana Souza')).toBeInTheDocument();
    expect(within(menu).getByText('Gerente')).toBeInTheDocument();
    expect(within(menu).getByRole('separator')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Conta' })).not.toBeInTheDocument();
    expect(gatilho).toHaveFocus();
  });

  test('gaveta: com um diálogo aberto por cima, o 1º ESC fecha o diálogo e o 2º a gaveta', async () => {
    const onMobileClose = vi.fn();
    renderNav({ id: 'a2', name: 'Bia', role: 'agent' }, '/', { mobileOpen: true, onMobileClose });
    await userEvent.click(screen.getByRole('button', { name: /atendimentos encerrados/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onMobileClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onMobileClose).toHaveBeenCalledTimes(1);
  });
});
```

(O mock de `./ClosedConversationsModal` no topo do arquivo passa a devolver um diálogo de verdade para a pilha: `import { Dialog } from './ui/Dialog';` no topo do teste e, na fábrica, `default: ({ onClose }) => <Dialog title="Encerrados" onClose={onClose}>encerrados</Dialog>`. Com `require` dentro da fábrica o Vitest não acha o módulo — `Error: Cannot find module './ui/Dialog'` —; o import no topo funciona sem `vi.hoisted`.)

Os testes existentes que mudam de alvo, sem mudar o que provam:
- "atendente vê Atendimento e Relatórios…", "gerente vê Campanhas…", "gerente vê Supervisão e Configurações…", "marca o item ativo pela rota", "em modo painel, escolher um item fecha o painel", "em modo painel, Esc fecha", "mostra a logo oficial e o botão de som", "clica em "Meu perfil" chama onProfileClick", "com o som mutado…", "clicar no botão de som…", "account exposes logout and closes with Escape" — continuam.
- Os 4 de "gaveta acima do véu" localizam a gaveta por `.worknav.is-mobile-open`: trocar o seletor por `screen.getByRole('navigation', { name: 'Navegação principal' })` e manter as asserções (véu um degrau abaixo, clique no véu fecha, clique dentro não fecha, sem gaveta sem véu). No 4º, `expect(container.querySelector('.worknav.is-mobile-open')).toBeNull()` vira `expect(screen.getByRole('navigation', { name: 'Navegação principal' })).not.toHaveAttribute('data-gaveta')` — o `<nav>` ganha `data-gaveta` quando a gaveta está aberta (abaixo); sem isso a asserção antiga passaria sempre, sem provar nada.

Em `SideNav.branding.test.jsx`, "o nome da empresa aparece no menu expandido e no tooltip" passa a:

```jsx
  test('o nome da empresa fica no title da marca; visível só na gaveta', () => {
    useCompanyName.mockReturnValue({ name: 'Net Fibra Ltda', status: 'ready' });
    renderNav('/relatorios');
    const marca = screen.getByTitle('Net Fibra Ltda');
    expect(marca).toBeInTheDocument();
    expect(screen.queryByText('Net Fibra Ltda', { selector: '[data-nome-da-empresa]' })).not.toBeInTheDocument();
  });

  test('na gaveta o nome da empresa aparece ao lado da marca', () => {
    useCompanyName.mockReturnValue({ name: 'Net Fibra Ltda', status: 'ready' });
    renderNav('/relatorios', { mobileOpen: true });
    expect(screen.getByText('Net Fibra Ltda', { selector: '[data-nome-da-empresa]' })).toBeInTheDocument();
  });
```

(Se `renderNav` desse arquivo não aceita props, acrescentar o segundo parâmetro `props = {}` repassado ao `SideNav`. Os dois testes chamam `useCompanyName.mockReturnValue` eles mesmos: sem isso passam só na ordem do arquivo — isolados, `TypeError: Cannot destructure property 'name' of 'useCompanyName(...)'`.)

Três testes do mesmo arquivo liam classes que saem com o menu antigo: `.worknav-monogram` → `[data-monograma]` (nos dois testes do monograma); `.worknav-brand` com o `title` → `screen.getByTitle('Net Fibra Ltda')`; `img.worknav-logo` → `screen.getByTitle('Net Fibra Ltda').querySelector('img')` (e o `img.worknav-full-logo` sai da asserção: a logo cheia era do menu expandido, que não existe mais).

Em `SideNav.connection.test.jsx`, os dois testes da queda passam a:

```jsx
  test('durante a queda, o indicador fica no trilho, focável e sem role="status"', () => {
    useSocketConnection.mockReturnValue('reconnecting');
    renderNav();
    const indicador = screen.getByLabelText('Reconectando. As mensagens novas podem demorar a aparecer.');
    expect(indicador).toHaveAttribute('tabindex', '0');
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  test('ao voltar, o mesmo indicador mostra "Conectado" por 3 s e some', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useSocketConnection.mockReturnValue('reconnecting');
    const { rerender } = renderNav();
    useSocketConnection.mockReturnValue('connected');
    rerender(<MemoryRouter initialEntries={['/']}><SideNav onProfileClick={vi.fn()} /></MemoryRouter>);
    expect(screen.getByLabelText('Conectado')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3100));
    expect(screen.queryByLabelText('Conectado')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
```

(com `act` importado de `@testing-library/react`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/SideNav.test.jsx src/components/SideNav.branding.test.jsx src/components/SideNav.connection.test.jsx`
Expected: FAIL nos novos (há botão de recolher, grupos, `role="status"`, sem barra, sem cabeçalho no menu da conta).

- [ ] **Step 3: Implementar**

`frontend/src/utils/papeis.js`:

```js
// Rótulo do papel de quem está logado. Mora aqui, e não em AgentsAdminTab, para
// a casca (menu da conta) não puxar uma aba de Configurações.
export const ROTULO_DO_PAPEL = { admin: 'Administrador', manager: 'Gerente', agent: 'Atendente' };
```

Em `AgentsAdminTab.jsx:14`, `const ROLE_LABELS = { … }` vira `import { ROTULO_DO_PAPEL as ROLE_LABELS } from '../utils/papeis';` (no topo, junto dos imports).

`DicaFlutuante.jsx`, a função `DicaFlutuante` (`:60-68`) passa a:

```jsx
export function DicaFlutuante({ caixa, children }) {
  if (!caixa || typeof document === 'undefined') return null;
  return createPortal(
    <span
      data-dica=""
      className="chat-theme pointer-events-none fixed z-[var(--z-popover)] max-w-[min(320px,60vw)] -translate-y-1/2 truncate whitespace-nowrap rounded-ui-sm bg-elevado px-2 py-1 text-meta text-tinta shadow-flutuante"
      aria-hidden="true"
      style={{ left: caixa.left, top: caixa.top }}
    >
      {children}
    </span>,
    document.body
  );
}
```

(O estilo morava em `dashboard.css:278`, só carregado pela mesa: fora dela a dica do trilho sairia sem estilo. Apagar `.chat-rail-tip` e o comentário `:273-277` de `dashboard.css`. Os testes da dica do trilho da lista, em `ConversationListItem.test.jsx:740-792`, acham a dica por `.chat-rail-tip`: trocar pelos 7 lugares por `[data-dica]` — o que eles leem de `style.left`/`style.top` e `aria-hidden` continua valendo.)

`frontend/src/components/SideNav.jsx` inteiro:

```jsx
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { NavLink, useMatch } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useCompanyName } from '../hooks/useCompanyName';
import { useEstadoDaConexao } from '../hooks/useEstadoDaConexao';
import { NAV_ITEMS, hasLevel } from '../navigation/navItems';
import AgentAvatar from './AgentAvatar';
import { IconArchive, IconBellOff, IconBellOn, IconCheck, IconLogout, IconUser, IconWarning } from './icons/IconesTrabalho';
import { primeiroFocavel, prenderTabEm } from './ui/Dialog';
import { useCamadaLeve } from './ui/camadaLeve';
import { Popover } from './ui/Popover';
import { useDicaFlutuante, DicaFlutuante } from './DicaFlutuante';
import { ROTULO_DO_PAPEL } from '../utils/papeis';
import { marcaDaInstalacao } from '../branding';

// O diálogo de Encerrados puxa a ConversationView (131 KB): só baixa quando o
// atendente abre (spec 7(b)). Antes vinha no trecho da casca de toda rota.
const ClosedConversationsModal = lazy(() => import('./ClosedConversationsModal'));

export function iniciaisDaEmpresa(nome) {
  const palavras = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return '';
  const primeira = palavras[0];
  if (primeira.length <= 2 && primeira === primeira.toUpperCase()) return primeira;
  return palavras.slice(0, 2).map((palavra) => palavra[0].toUpperCase()).join('');
}

// Trilho único (decisão 6 do proprietário, 24/09/2026): 64 px em qualquer rota
// no desktop, sem grupos e sem modo expandido — com no máximo seis destinos,
// grupo e modo expandido eram o que tornava o menu desorganizado. No celular a
// gaveta de 216 px continua com rótulos (lá não há dica por ponteiro).
// Ativo = barra de 3 px + fundo + ícone no acento (decisão 3): forma, não só cor.
const ITEM = 'relative flex h-12 items-center gap-3 rounded-ui-md px-3 text-tinta-2 transition-colors duration-120 hover:bg-hover hover:text-tinta md:mx-auto md:w-12 md:justify-center md:px-0';
const ROTULO = (gaveta) => (gaveta ? 'min-w-0 truncate text-corpo md:hidden' : 'hidden');

function Marca({ gaveta, companyName, companyNameStatus }) {
  const nome = companyName || 'Atendimento';
  const arte = marcaDaInstalacao.compacta;
  // Enquanto o nome não chega, o monograma fica vazio de propósito: o espaço
  // já está reservado e a barra não pula.
  const iniciais = companyNameStatus === 'loading' ? '' : iniciaisDaEmpresa(companyName);
  return (
    <div className="mb-2 flex h-12 items-center gap-3 px-3 md:justify-center md:px-0" title={nome}>
      {arte ? (
        <img src={arte} alt={nome} width={32} height={32} className="h-8 w-8 shrink-0 rounded-ui-md object-contain" />
      ) : (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-ui-md bg-accent-surface text-rotulo font-semibold text-accent-soft" aria-hidden="true" data-monograma="">
          {iniciais}
        </span>
      )}
      {gaveta && (
        <span data-nome-da-empresa="" className="min-w-0 truncate text-corpo font-semibold text-tinta md:hidden">
          {companyName || ''}
        </span>
      )}
    </div>
  );
}

function BarraAtivo() {
  return <span aria-hidden="true" data-barra-ativo="" className="absolute inset-y-2 -left-2 w-[3px] rounded-full bg-accent" />;
}

function Destino({ item, gaveta, aoNavegar }) {
  const ativo = Boolean(useMatch({ path: item.match, end: item.match === '/' }));
  const { gatilho, caixa } = useDicaFlutuante();
  const Icone = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.match === '/'}
      {...(gaveta ? {} : gatilho)}
      aria-label={item.label}
      aria-current={ativo ? 'page' : undefined}
      onClick={aoNavegar}
      className={`${ITEM} ${ativo ? 'bg-selecionado text-accent-soft' : ''}`}
    >
      {ativo && <BarraAtivo />}
      <Icone size={24} />
      <span className={ROTULO(gaveta)}>{item.label}</span>
      {!gaveta && <DicaFlutuante caixa={caixa}>{item.label}</DicaFlutuante>}
    </NavLink>
  );
}

function BotaoDoTrilho({ rotulo, dica, gaveta, onClick, children, ...resto }) {
  const { gatilho, caixa } = useDicaFlutuante();
  return (
    <button type="button" {...(gaveta ? {} : gatilho)} onClick={onClick} className={ITEM} {...resto}>
      {children}
      <span className={ROTULO(gaveta)}>{rotulo}</span>
      {!gaveta && <DicaFlutuante caixa={caixa}>{dica || rotulo}</DicaFlutuante>}
    </button>
  );
}

function IndicadorDaConexao({ gaveta }) {
  const fase = useEstadoDaConexao();
  const { gatilho, caixa } = useDicaFlutuante();
  if (fase === 'ok') return null;
  const caiu = fase === 'caiu';
  const nome = caiu ? 'Reconectando. As mensagens novas podem demorar a aparecer.' : 'Conectado';
  // Focável (tabIndex 0) para a dica abrir pelo teclado; SEM role="status": quem
  // anuncia é a região viva da casca (FaixaDaConexao), uma só por tela.
  return (
    <span tabIndex={0} aria-label={nome} {...(gaveta ? {} : gatilho)} className={`${ITEM} cursor-default ${caiu ? 'text-aviso' : 'text-tinta-2'}`}>
      {caiu ? <IconWarning size={22} /> : <IconCheck size={22} />}
      <span className={ROTULO(gaveta)}>{caiu ? 'Reconectando…' : 'Conectado'}</span>
      {!gaveta && <DicaFlutuante caixa={caixa}>{caiu ? 'Reconectando… As mensagens novas podem demorar a aparecer.' : 'Conectado'}</DicaFlutuante>}
    </span>
  );
}

function SideNav({ onProfileClick, mobileOpen = false, onMobileClose = () => {} }) {
  const { agent, logout } = useAuth();
  const { muted, toggleMuted } = useQueueNotificationSound();
  const { name: companyName, status: companyNameStatus } = useCompanyName();
  const [closedOpen, setClosedOpen] = useState(false);
  const [contaAberta, setContaAberta] = useState(false);
  const navRef = useRef(null);
  const gatilhoDaConta = useRef(null);
  const painelDaConta = useRef(null);
  const { gatilho: dicaDaConta, caixa: caixaDaConta } = useDicaFlutuante();
  const gaveta = mobileOpen;
  const itens = NAV_ITEMS.filter((item) => hasLevel(agent, item.level));
  const destinos = itens.filter((item) => item.key !== 'configuracoes');
  const configuracoes = itens.find((item) => item.key === 'configuracoes');
  const nomeDaConta = agent?.name || 'Atendente';

  // ESC da gaveta pela camada leve (saiu o ouvinte próprio do document): com
  // "Meu perfil" aberto por cima, o 1º ESC fecha o perfil e o 2º a gaveta.
  useCamadaLeve(mobileOpen, onMobileClose);

  useEffect(() => {
    if (!mobileOpen) return;
    // Sem isto o foco ficava no botão "Abrir menu" e o Tab ia para o conteúdo
    // atrás da gaveta. Quem devolve o foco no fechamento é a casca.
    const alvo = primeiroFocavel(navRef.current);
    if (alvo) alvo.focus();
  }, [mobileOpen]);

  useEffect(() => {
    if (!contaAberta) return;
    const primeiro = primeiroFocavel(painelDaConta.current);
    if (primeiro) primeiro.focus();
  }, [contaAberta]);

  function fecharConta() {
    setContaAberta(false);
    if (gatilhoDaConta.current) gatilhoDaConta.current.focus();
  }

  function navegou() {
    setContaAberta(false);
    onMobileClose();
  }

  return (
    <>
      {/* O véu fica UM degrau abaixo da barra: disputando `--z-nav`, o véu
          pintava por cima e todo toque caía nele. */}
      {mobileOpen && <div aria-hidden="true" onClick={onMobileClose} className="fixed inset-0 z-[calc(var(--z-nav)-1)] bg-veu md:hidden" />}
      <nav
        id="sidenav"
        ref={navRef}
        aria-label="Navegação principal"
        data-gaveta={mobileOpen ? 'aberta' : undefined}
        onKeyDown={mobileOpen ? (evento) => prenderTabEm(navRef.current, evento) : undefined}
        className={`shrink-0 flex-col border-r border-linha bg-painel px-2 py-3 md:px-0 ${
          mobileOpen ? 'fixed inset-y-0 left-0 z-[var(--z-nav)] flex w-[216px] md:static md:z-auto md:w-16' : 'hidden md:flex md:w-16'
        }`}
      >
        <Marca gaveta={gaveta} companyName={companyName} companyNameStatus={companyNameStatus} />
        <div className="flex flex-1 flex-col gap-1">
          {destinos.map((item) => (
            <div key={item.key} className="contents">
              <Destino item={item} gaveta={gaveta} aoNavegar={navegou} />
              {item.key === 'atendimento' && agent?.role === 'agent' && (
                <BotaoDoTrilho
                  rotulo="Encerrados"
                  gaveta={gaveta}
                  aria-label="Atendimentos encerrados"
                  aria-haspopup="dialog"
                  onClick={() => setClosedOpen(true)}
                >
                  <IconArchive size={24} />
                </BotaoDoTrilho>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1 border-t border-linha pt-2">
          {configuracoes && <Destino item={configuracoes} gaveta={gaveta} aoNavegar={navegou} />}
          <BotaoDoTrilho
            rotulo="Som da fila"
            dica={`Som da fila: ${muted ? 'desativado' : 'ativado'}`}
            gaveta={gaveta}
            aria-label={`Som da fila — ${muted ? 'Som desativado' : 'Som ativado'}`}
            onClick={toggleMuted}
          >
            {muted ? <IconBellOff size={24} /> : <IconBellOn size={24} />}
          </BotaoDoTrilho>
          <IndicadorDaConexao gaveta={gaveta} />
          <span className="relative mx-auto">
            <button
              type="button"
              ref={(el) => {
                gatilhoDaConta.current = el;
                dicaDaConta.ref.current = el;
              }}
              onMouseEnter={dicaDaConta.onMouseEnter}
              onMouseLeave={dicaDaConta.onMouseLeave}
              onFocus={dicaDaConta.onFocus}
              onBlur={dicaDaConta.onBlur}
              aria-label={`Conta: ${nomeDaConta}`}
              aria-expanded={contaAberta}
              aria-controls={contaAberta ? 'conta-menu' : undefined}
              onClick={() => setContaAberta((aberta) => !aberta)}
              className="grid h-12 w-12 place-items-center rounded-ui-md transition-colors duration-120 hover:bg-hover"
            >
              <AgentAvatar agentId={agent?.id} avatarPath={agent?.avatarPath} name={agent?.name} size={32} />
            </button>
            {!gaveta && !contaAberta && <DicaFlutuante caixa={caixaDaConta}>{`Conta: ${nomeDaConta}`}</DicaFlutuante>}
            <Popover
              aberto={contaAberta}
              aoFechar={fecharConta}
              ancoraRef={gatilhoDaConta}
              id="conta-menu"
              ariaLabel="Conta"
              largura={224}
            >
              <div ref={painelDaConta}>
                <div className="px-3 pb-2 pt-2">
                  <p className="truncate text-corpo font-semibold text-tinta" title={nomeDaConta}>{nomeDaConta}</p>
                  <p className="text-rotulo text-tinta-2">{ROTULO_DO_PAPEL[agent?.role] || ROTULO_DO_PAPEL.agent}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setContaAberta(false); onProfileClick(); }}
                  className="flex h-10 w-full items-center gap-3 rounded-ui-md px-3 text-left text-corpo text-tinta hover:bg-hover"
                >
                  <IconUser size={18} />Meu perfil
                </button>
                <hr role="separator" className="my-1 border-linha" />
                <button
                  type="button"
                  onClick={() => { setContaAberta(false); logout(); }}
                  className="flex h-10 w-full items-center gap-3 rounded-ui-md px-3 text-left text-corpo text-tinta hover:bg-hover"
                >
                  <IconLogout size={18} />Sair
                </button>
              </div>
            </Popover>
          </span>
        </div>
      </nav>
      {closedOpen && (
        <Suspense fallback={null}>
          <ClosedConversationsModal onClose={() => setClosedOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

export default SideNav;
```

Apagar `frontend/src/components/side-nav.css`, `frontend/src/hooks/useNavCollapsed.js` e `frontend/src/hooks/useNavCollapsed.test.jsx`.

`useWorkspaceLayout.js:39`: `const MENU_E_RESPIROS = 90;` → `const MENU_E_RESPIROS = 65;` com o comentário "trilho de 64 px + a linha de 1 px (spec 6.1: sem moldura)". O comentário `:49-50` ("o menu lateral muda de 196px para 64px sem a janela mudar") passa a "o menu tem largura fixa; a medida real continua, porque a faixa do canal e a gaveta mudam o espaço sem a janela mudar". Em `DashboardPage.jsx:58-59`, o mesmo ajuste no comentário.

- [ ] **Step 4: Rodar e ver passar; os invariantes**

Run: `cd frontend && npx vitest run src/components/SideNav src/components/AppShell src/hooks/useWorkspaceLayout.test.js src/pages/DashboardPage.test.jsx src/App.routes.test.jsx src/components/AgentsAdminTab.test.jsx`
Expected: PASS — inclui os 8 casos de `useWorkspaceLayout.test.js` (os limiares não dependem do palpite), os de `conversationOpen` 1280/400 da `DashboardPage` e "o menu marca Relatórios como ativo em /relatorios".

- [ ] **Step 5: Medir a casca**

Run: `cd frontend && npx vite build --manifest && node ../ferramentas/medicao/pesos.mjs dist`
Expected: `raiz.js` cai de novo — a `ConversationView` não está mais no trecho da casca pelo menu (spec 7(b): a camada da casca cai de 164,6 KB para ~25,7 KB **não** comprimidos; a mesa ainda importa a `ConversationView`, então o total de "/" cai pouco — o ganho real é na casca de rotas sem mesa, que a E3 mede). Conferir pelos imports **estáticos** do manifesto — o nome da `ConversationView` continua no arquivo da casca, na lista de pré-carga (`__vite__mapDeps`) do `import()` dinâmico, então um `grep` no nome acha sempre: `node -e "const m=require('./dist/.vite/manifest.json');const e=Object.values(m).find(x=>x.src==='src/components/AppShell.jsx');const est=(e.imports||[]).map(k=>m[k].src||k);console.log(est.some(s=>/ConversationView/.test(s))?'FALHA: estatico':'ok')"` → `ok`.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src/components/SideNav.jsx frontend/src/components/side-nav.css frontend/src/hooks/useNavCollapsed.js frontend/src/hooks/useNavCollapsed.test.jsx frontend/src/utils/papeis.js frontend/src/components/AgentsAdminTab.jsx frontend/src/components/DicaFlutuante.jsx frontend/src/pages/dashboard.css frontend/src/hooks/useWorkspaceLayout.js frontend/src/pages/DashboardPage.jsx frontend/src/components/SideNav.test.jsx frontend/src/components/SideNav.branding.test.jsx frontend/src/components/SideNav.connection.test.jsx frontend/src/components/ConversationListItem.test.jsx
git commit -m "E2.3: menu em trilho unico de 64 px com ativo por barra e fundo; Encerrados lazy"
```

---

### Task 3: Faixa do canal em uma linha

**Files:**
- Rewrite: `frontend/src/components/ChannelStatusBanner.jsx`
- Modify: `frontend/src/components/ChannelStatusBanner.test.jsx`

Anexo C §6 e E.2: hoje uma linha por canal, sem teto, com N links iguais para a lista (e a rota `canais/:id/conexao` existe, `App.jsx:164-166`); erro de busca parece "tudo conectado"; nenhuma atualização no turno. Passa a: **uma** linha pela `FaixaDeAviso` — um canal → "Canal Loja desconectado" + "Conectar" (ou "aguardando leitura do QR code" + "Ler QR code") para a aba de conexão dele; dois ou mais → "2 canais sem conexão: Loja, Suporte" + "Ver canais"; falha → "Não foi possível conferir os canais" + "Tentar de novo". Anuncia a frase pela região viva quando ela muda. Rebusca quando o socket volta e quando a aba volta a ficar visível (sem busca periódica — E.3).

- [ ] **Step 1: Atualizar e escrever os testes**

Em `ChannelStatusBanner.test.jsx`:

- "o link leva para Configurações › Canais" passa a:

```jsx
  test('um canal desconectado: "Conectar" leva à aba de conexão dele', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }], loading: false });
    renderBanner();
    expect(screen.getByText('Canal Berg desconectado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Conectar' })).toHaveAttribute('href', '/configuracoes/canais/ch1/conexao');
  });
```

- "warns an admin about a channel awaiting QR" passa a:

```jsx
  test('canal aguardando QR: frase própria e "Ler QR code"', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg', status: 'awaiting_qr' }], loading: false });
    renderBanner();
    expect(screen.getByText('Canal Berg aguardando leitura do QR code')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ler QR code' })).toHaveAttribute('href', '/configuracoes/canais/ch1/conexao');
  });
```

- Acrescentar:

```jsx
  test('dois ou mais canais: UMA linha que nomeia todos, e um link "Ver canais"', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({
      channels: [
        { id: 'ch1', name: 'Loja', status: 'disconnected' },
        { id: 'ch2', name: 'Suporte', status: 'awaiting_qr' },
      ],
      loading: false,
    });
    renderBanner();
    expect(screen.getByText('2 canais sem conexão: Loja, Suporte')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Ver canais' })).toHaveAttribute('href', '/configuracoes/canais');
  });

  test('falha ao buscar os canais: diz que não conferiu e oferece "Tentar de novo"', async () => {
    const refresh = vi.fn();
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({ channels: [], status: 'error', loading: false, refresh });
    renderBanner();
    expect(screen.getByText('Não foi possível conferir os canais')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a aba volta a ficar visível: busca de novo', () => {
    const refresh = vi.fn();
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({ channels: [], status: 'ready', loading: false, refresh });
    renderBanner();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
```

(importar `userEvent` no topo.) Os testes "renders nothing for a non-admin agent", "…when every channel is connected", "nunca avisa sobre um canal oficial…", "ainda avisa sobre um canal baileys desconectado", os dois de gerente e "warns an admin about a disconnected channel" continuam — o último por `getByText(/Berg/)` e `getByText(/desconectado/i)`, que casam a frase nova.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ChannelStatusBanner.test.jsx`
Expected: FAIL nos novos e nos dois reescritos.

- [ ] **Step 3: Implementar**

`frontend/src/components/ChannelStatusBanner.jsx` inteiro:

```jsx
import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';
import { useSocketConnection } from '../contexts/SocketContext';
import { useAnunciar } from '../contexts/RegiaoVivaContext';
import { hasLevel } from '../navigation/rotas';
import { isOfficialChannelType } from '../utils/channelTypes';
import { FaixaDeAviso } from './ui/FaixaDeAviso';

function fraseDoCanal(canal) {
  return canal.status === 'awaiting_qr' ? `Canal ${canal.name} aguardando leitura do QR code` : `Canal ${canal.name} desconectado`;
}

// UMA linha (E.2): um canal → a frase dele e o verbo que resolve, na aba de
// conexão DELE; dois ou mais → quantos e quais, e um link para a lista. Antes
// eram N linhas com N links iguais para a lista.
function conteudo(problemas) {
  if (problemas.length === 1) {
    const [canal] = problemas;
    return {
      texto: fraseDoCanal(canal),
      acao: { rotulo: canal.status === 'awaiting_qr' ? 'Ler QR code' : 'Conectar', para: `/configuracoes/canais/${canal.id}/conexao` },
    };
  }
  return {
    texto: `${problemas.length} canais sem conexão: ${problemas.map((c) => c.name).join(', ')}`,
    acao: { rotulo: 'Ver canais', para: '/configuracoes/canais' },
  };
}

function ChannelStatusBanner() {
  const { agent } = useAuth();
  const podeVer = hasLevel(agent, 'integrations');
  const { channels = [], status, refresh } = useChannels(podeVer);
  const estado = useSocketConnection();
  const anunciar = useAnunciar();
  const anteriorRef = useRef(estado);
  const ultimaFraseRef = useRef('');

  // Rebusca quando o socket volta e quando a aba volta a ficar visível: o
  // backend não emite evento de status de canal, e a faixa buscada uma vez
  // ficava velha o turno inteiro. Sem busca periódica (Apêndice E.3).
  useEffect(() => {
    const anterior = anteriorRef.current;
    anteriorRef.current = estado;
    if (podeVer && refresh && estado === 'connected' && anterior === 'reconnecting') refresh();
  }, [estado, podeVer, refresh]);

  useEffect(() => {
    if (!podeVer || !refresh) return undefined;
    function aoVoltar() {
      if (document.visibilityState === 'visible') refresh();
    }
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [podeVer, refresh]);

  // Canal oficial (meta_cloud/360dialog) nunca entra: não tem conexão para
  // cair, e ninguém atualiza o status dele depois da criação.
  const problemas = channels.filter((c) => !isOfficialChannelType(c.type) && c.status !== 'connected');
  const faixa = !podeVer
    ? null
    : status === 'error'
      ? { texto: 'Não foi possível conferir os canais', acao: refresh ? { rotulo: 'Tentar de novo', aoClicar: refresh } : undefined }
      : problemas.length > 0
        ? conteudo(problemas)
        : null;

  const frase = faixa ? faixa.texto : '';
  useEffect(() => {
    if (frase && frase !== ultimaFraseRef.current) anunciar(`${frase}.`);
    ultimaFraseRef.current = frase;
  }, [frase, anunciar]);

  if (!faixa) return null;
  return <FaixaDeAviso texto={faixa.texto} titulo={faixa.texto} acao={faixa.acao} className="border-b border-linha" />;
}

export default ChannelStatusBanner;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/ChannelStatusBanner.test.jsx src/pages/DashboardPage.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChannelStatusBanner.jsx frontend/src/components/ChannelStatusBanner.test.jsx
git commit -m "E2.3: faixa do canal em uma linha, com destino e verbo, erro e rebusca"
```

---

### Task 4: Transferência vira marca (casca)

**Files:**
- Create: `frontend/src/contexts/TransferenciasContext.jsx` (substitui o mínimo da Task 1), `frontend/src/contexts/TransferenciasContext.test.jsx`
- Delete: `frontend/src/components/TransferNotice.jsx`, `TransferNotice.test.jsx`, `frontend/src/hooks/useTransferNotice.js`, `useTransferNotice.test.jsx`
- Modify: `frontend/src/pages/DashboardPage.jsx:10-11,57,82-88,326` (saem o hook, o aviso e `openTransferred`)
- Modify: `frontend/src/components/overlays.css:205` (sai `.dialog-transfer-notice`)

Decisão 11 (14.1): o aviso de transferência vira **marca na lista** — a conversa entra em "Atendimento" com a marca de não lida e "Transferido por Fulano" na linha 2 até ser aberta; a frase vai para a região viva; o sino continua. O ouvinte sobe para a casca (anexo C §5, sub-decisão de D8): transferência recebida em Relatórios também toca e anuncia, e a marca espera a volta à mesa. O gatilho passa a ser "a chave `transferredBy` existe" (a rota de transferência sempre manda, objeto ou `null`; assumir e criar conversa não mandam — `src/api/conversations.routes.js:518-521, :286, :225`).

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/contexts/TransferenciasContext.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TransferenciasProvider, useTransferencias } from './TransferenciasContext';
import { RegiaoVivaProvider } from './RegiaoVivaContext';

const handlers = {};
const socket = { on: vi.fn((ev, fn) => { handlers[ev] = fn; }), off: vi.fn((ev) => { delete handlers[ev]; }) };
vi.mock('./SocketContext', () => ({ useSocket: () => socket }));
const playChime = vi.fn();
let muted = false;
vi.mock('../hooks/useNotificationSound', () => ({ useNotificationSound: () => ({ muted, playChime }) }));

function Espiao() {
  const { marcas, limpar } = useTransferencias();
  return (
    <div>
      <p data-testid="marcas">{JSON.stringify([...marcas.entries()])}</p>
      <button type="button" onClick={() => limpar('conv-1')}>limpar</button>
    </div>
  );
}

const montar = () => render(<RegiaoVivaProvider><TransferenciasProvider><Espiao /></TransferenciasProvider></RegiaoVivaProvider>);
const regiao = () => document.querySelector('[data-regiao-viva]');
const conversa = (id, nome) => ({ id, contactDisplayName: nome, contactPhoneNumber: '+5511999998888' });

beforeEach(() => { vi.useFakeTimers(); muted = false; playChime.mockClear(); });
afterEach(() => vi.useRealTimers());

describe('transferências (decisão 11)', () => {
  test('transferência com nome: marca, sino e frase na região viva', () => {
    montar();
    act(() => handlers['conversation:assigned']({ conversation: conversa('conv-1', 'Carlos'), transferredBy: { id: 'a1', name: 'Maria Souza' } }));
    act(() => vi.advanceTimersByTime(60));
    expect(screen.getByTestId('marcas')).toHaveTextContent('[["conv-1","Maria Souza"]]');
    expect(playChime).toHaveBeenCalledTimes(1);
    expect(regiao()).toHaveTextContent('Maria Souza transferiu o atendimento de Carlos para você.');
  });

  test('transferência sem nome (transferredBy: null) também marca', () => {
    montar();
    act(() => handlers['conversation:assigned']({ conversation: conversa('conv-2', 'Ana'), transferredBy: null }));
    act(() => vi.advanceTimersByTime(60));
    expect(screen.getByTestId('marcas')).toHaveTextContent('[["conv-2",null]]');
    expect(regiao()).toHaveTextContent('O atendimento de Ana foi transferido para você.');
  });

  test('assumir (sem a chave transferredBy) não marca nem toca', () => {
    montar();
    act(() => handlers['conversation:assigned']({ conversation: conversa('conv-3', 'Bia') }));
    expect(screen.getByTestId('marcas')).toHaveTextContent('[]');
    expect(playChime).not.toHaveBeenCalled();
  });

  test('duas transferências acumulam (antes a segunda apagava a primeira)', () => {
    montar();
    act(() => handlers['conversation:assigned']({ conversation: conversa('conv-1', 'Carlos'), transferredBy: { name: 'Maria' } }));
    act(() => handlers['conversation:assigned']({ conversation: conversa('conv-4', 'Dora'), transferredBy: { name: 'Berg' } }));
    expect(screen.getByTestId('marcas')).toHaveTextContent('[["conv-1","Maria"],["conv-4","Berg"]]');
  });

  test('mudo: marca e anuncia, mas não toca', () => {
    muted = true;
    montar();
    act(() => handlers['conversation:assigned']({ conversation: conversa('conv-1', 'Carlos'), transferredBy: { name: 'Maria' } }));
    expect(screen.getByTestId('marcas')).toHaveTextContent('conv-1');
    expect(playChime).not.toHaveBeenCalled();
  });

  test('abrir a conversa limpa a marca dela', () => {
    montar();
    act(() => handlers['conversation:assigned']({ conversation: conversa('conv-1', 'Carlos'), transferredBy: { name: 'Maria' } }));
    act(() => screen.getByRole('button', { name: 'limpar' }).click());
    expect(screen.getByTestId('marcas')).toHaveTextContent('[]');
  });

  test('desliga o ouvinte ao desmontar', () => {
    const { unmount } = montar();
    unmount();
    expect(socket.off).toHaveBeenCalledWith('conversation:assigned', expect.any(Function));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/contexts/TransferenciasContext.test.jsx`
Expected: FAIL (o provedor mínimo da Task 1 não ouve nada).

- [ ] **Step 3: Implementar**

`frontend/src/contexts/TransferenciasContext.jsx` inteiro:

```jsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSocket } from './SocketContext';
import { useAnunciar } from './RegiaoVivaContext';
import { useNotificationSound } from '../hooks/useNotificationSound';

// Transferência recebida vira MARCA na lista (decisão 11 do proprietário,
// 24/09/2026): um aviso fixo ocupava espaço permanente por um evento pontual, e
// o toast de 9 s sumia com a ação junto e ficava sobre o compositor. Mora na
// casca: recebida em Relatórios, também toca e anuncia, e a marca espera a
// volta à mesa. Cada transferência marca a sua conversa (antes a segunda
// apagava a primeira).
//
// Gatilho = a CHAVE `transferredBy` existir: a rota de transferência sempre
// manda (objeto ou null); assumir e criar conversa não mandam.
const VAZIO = new Map();
const TransferenciasContext = createContext({ marcas: VAZIO, limpar: () => {} });

export function TransferenciasProvider({ children }) {
  const socket = useSocket();
  const anunciar = useAnunciar();
  const { muted, playChime } = useNotificationSound();
  const [marcas, setMarcas] = useState(() => new Map());

  useEffect(() => {
    if (!socket) return undefined;
    function aoAtribuir(evento = {}) {
      const { conversation } = evento;
      if (!conversation || !Object.prototype.hasOwnProperty.call(evento, 'transferredBy')) return;
      const por = evento.transferredBy && evento.transferredBy.name ? evento.transferredBy.name : null;
      const cliente = conversation.contactDisplayName || conversation.contactPhoneNumber || 'um cliente';
      setMarcas((atual) => new Map(atual).set(conversation.id, por));
      anunciar(por ? `${por} transferiu o atendimento de ${cliente} para você.` : `O atendimento de ${cliente} foi transferido para você.`);
      // Silenciar é sobre barulho, não sobre esconder: a marca e o anúncio ficam.
      if (!muted) playChime();
    }
    socket.on('conversation:assigned', aoAtribuir);
    return () => socket.off('conversation:assigned', aoAtribuir);
  }, [socket, anunciar, muted, playChime]);

  const limpar = useCallback((conversationId) => {
    setMarcas((atual) => {
      if (!atual.has(conversationId)) return atual;
      const proximo = new Map(atual);
      proximo.delete(conversationId);
      return proximo;
    });
  }, []);

  const valor = useMemo(() => ({ marcas, limpar }), [marcas, limpar]);
  return <TransferenciasContext.Provider value={valor}>{children}</TransferenciasContext.Provider>;
}

export function useTransferencias() {
  return useContext(TransferenciasContext);
}
```

Apagar `TransferNotice.jsx`, `TransferNotice.test.jsx`, `useTransferNotice.js`, `useTransferNotice.test.jsx`, e a regra `.dialog-transfer-notice > div` de `overlays.css`.

Na `DashboardPage.jsx`: tirar os imports de `useTransferNotice` e `TransferNotice` (`:10-11`), a linha `const { notice: transferNotice, dismiss: dismissTransferNotice } = useTransferNotice();` (`:57`), a função `openTransferred` (`:82-88`) e o `<TransferNotice … />` (`:326`). A marca na lista entra na Task 6.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/contexts src/components/AppShell`
Expected: PASS.

Em `DashboardPage.test.jsx`, nesta tarefa: saem o `import { useTransferNotice }`, o `vi.mock('../hooks/useTransferNotice')`, a linha `useTransferNotice.mockReturnValue(…)` do `beforeEach` e os três testes do aviso ("sem transferência não há status", "mostra quem transferiu e o cliente", "clicar no aviso abre e dispensa") — sem isso o **arquivo inteiro** deixa de carregar (`Failed to resolve import "../hooks/useTransferNotice"`, 0 testes). A marca na linha, que os substitui, entra na Task 6.

A casca precisa provar que monta o provedor (na prova em cópia, tirar o `TransferenciasProvider` da `AppShell` deixou os 64 testes de `src/contexts`, `AppShell` e `App` verdes). `frontend/src/components/AppShell.transferencias.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AppShell from './AppShell';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useCompanyName } from '../hooks/useCompanyName';

const handlers = {};
const socket = { on: vi.fn((ev, fn) => { handlers[ev] = fn; }), off: vi.fn((ev) => { delete handlers[ev]; }) };
vi.mock('../contexts/SocketContext', () => ({ useSocket: () => socket, useSocketConnection: () => 'connected' }));
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useCompanyName');
vi.mock('../hooks/useNotificationSound', () => ({ useNotificationSound: () => ({ muted: true, playChime: vi.fn() }) }));
vi.mock('./ProfileModal', () => ({ default: () => null }));
vi.mock('./ClosedConversationsModal', () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ agent: { role: 'agent' }, logout: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
  useCompanyName.mockReturnValue({ name: 'DW Telecom', status: 'ready' });
});

describe('a casca monta o provedor de transferências', () => {
  test('transferência recebida fora da mesa é anunciada pela região viva', async () => {
    render(
      <MemoryRouter initialEntries={['/relatorios']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/relatorios" element={<p>relatórios</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    act(() => handlers['conversation:assigned']({ conversation: { id: 'conv-1', contactDisplayName: 'Carlos' }, transferredBy: { id: 'a1', name: 'Maria Souza' } }));
    await waitFor(() => expect(document.querySelector('[data-regiao-viva]')).toHaveTextContent('Maria Souza transferiu o atendimento de Carlos para você.'));
  });
});
```

Prova por mutação: tirar o `<TransferenciasProvider>` da `AppShell` → este teste falha (`handlers['conversation:assigned'] is not a function`). Desfazer.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/contexts/TransferenciasContext.jsx frontend/src/contexts/TransferenciasContext.test.jsx frontend/src/components/TransferNotice.jsx frontend/src/components/TransferNotice.test.jsx frontend/src/hooks/useTransferNotice.js frontend/src/hooks/useTransferNotice.test.jsx frontend/src/pages/DashboardPage.jsx frontend/src/components/overlays.css
git commit -m "E2.3: transferencia recebida vira marca na casca (sai o toast de 9 s)"
```

---

### Task 5: A linha da lista em duas linhas

**Files:**
- Modify: `frontend/src/components/ConversationListItem.jsx:1-197` (imports, rótulos de mídia, variantes `rail` e `compact`; a variante não compacta fica até a E2.5)
- Modify: `frontend/src/components/QueueList.jsx`, `frontend/src/components/MyConversationsList.jsx`
- Create: `frontend/src/components/ConversationListItem.linha.test.jsx`
- Modify: `frontend/src/components/ConversationListItem.test.jsx` (os testes de emoji)
- Modify: `frontend/src/pages/dashboard.css:25-135` (saem `.chat-conversation-*` da linha compacta, o filete por `data-estado`, `.chat-conversation-close`) e `:268-272` (trilho da linha)

Spec 6.2: item de 72 px, 2 linhas, avatar 44. Linha 1: nome (15/600) · hora (12, tabular; na fila, a de chegada). Linha 2 por aba — **Atendimento:** tiques (se a última saiu) + prévia; com transferência pendente, começa por "Transferido por Fulano" · **Espera:** localidade (500) + separador + prévia (decisão B do proprietário, `c3118b4`) · **Automação:** ícone da IA + estado ("Em triagem" ou o motivo) + separador + prévia. Fim da linha 2, um só por prioridade: botão "Finalizar sem motivo" (irmão da linha) → ⚠ de confiança baixa → ponto de não lida. Não lida = ponto + hora no acento. Selecionada = `--color-selecionado` + barra de 3 px. Divisória depois do avatar. Saem: fichas de cidade e setor, lilás da IA, chip do responsável, filete, gradiente. **Nome acessível carrega tudo** (texto `sr-only`): nome, hora, localidade, setor, estado da IA, "Resolvido pela IA", prévia, transferência, "não lida". Prévia de mídia: ícone + rótulo, sem emoji; Pix nunca mostra o código.

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/components/ConversationListItem.linha.test.jsx`:

```jsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationListItem from './ConversationListItem';

// A linha DA MESA (variante compact) — até a E2 nenhum teste de unidade a
// exercitava (todos renderizavam a variante do Encerrados).
const BASE = {
  id: 'c1',
  contactId: 'k1',
  contactDisplayName: 'Maria Souza',
  contactPhoneNumber: '+5598985004187',
  contactCityName: 'Cândido Mendes',
  contactLocalityName: 'Barão de Tromaí',
  sectorName: 'Financeiro',
  lastMessageContent: 'Quero a segunda via',
  lastMessageAt: '2026-09-24T12:05:00.000Z',
  createdAt: '2026-09-24T11:00:00.000Z',
  lastMessageDirection: 'inbound',
  assignedAgentName: 'Ana Lima',
};

function linha(props = {}, conversa = {}) {
  render(
    <ul>
      <ConversationListItem conversation={{ ...BASE, ...conversa }} onSelect={vi.fn()} compact {...props} />
    </ul>
  );
  return screen.getByRole('button', { name: /Maria Souza/ });
}

describe('linha da mesa (spec 6.2)', () => {
  test('Atendimento: sem fichas de cidade/setor nem chip do responsável; tudo no nome acessível', () => {
    const el = linha({ aba: 'atendimento' });
    expect(within(el).queryByText('Financeiro', { ignore: '.sr-only' })).not.toBeInTheDocument();
    expect(within(el).queryByText('Ana Lima')).not.toBeInTheDocument();
    expect(el).toHaveAccessibleName(/Maria Souza.*Quero a segunda via.*Barão de Tromaí · Cândido Mendes.*Financeiro/);
  });

  test('Espera: a localidade abre a linha 2 (decisão B), sem o município', () => {
    const el = linha({ aba: 'espera', showArrivalTime: true });
    const visivel = within(el).getByText('Barão de Tromaí', { ignore: '.sr-only' });
    expect(visivel).toBeInTheDocument();
    expect(within(el).queryByText('Barão de Tromaí · Cândido Mendes', { ignore: '.sr-only' })).not.toBeInTheDocument();
  });

  test('Automação: estado da IA na linha 2, sem lilás; confiança baixa como ícone nomeado', () => {
    const el = linha(
      { aba: 'automacao' },
      { triageState: 'pending', aiTriageCompletedAt: null },
    );
    expect(within(el).getByText('Em triagem', { ignore: '.sr-only' })).toBeInTheDocument();

    const { container } = render(
      <ul>
        <ConversationListItem
          compact
          aba="automacao"
          onSelect={vi.fn()}
          conversation={{ ...BASE, id: 'c2', aiTriageCompletedAt: '2026-09-24T11:10:00Z', aiTriageReasonName: 'Segunda via', aiTriageLowConfidence: true }}
        />
      </ul>
    );
    expect(within(container).getByText('Segunda via', { ignore: '.sr-only' })).toBeInTheDocument();
    expect(within(container).getByLabelText('Triagem com confiança baixa')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/chat-conversation-ai|ink-ai/);
  });

  test('prévia de mídia: rótulo sem emoji; Pix nunca mostra o código', () => {
    linha({}, { lastMessageContent: null, lastMessageType: 'image' });
    expect(screen.getByText('Foto', { ignore: '.sr-only' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/📷|🎤|🎥|📄|😀|📍|💠/u);
  });

  test('Pix: "Pix" e nunca o copia-e-cola', () => {
    linha({}, { lastMessageType: 'pix', lastMessageContent: '00020101021226880014br.gov.bcb.pix' });
    expect(screen.getByText('Pix', { ignore: '.sr-only' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/000201/);
  });

  test('não lida: ponto + hora no acento, e "mensagem não lida" no nome acessível', () => {
    const el = linha({ unread: true });
    expect(within(el).getByTitle('Mensagem não lida')).toBeInTheDocument();
    expect(el).toHaveAccessibleName(/mensagem não lida/i);
  });

  test('transferência pendente: "Transferido por Fulano" abre a linha 2 e marca como não lida', () => {
    const el = linha({ aba: 'atendimento', transferidoPor: 'Pedro Alves' });
    expect(within(el).getByText('Transferido por Pedro Alves', { ignore: '.sr-only' })).toBeInTheDocument();
    expect(within(el).getByTitle('Mensagem não lida')).toBeInTheDocument();
  });

  test('transferência sem nome: "Transferido para você"', () => {
    const el = linha({ aba: 'atendimento', transferidoPor: '' });
    expect(within(el).getByText('Transferido para você', { ignore: '.sr-only' })).toBeInTheDocument();
  });

  test('selecionada: aria-current e a barra de 3 px', () => {
    const el = linha({ selected: true });
    expect(el).toHaveAttribute('aria-current', 'true');
    expect(el.querySelector('[data-barra-selecao]')).not.toBeNull();
  });

  test('trilho: o nome acessível diz "não lida" (antes só o nome)', () => {
    render(<ul><ConversationListItem conversation={BASE} onSelect={vi.fn()} rail unread /></ul>);
    expect(screen.getByRole('button', { name: 'Maria Souza, mensagem não lida' })).toBeInTheDocument();
  });
});
```

Em `ConversationListItem.test.jsx`, os testes do trilho que acham a linha por `.chat-rail-row` e a seleção por `is-selected` passam a `[role="button"]` e `aria-current="true"` (a linha nova não tem essas classes). Em `QueueList.test.jsx`, o `renderFila` passa `compact` (a variante não compacta ignora `aba`), e a asserção da Espera que lê o município ganha `{ ignore: '.sr-only' }` — o município passa a morar também no texto `sr-only` do nome acessível.

Na Supervisão (`SupervisionPage.jsx:150`) o item continua `compact` e sem `aba`: a linha 2 cai no padrão (prévia), e a página já zera localidade e setor no item porque tem colunas próprias para eles. O estado da IA na fila fica no nome acessível — revisar na E5, que é dona da Supervisão.

Em `ConversationListItem.test.jsx`, os dois testes de mídia ("shows a media type label…" e o do Pix) passam a esperar o rótulo **sem** emoji (`getByText('Foto')` … `getByText('Localização')`; `getByText('Pix')` e `queryByText(/000201/)` nulo). Os demais testes desse arquivo exercitam a variante não compacta (Encerrados) e ficam até a E2.5.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ConversationListItem.linha.test.jsx src/components/ConversationListItem.test.jsx`
Expected: FAIL nos novos e nos dois de mídia.

- [ ] **Step 3: Implementar**

Em `frontend/src/components/ConversationListItem.jsx`:

Imports (`:1-7`):

```jsx
import { memo } from 'react';
import ContactAvatar from './ContactAvatar';
import MessageStatusTicks from './MessageStatusTicks';
import { IconCheckCircle, IconDocument, IconImage, IconMic, IconPin, IconPix, IconSpark, IconSticker, IconVideo, IconWarning } from './icons/IconesTrabalho';
import { useConfirm } from '../hooks/useConfirm';
import { useDicaFlutuante, DicaFlutuante } from './DicaFlutuante';
import { nomeDoLocal, localMaisEspecifico } from '../utils/place';
```

Rótulos de mídia (`:9-17`) e prévia (`:29-36`):

```jsx
// Rótulo + ícone da família, sem emoji (spec 5.6): o emoji mudava de desenho
// por sistema e ignorava o tema.
const MIDIA = {
  image: { rotulo: 'Foto', Icone: IconImage },
  audio: { rotulo: 'Áudio', Icone: IconMic },
  video: { rotulo: 'Vídeo', Icone: IconVideo },
  document: { rotulo: 'Documento', Icone: IconDocument },
  sticker: { rotulo: 'Figurinha', Icone: IconSticker },
  location: { rotulo: 'Localização', Icone: IconPin },
  pix: { rotulo: 'Pix', Icone: IconPix },
};

function previaDe(conversation) {
  // O conteúdo de uma mensagem 'pix' é o código copia e cola — nunca aparece
  // na prévia, então esse tipo é checado antes do lastMessageContent.
  if (conversation.lastMessageType === 'pix') return MIDIA.pix;
  if (conversation.lastMessageContent) return { rotulo: conversation.lastMessageContent, Icone: null };
  if (MIDIA[conversation.lastMessageType]) return MIDIA[conversation.lastMessageType];
  return { rotulo: conversation.contactPhoneNumber || '', Icone: null };
}
```

A variante não compacta (Encerrados, `:199-295`) passa a usar `previaDe(conversation).rotulo` no lugar de `getPreviewText(conversation)`; `getPreviewText` e `MEDIA_TYPE_LABELS` saem.

Assinatura (`:43`): acrescentar `aba = 'atendimento', transferidoPor = null` e manter `soLocalidade` só para a variante não compacta.

`handleQuickClose` (`:88-92`) e o `useConfirm` (`:44-46`) **ficam como estão nesta tarefa**: a confirmação continua no item até a Task 7, que a sobe para o dono da lista e troca o handler no mesmo passo. Tirar aqui deixaria o "Finalizar" sem confirmação entre as duas tarefas (a prova em cópia viu os testes de finalizar da mesa quebrados da Task 5 à 7). O botão das variantes novas chama o `handleQuickClose` de hoje.

O `estadoDaConversa` local (`:22-27`) só servia ao `data-estado` do filete, que sai: apagar.

Variante `rail` (`:102-127`), nome acessível com "não lida" e avatar 40:

```jsx
  if (rail) {
    const nomeAcessivel = unread || transferidoPor !== null ? `${nameLabel}, mensagem não lida` : nameLabel;
    return (
      <li>
        <div
          {...gatilhoDaDica}
          role="button"
          tabIndex={0}
          onClick={handleSelect}
          onKeyDown={handleKeyDown}
          aria-label={nomeAcessivel}
          aria-current={selected ? 'true' : undefined}
          className={`relative mx-auto my-1 grid h-13 w-13 cursor-pointer place-items-center rounded-full transition-colors duration-120 hover:bg-hover ${selected ? 'bg-selecionado' : ''}`}
        >
          {selected && <span aria-hidden="true" data-barra-selecao="" className="absolute inset-y-2 -left-2 w-[3px] rounded-full bg-accent" />}
          <ContactAvatar contactId={conversation.contactId} avatarPath={conversation.contactAvatarPath} displayName={conversation.contactDisplayName} phoneNumber={conversation.contactPhoneNumber} size={40} />
          {(unread || transferidoPor !== null) && <span aria-hidden="true" className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-painel" />}
          <DicaFlutuante caixa={caixaDaDica}>{nameLabel}</DicaFlutuante>
        </div>
      </li>
    );
  }
```

Variante `compact` (`:129-197`) inteira:

```jsx
  if (compact) {
    const naoLida = unread || transferidoPor !== null;
    const previa = previaDe(conversation);
    const localidade = localMaisEspecifico(conversation.contactLocalityName, conversation.contactCityName);
    const localCompleto = nomeDoLocal(conversation.contactLocalityName, conversation.contactCityName);
    const estadoDaIa = conversation.triageState === 'pending'
      ? 'Em triagem'
      : conversation.aiTriageCompletedAt
        ? conversation.aiTriageReasonName || 'Triagem concluída'
        : null;
    const confiancaBaixa = Boolean(conversation.aiTriageCompletedAt && conversation.aiTriageLowConfidence);
    const transferencia = transferidoPor === null ? null : transferidoPor ? `Transferido por ${transferidoPor}` : 'Transferido para você';
    const PreviaIcone = previa.Icone;
    // Fim da linha 2 — UM só, por prioridade (spec 6.2). O botão "Finalizar"
    // mora fora da linha (irmão), então aqui só se reserva o espaço dele.
    const fim = onQuickClose ? 'botao' : confiancaBaixa ? 'confianca' : naoLida ? 'ponto' : null;

    return (
      <li className="relative">
        <div
          role="button"
          tabIndex={0}
          onClick={handleSelect}
          onKeyDown={handleKeyDown}
          aria-current={selected ? 'true' : undefined}
          className={`relative flex h-18 cursor-pointer items-center gap-3 pl-4 transition-colors duration-120 hover:bg-hover ${selected ? 'bg-selecionado' : ''}`}
        >
          {selected && <span aria-hidden="true" data-barra-selecao="" className="absolute inset-y-0 left-0 w-[3px] bg-accent" />}
          <span className="linha-avatar shrink-0">
            <ContactAvatar contactId={conversation.contactId} avatarPath={conversation.contactAvatarPath} displayName={conversation.contactDisplayName} phoneNumber={conversation.contactPhoneNumber} size={44} />
          </span>
          {/* A divisória começa DEPOIS do avatar (spec 6.2). */}
          <span className={`flex min-w-0 flex-1 flex-col justify-center self-stretch border-b border-linha pr-3 ${fim === 'botao' ? 'pr-12' : ''}`}>
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="linha-nome min-w-0 flex-1 truncate text-nome font-semibold text-tinta" title={nameLabel}>{nameLabel}</span>
              {messageTime && (
                <span className={`linha-hora shrink-0 text-meta tabular-nums ${naoLida ? 'text-accent-soft' : 'text-tinta-3'}`}>
                  {messageTime}
                </span>
              )}
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-corpo text-tinta-2">
              {aba === 'atendimento' && conversation.lastMessageDirection === 'outbound' && !transferencia && (
                <MessageStatusTicks status={conversation.lastMessageStatus} />
              )}
              {aba === 'atendimento' && transferencia && (
                <>
                  <span className="shrink-0 font-medium text-tinta">{transferencia}</span>
                  <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-tinta-3" />
                </>
              )}
              {aba === 'espera' && localidade && (
                <>
                  <span className="max-w-[45%] shrink-0 truncate font-medium">{localidade}</span>
                  <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-tinta-3" />
                </>
              )}
              {aba === 'automacao' && estadoDaIa && (
                <>
                  <span aria-hidden="true" className="shrink-0"><IconSpark size={14} /></span>
                  <span className="max-w-[45%] shrink-0 truncate">{estadoDaIa}</span>
                  <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-tinta-3" />
                </>
              )}
              {PreviaIcone && <span aria-hidden="true" className="shrink-0"><PreviaIcone size={14} /></span>}
              <span className="linha-previa min-w-0 flex-1 truncate">{previa.rotulo}</span>
              {fim === 'confianca' && (
                <span className="shrink-0 text-aviso" role="img" aria-label="Triagem com confiança baixa">
                  <IconWarning size={16} />
                </span>
              )}
              {fim === 'ponto' && <span className="linha-nao-lida h-2.5 w-2.5 shrink-0 rounded-full bg-accent" title="Mensagem não lida" aria-hidden="true" />}
              {fim === 'botao' && naoLida && <span className="linha-nao-lida sr-only" title="Mensagem não lida" />}
            </span>
            {/* O que saiu da vista continua no nome acessível (spec 6.2):
                "nenhuma informação some para leitor de tela". */}
            <span className="sr-only">
              {aba !== 'espera' && localCompleto ? `, ${localCompleto}` : ''}
              {aba === 'espera' && localCompleto && localCompleto !== localidade ? `, ${localCompleto}` : ''}
              {conversation.sectorName ? `, ${conversation.sectorName}` : ''}
              {aba !== 'automacao' && estadoDaIa ? `, IA: ${estadoDaIa}` : ''}
              {confiancaBaixa && fim !== 'confianca' ? ', triagem com confiança baixa' : ''}
              {conversation.aiTriageResolvedByAi ? ', resolvido pela IA' : ''}
              {naoLida ? ', mensagem não lida' : ''}
            </span>
          </span>
        </div>
        {/* Irmão da linha, não filho: a ação da LINHA é abrir a conversa; a do
            botão é finalizar sem motivo — dois elementos lado a lado. A
            confirmação é do dono da lista (um diálogo por lista, não por item). */}
        {onQuickClose && (
          <button
            type="button"
            onClick={handleQuickClose}
            aria-label="Finalizar sem motivo"
            className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-ui-md text-tinta-2 transition-colors duration-120 hover:bg-hover hover:text-tinta"
          >
            <IconCheckCircle size={18} />
          </button>
        )}
      </li>
    );
  }
```

(`h-18` = 72 px e `h-13` = 52 px são passos do Tailwind 4, não valores arbitrários. O `title="Finalizar sem motivo"` sai: a dica nativa repetia o nome acessível.)

`QueueList.jsx` inteiro:

```jsx
import ConversationListItem from './ConversationListItem';
import { AsyncState } from './ui';

function QueueList({ conversations, status, onSelect, onQuickClose, emptyMessage = 'Nenhum atendimento em espera.', selectedId, unreadIds, compact = false, rail = false, aba = 'espera' }) {
  return (
    <AsyncState status={status} isEmpty={conversations.length === 0} emptyMessage={<span className="block px-4 pt-4 text-center">{emptyMessage}</span>}>
      <ul>
        {conversations.map((conversation) => (
          <ConversationListItem
            key={conversation.id}
            conversation={conversation}
            onSelect={onSelect}
            onQuickClose={onQuickClose}
            selected={selectedId === conversation.id}
            unread={Boolean(unreadIds && unreadIds.has(conversation.id))}
            showArrivalTime
            compact={compact}
            rail={rail}
            aba={aba}
          />
        ))}
      </ul>
    </AsyncState>
  );
}

export default QueueList;
```

`MyConversationsList.jsx`: acrescentar a prop `marcas` (Map) e passar `transferidoPor={marcas && marcas.has(conversation.id) ? marcas.get(conversation.id) ?? '' : null}` e `aba="atendimento"` a cada item. (`?? ''`: marca sem nome vira string vazia — "Transferido para você"; sem marca é `null`. Primitivo: o memo do item continua valendo.)

`QueueList.test.jsx`: o teste "sem a prop: localidade · município (comentário: Automação não pode mudar)" passa a renderizar com `aba="automacao"` e a afirmar que o lugar **não** aparece visível na linha 2 e **aparece** no nome acessível (`toHaveAccessibleName(/Barão de Tromaí · Cândido Mendes/)`); o de `soLocalidade` passa a `aba="espera"`.

Apagar de `dashboard.css` as regras da linha compacta e do trilho da linha (`:25-135` e `:268-272` na numeração de hoje — o comentário que abre o bloco começa na 25: apagar só a partir da 30 deixaria um `/*` aberto engolindo o resto do arquivo; e as `:257-266` são regras da coluna, que a Task 6 apaga: `.chat-conversation-row`, `::after` do filete, `.is-selected`, `.chat-conversation-figure/summary/name/time/preview/snippet/unread`, `.chat-conversation-context`, `-chip`, `-alerta`, `-ai`, `:has(.chat-conversation-close)`, `.chat-conversation-close`, `.chat-rail-row`, `.chat-rail-unread`, `.chat-rail-entry`), **menos** o que a variante não compacta do Encerrados ainda usa (conferir com `grep -n "chat-conversation" src/components/ConversationListItem.jsx` depois da troca: o que só a variante não compacta usa, fica até a E2.5). A Supervisão tem regras próprias em `supervision.css:524-546` sobre essas classes: ficam órfãs, sem efeito; a E5 limpa.

- [ ] **Step 4: Rodar e ver passar; memo**

Run: `cd frontend && npx vitest run src/components/ConversationListItem src/components/QueueList.test.jsx src/guardas/memoLista.test.jsx src/pages/SupervisionPage.test.jsx`
Expected: PASS — o guarda do memo (E0) continua 0 re-renders quando nada muda e 1 quando uma conversa muda, porque as props novas são primitivas. Se a Supervisão falhar só pela confirmação do "Finalizar", é esperado até a Task 7 (o item não abre mais o diálogo sozinho): anotar e seguir.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ConversationListItem.jsx frontend/src/components/ConversationListItem.linha.test.jsx frontend/src/components/ConversationListItem.test.jsx frontend/src/components/QueueList.jsx frontend/src/components/QueueList.test.jsx frontend/src/components/MyConversationsList.jsx frontend/src/pages/dashboard.css
git commit -m "E2.3: linha da lista em duas linhas por aba, com tudo no nome acessivel"
```

---

### Task 6: A coluna da lista

**Files:**
- Modify: `frontend/src/pages/DashboardPage.jsx:160-279` (coluna), `:98-117` (marcas e estados), `:24-28` (rótulos)
- Modify: `frontend/src/components/ui/Tabs.jsx` (visual `sublinhado`; sai `segmented`)
- Modify: `frontend/src/components/ui/AsyncState.jsx` (esqueleto com a forma do item, opcional por prop)
- Modify: `frontend/src/pages/dashboard.css:6-24` (cabeçalho, busca, abas, painel, barra da equipe)
- Modify: `frontend/src/pages/DashboardPage.test.jsx`

Spec 6.2: cabeçalho de 56 px com "Atendimento" (Sora 20) e botão de ícone "Nova conversa" (neutro, 36×36; sai o laranja cheio "Nova" — o acento é de "é com você"); busca afundada de 36 px, "Buscar nome, telefone, cidade ou setor"; abas de 40 px com sublinhado de 2 px no acento e a contagem como número em tinta-2 ("Espera 14"); estados: carregando = 6 linhas-esqueleto com a forma do item; vazio por aba (ícone 32 + frase); busca sem resultado ("Nada encontrado para “termo”" + "Limpar busca"); erro (frase; o "Tentar de novo" é ligado na E4). A aba Atendimento ganha a marca de transferência nova quando outra aba está ativa (decisão 11).

- [ ] **Step 1: Escrever/atualizar os testes**

Em `DashboardPage.test.jsx`, reescrever os três testes do aviso de transferência (hoje "sem transferência não há status", "mostra quem transferiu e o cliente" e "clicar no aviso abre e dispensa") como:

```jsx
describe('transferência recebida (decisão 11)', () => {
  test('a conversa transferida aparece marcada, com "Transferido por Maria Souza"; abrir limpa a marca', async () => {
    const limpar = vi.fn();
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [TRANSFERIDA], status: 'ready' });
    useTransferencias.mockReturnValue({ marcas: new Map([['conv-t', 'Maria Souza']]), limpar });
    renderDashboard();
    const linha = await screen.findByRole('button', { name: /Carlos/ });
    expect(within(linha).getByText('Transferido por Maria Souza', { ignore: '.sr-only' })).toBeInTheDocument();
    await userEvent.click(linha);
    expect(limpar).toHaveBeenCalledWith('conv-t');
  });

  test('com outra aba ativa, a aba Atendimento mostra a marca', async () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c1', contactDisplayName: 'Ana', status: 'waiting' }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [TRANSFERIDA], status: 'ready' });
    useTransferencias.mockReturnValue({ marcas: new Map([['conv-t', 'Maria Souza']]), limpar: vi.fn() });
    renderDashboard();
    await userEvent.click(await screen.findByRole('tab', { name: /espera/i }));
    expect(screen.getByRole('tab', { name: /atendimento/i })).toHaveAccessibleName(/transferência nova/i);
  });
});
```

(`TRANSFERIDA` é a fixture que o arquivo já tem — `conv-t`, Carlos, em "Meus"; cada teste novo desta tarefa fixa `useQueue` e `useMyConversations` ele mesmo, porque o `beforeEach` do arquivo não os fixa e o valor do teste anterior vazaria. Com `vi.mock('../contexts/TransferenciasContext')` e `import { useTransferencias } from '../contexts/TransferenciasContext';` no topo, e `useTransferencias.mockReturnValue({ marcas: new Map(), limpar: vi.fn() })` no `beforeEach`. Usar o `renderDashboard`/fixtures que o arquivo já tem — a conversa "Carlos" com id `c2` em "meus atendimentos", como nos testes atuais do aviso.)

Acrescentar:

```jsx
describe('coluna da lista (spec 6.2)', () => {
  test('cabeçalho: "Nova conversa" é botão de ícone (sai o "Nova" laranja)', async () => {
    renderDashboard();
    const botao = await screen.findByRole('button', { name: 'Nova conversa' });
    expect(botao).not.toHaveTextContent('Nova');
  });

  test('busca diz o que casa', async () => {
    renderDashboard();
    expect(await screen.findByPlaceholderText('Buscar nome, telefone, cidade ou setor')).toBeInTheDocument();
  });

  test('abas: contagem como número ao lado do rótulo', async () => {
    renderDashboard();
    expect(await screen.findByRole('tab', { name: /espera 1/i })).toBeInTheDocument();
  });

  test('busca sem resultado: "Nada encontrado para “termo”" e "Limpar busca" (não diz que a fila está vazia)', async () => {
    renderDashboard();
    await userEvent.type(await screen.findByRole('searchbox'), 'zzz');
    expect(screen.getByText('Nada encontrado para “zzz”')).toBeInTheDocument();
    expect(screen.queryByText(/nenhum atendimento em/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  test('carregando: 6 linhas-esqueleto com a forma do item', () => {
    useMyConversations.mockReturnValue({ conversations: [], status: 'loading' });
    renderDashboard();
    expect(document.querySelectorAll('[data-esqueleto-linha]')).toHaveLength(6);
  });

  test('a região viva da contagem fala das três filas', async () => {
    renderDashboard();
    await screen.findByRole('tablist');
    expect(document.querySelector('p[aria-live="polite"].sr-only')).toHaveTextContent(/em espera.*em automação.*em atendimento/);
  });
});
```

(`searchbox` é o papel do `input type="search"`; ajustar os mocks de `useQueue`/`useMyConversations` ao que o arquivo já usa.) O teste "aba vazia sem contagem" (`textContent` `'Atendimento'`) continua: contagem 0 não aparece.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.jsx`
Expected: FAIL nos novos e nos reescritos.

- [ ] **Step 3: Implementar o visual `sublinhado` nas abas**

Em `components/ui/Tabs.jsx`, trocar o bloco `SEG_*` (`:22-25`) por:

```js
// Sublinhado: a faixa das filas da mesa (spec 6.2) — texto, sublinhado de 2 px
// no acento na ativa, contagem como número ao lado. Saiu a pílula laranja cheia
// com bolinha branca e brilho (#f4531f).
const SUB_BASE = `relative flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap px-1 text-corpo transition-colors duration-120 ${FOCUS}`;
const SUB_ACTIVE = 'font-semibold text-tinta';
const SUB_IDLE = 'text-tinta-2 hover:text-tinta';
```

Em `tabClass`: `if (look === 'sublinhado') return \`${SUB_BASE} ${active ? SUB_ACTIVE : SUB_IDLE}\`;` no lugar da linha `segmented`. Em `Count`, no lugar do ramo `segmented`:

```jsx
  if (look === 'sublinhado') {
    return <span className="font-normal tabular-nums text-tinta-2">{value}</span>;
  }
```

Em `stripClass`: `if (look === 'sublinhado') return 'flex w-full gap-5 border-b border-linha px-4';` no lugar do `segmented`. No botão da aba (`role="tab"`), depois do `<Count … />`:

```jsx
            {look === 'sublinhado' && isActive && <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />}
            {tab.marca && (
              <>
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="sr-only">{tab.marca}</span>
              </>
            )}
```

(`segmented` só era usado pela mesa — conferir com `grep -rn "segmented" frontend/src` → só `Tabs.jsx` e a `DashboardPage`.)

- [ ] **Step 4: Esqueleto com a forma do item**

Em `components/ui/AsyncState.jsx`, acrescentar a prop `esqueleto` (padrão `'barras'`, o de hoje) e, quando `esqueleto === 'linhas'`, desenhar no carregando:

```jsx
      <div role="status" aria-live="polite" className="px-4">
        <span className="sr-only">Carregando…</span>
        {Array.from({ length: skeletonLines }, (_, i) => (
          <div key={i} data-esqueleto-linha="" aria-hidden="true" className="flex h-18 items-center gap-3">
            <span className="h-11 w-11 shrink-0 rounded-full bg-tinta-3/30" />
            <span className="flex flex-1 flex-col gap-2">
              <span className="h-3 w-2/5 rounded-full bg-tinta-3/30" />
              <span className="h-3 w-4/5 rounded-full bg-tinta-3/30" />
            </span>
          </div>
        ))}
      </div>
```

(`bg-tinta-3/30`, e não `bg-linha` (1,33:1) nem `bg-selecionado` (1,22:1): o spec 6.2 pede esqueleto ≥ 1,5:1 sobre o painel. O teste de contraste da E2.1 não cobre composição com alfa — acrescentar a `src/estilo/contraste.test.js`:

```js
  // Esqueleto da lista (E2.3, Task 6): tinta-3 a 30% sobre o painel ≥ 1,5:1
  // (spec 6.2). Na prova em cópia deu 1,69.
  test('esqueleto: tinta-3 a 30% sobre o painel ≥ 1,5:1', () => {
    expect(contraste(compor({ ...T.tinta3, a: 0.3 }, T.painel), T.painel)).toBeGreaterThanOrEqual(1.5);
  });
```

— `compor`, `contraste` e `T` são os que o arquivo já importa e monta.)

`QueueList` e `MyConversationsList` passam `esqueleto="linhas"` e `skeletonLines={6}` ao `AsyncState`. E, no trilho, não desenham estado nenhum — vazio, esqueleto e erro não cabem em 72 px (hoje quem os esconde é `dashboard.css:259-261`, que sai nesta tarefa): primeira linha do corpo das duas, `if (rail && (status !== 'ready' || conversations.length === 0)) return null;` — no trilho, a ausência de avatares é o que informa.

- [ ] **Step 5: Reescrever a coluna na `DashboardPage`**

Imports: `useCompanyName` **fica** até a Task 9 (a mesa vazia ainda o usa — tirar aqui dá `ReferenceError`); `useTransferNotice`/`TransferNotice` já saíram na Task 4; entram `import { useTransferencias } from '../contexts/TransferenciasContext';` e os ícones de `../components/icons/IconesTrabalho` (`IconNewChat, IconSearch, IconChats, IconArrowLeft`).

Estado e derivados (depois de `useUnreadMyConversations`):

```jsx
  const { marcas, limpar: limparMarca } = useTransferencias();

  const selectConversation = useCallback((conversationId) => {
    clearUnread(conversationId);
    limparMarca(conversationId);
    setSelectedId(conversationId);
    setListaAberta(false);
  }, [clearUnread, limparMarca]);
```

(substitui o `selectConversation` de `:75-80`; `limparMarca` vem de `useCallback` no provedor, então o memo dos itens continua.)

Marca que ficou para trás (conversa que saiu de "meus atendimentos" sem ser aberta):

```jsx
  useEffect(() => {
    for (const id of marcas.keys()) {
      if (!myConversations.some((c) => c.id === id)) limparMarca(id);
    }
  }, [marcas, myConversations, limparMarca]);
```

Seleção que saiu das listas (S9 do dossiê: a conversa transferida de volta reabria sozinha e sem marca):

```jsx
  useEffect(() => {
    if (selectedId && !selectedConversation && !pendingConversation) setSelectedId(null);
  }, [selectedId, selectedConversation, pendingConversation]);
```

(depois da definição de `selectedConversation`.)

Abas:

```jsx
  const temTransferenciaNova = marcas.size > 0;
  const abas = TABS.map((tab) => ({
    key: tab.value,
    label: tab.label,
    count: tabCounts[tab.value],
    marca: tab.value === 'inProgress' && temTransferenciaNova && activeTab !== 'inProgress' ? 'com transferência nova' : null,
  }));
```

O trecho da coluna (`:180-237`: cabeçalho, busca, região viva, abas e o `tabpanel`) passa a:

```jsx
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 pl-4 pr-2">
            <h1 className="font-display text-pagina font-semibold text-tinta">Atendimento</h1>
            <button
              type="button"
              onClick={() => setStartingConversation(true)}
              aria-label="Nova conversa"
              className="grid h-9 w-9 place-items-center rounded-ui-md text-tinta-2 transition-colors duration-120 hover:bg-hover hover:text-tinta"
            >
              <IconNewChat size={20} />
            </button>
          </div>

          <div className="shrink-0 px-4 pb-2">
            <label className="flex h-9 min-w-0 items-center gap-2 rounded-ui-md bg-campo px-3 focus-within:outline focus-within:outline-2 focus-within:outline-focus-ring">
              <span aria-hidden="true" className="shrink-0 text-tinta-3"><IconSearch size={16} /></span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar nome, telefone, cidade ou setor"
                aria-label="Buscar atendimento"
                className="min-w-0 flex-1 bg-transparent text-corpo text-tinta outline-none placeholder:text-tinta-3"
              />
            </label>
          </div>

          {/* A contagem das filas numa região discreta (nome de aba que muda não
              é anunciado). `aria-live` sem role: é conteúdo que se atualiza. */}
          <p aria-live="polite" className="sr-only">
            {tabCounts.waiting} em espera, {tabCounts.automation} em automação, {tabCounts.inProgress} em atendimento.
          </p>

          <Tabs look="sublinhado" label="Filas" active={activeTab} onChange={setActiveTab} tabs={abas} />

          <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} className="chat-scroll min-h-0 flex-1 overflow-y-auto">
            {term && visiveisDaAba.length === 0 && statusDaAba === 'ready' ? (
              <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                <p className="text-corpo text-tinta-2">Nada encontrado para “{search.trim()}”</p>
                <button type="button" onClick={() => setSearch('')} className="text-rotulo font-semibold text-accent-soft hover:underline">
                  Limpar busca
                </button>
              </div>
            ) : (
              <>
                {activeTab === 'inProgress' && (
                  <MyConversationsList conversations={visibleMine} status={myConversationsStatus} onSelect={selectConversation} unreadIds={unreadIds} selectedId={selectedId} marcas={marcas} compact rail={emRail} />
                )}
                {activeTab === 'waiting' && (
                  <QueueList conversations={visibleWaiting} status={queueStatus} onSelect={selectConversation} unreadIds={unreadIds} onQuickClose={pedirFinalizacao} selectedId={selectedId} emptyMessage="Nenhum atendimento em espera." compact rail={emRail} aba="espera" />
                )}
                {activeTab === 'automation' && (
                  <QueueList conversations={visibleAutomation} status={queueStatus} onSelect={selectConversation} unreadIds={unreadIds} onQuickClose={pedirFinalizacao} selectedId={selectedId} emptyMessage="Nenhum atendimento em automação." compact rail={emRail} aba="automacao" />
                )}
              </>
            )}
          </div>
```

com, antes do `return`:

```jsx
  const visiveisDaAba = activeTab === 'inProgress' ? visibleMine : activeTab === 'waiting' ? visibleWaiting : visibleAutomation;
  const statusDaAba = activeTab === 'inProgress' ? myConversationsStatus : queueStatus;
```

(`pedirFinalizacao` vem da Task 7; até lá, passar `quickCloseConversation` como hoje.)

O vazio por aba com ícone (spec 6.2: "ícone 32 px + frase"): `QueueList` e `MyConversationsList` passam como `emptyMessage` um bloco `<span className="flex flex-col items-center gap-3 px-6 py-10 text-center text-corpo text-tinta-2"><IconChats size={32} aria-hidden="true" />{frase}</span>` (importar `IconChats` de `IconesTrabalho`). O teste "fila vazia mostra a mensagem de vazio" (`QueueList.test.jsx`) continua achando a frase.

Os botões do trilho da lista ("Ver lista de atendimentos", "Voltar à conversa", `:162-179`) trocam as classes `chat-rail-expandir`/`chat-lista-voltar` por utilitários (`grid h-12 w-12 place-items-center rounded-ui-md text-tinta-2 hover:bg-hover mx-auto my-2` e `flex h-11 items-center gap-2 px-4 text-rotulo font-semibold text-accent-soft`), e as regras correspondentes saem de `dashboard.css`.

Apagar de `dashboard.css` as regras `:6-24` (`.chat-inbox-heading`, `.chat-new-conversation`, `.chat-inbox-search`, `.chat-inbox-tabs`, `[role=tabpanel]`, `[role=status]`, a da barra da equipe por `aria-haspopup=dialog`) e as do trilho que escondiam cabeçalho/busca/abas (`:257-261`) — o esconder no trilho passa ao JSX: `{!emRail && (…cabeçalho, busca, região viva, abas…)}`.

A coluna (`aside`, `:156-161`) troca `chat-workspace-list` e o fundo para `bg-painel border-r border-linha`, mantendo as larguras (`w-[332px]` com `emRail ? 'w-[72px]'` e `listaOcupaTudo ? 'w-full'`) ligadas a `LISTA_EXPANDIDA`/`LISTA_RAIL` — as regras `.chat-workspace-list` de largura (`dashboard.css:4,254-256`) saem junto.

- [ ] **Step 6: Rodar e ver passar; invariantes**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.jsx src/components/ui src/components/QueueList.test.jsx src/guardas src/hooks/useWorkspaceLayout.test.js src/App.test.jsx`
Expected: PASS. Os de `conversationOpen` (1280/400), modos largo/trilho/alternado/estreito e "Voltar à conversa" continuam. Os textos da mesa vazia que ainda falharem são da Task 9.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/DashboardPage.jsx frontend/src/pages/DashboardPage.test.jsx frontend/src/components/ui/Tabs.jsx frontend/src/components/ui/AsyncState.jsx frontend/src/components/QueueList.jsx frontend/src/components/MyConversationsList.jsx frontend/src/pages/dashboard.css frontend/src/estilo/contraste.test.js
git commit -m "E2.3: coluna da lista - cabecalho, busca, abas sublinhadas, estados e marca de transferencia"
```

---

### Task 7: "Finalizar sem motivo" — um diálogo por lista

**Files:**
- Modify: `frontend/src/pages/DashboardPage.jsx:90-92` (`quickCloseConversation` → `pedirFinalizacao`)
- Modify: `frontend/src/pages/SupervisionPage.jsx:394-399` e o uso em `:150,627,636`
- Modify: `frontend/src/pages/DashboardPage.test.jsx`, `frontend/src/pages/SupervisionPage.test.jsx`

Apêndice E.2 e anexo A §4: título "Finalizar sem motivo?", o **nome do cliente** e a consequência verificada no backend ("sai da fila e o atendimento entra no Relatório como "Sem motivo"" — não promete mensagem ao cliente); o diálogo fica aberto até a resposta e mostra o erro; **um diálogo por lista**, no dono da lista, e não um por item (se o item sai da fila com o diálogo aberto, o diálogo não some mais sem explicação — o backend devolve 409 e a frase traduzida aparece). Sai o `.catch(() => {})` que engolia a falha (`DashboardPage.jsx:91`).

- [ ] **Step 1: Escrever os testes**

Em `DashboardPage.test.jsx` (`waitFor` entra no import de `@testing-library/react`), os testes "finalizar da Espera" e "da Automação" passam a — cada um fixa a fila ele mesmo:

```jsx
describe('finalizar sem motivo: um diálogo por lista', () => {
  const CARLOS = { id: 'c1', contactDisplayName: 'Carlos', status: 'waiting' };
  const BRUNO = { id: 'c3', contactDisplayName: 'Bruno', status: 'waiting', triageState: 'pending' };

  beforeEach(() => {
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
  });

  test('da Espera: título, nome do cliente e consequência; fecha na resposta', async () => {
    useQueue.mockReturnValue({ queue: [CARLOS], status: 'ready' });
    closeConversation.mockResolvedValue({});
    renderDashboard();
    await userEvent.click(await screen.findByRole('tab', { name: /espera/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar sem motivo' }));
    const dialogo = screen.getByRole('alertdialog', { name: 'Finalizar sem motivo?' });
    expect(dialogo).toHaveAccessibleDescription(/Carlos sai da fila e o atendimento entra no Relatório como "Sem motivo"/);
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Finalizar' }));
    expect(closeConversation).toHaveBeenCalledWith('c1', null, 'tok-123');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  test('da Automação: o mesmo diálogo', async () => {
    useQueue.mockReturnValue({ queue: [BRUNO], status: 'ready' });
    closeConversation.mockResolvedValue({});
    renderDashboard();
    await userEvent.click(await screen.findByRole('tab', { name: /automação/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar sem motivo' }));
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Finalizar sem motivo?' })).getByRole('button', { name: 'Finalizar' }));
    expect(closeConversation).toHaveBeenCalledWith('c3', null, 'tok-123');
  });

  test('Cancelar não finaliza', async () => {
    useQueue.mockReturnValue({ queue: [CARLOS], status: 'ready' });
    renderDashboard();
    await userEvent.click(await screen.findByRole('tab', { name: /espera/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar sem motivo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(closeConversation).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  test('que falha: o erro aparece no diálogo, que continua aberto', async () => {
    useQueue.mockReturnValue({ queue: [CARLOS], status: 'ready' });
    closeConversation.mockRejectedValue({ status: 409, body: { error: 'Conversation is not currently assigned to you, or is closed' } });
    renderDashboard();
    await userEvent.click(await screen.findByRole('tab', { name: /espera/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar sem motivo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Este atendimento não está com você, ou já foi encerrado.');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  // Review Focus: com a confirmação no ITEM, o diálogo sumia junto quando o
  // item saía da fila. No dono da lista ele fica, e finaliza o atendimento certo.
  test('o item sai da fila com a confirmação aberta: o diálogo fica e finaliza o certo', async () => {
    let fila = [CARLOS];
    useQueue.mockImplementation(() => ({ queue: fila, status: 'ready' }));
    let terminar;
    closeConversation.mockReturnValue(new Promise((r) => { terminar = r; }));
    renderDashboard();
    await userEvent.click(await screen.findByRole('tab', { name: /espera/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar sem motivo' }));
    fila = [];
    // O "Finalizar" põe o diálogo em "ocupado": a mesa re-renderiza e a fila chega vazia.
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar' }));
    expect(screen.queryByRole('button', { name: /^Carlos/ })).not.toBeInTheDocument();
    expect(screen.getByRole('alertdialog', { name: 'Finalizar sem motivo?' })).toBeInTheDocument();
    terminar({});
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(closeConversation).toHaveBeenCalledWith('c1', null, 'tok-123');
  });
});
```

Em `ConversationListItem.test.jsx`, os quatro testes do "Finalizar" que esperavam a confirmação **no item** (`:391-492`) saem — o que eles provavam (a pergunta, cancelar não finaliza, confirmar finaliza) está agora nos testes acima, no dono da lista — e entra no lugar deles o teste do item (que estava na Task 5):

```jsx
  test('"Finalizar sem motivo" é irmão da linha e passa o id e o nome ao dono da lista', async () => {
    const onQuickClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <ul>
        <ConversationListItem conversation={BASE} onSelect={onSelect} onQuickClose={onQuickClose} compact aba="espera" />
      </ul>
    );
    const botao = screen.getByRole('button', { name: 'Finalizar sem motivo' });
    expect(screen.getByRole('button', { name: /Maria Souza/ })).not.toContainElement(botao);
    await userEvent.click(botao);
    expect(onQuickClose).toHaveBeenCalledWith('c1', 'Maria Souza');
    expect(onSelect).not.toHaveBeenCalled();
  });
```

Em `SupervisionPage.test.jsx`, os dois testes que clicam "Finalizar" continuam achando o botão `/finalizar/i` e o `'Finalizar'` da confirmação; nenhum muda.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.jsx src/pages/SupervisionPage.test.jsx`
Expected: FAIL — o item ainda confirma sozinho, com a pergunta antiga, e a mesa não abre o diálogo novo.

- [ ] **Step 3: Implementar**

No `ConversationListItem.jsx`, o `handleQuickClose` (`:88-92`) deixa de confirmar e passa o nome ao dono da lista; o `useConfirm`, o `confirmDialog` e o import saem do item:

```jsx
  function handleQuickClose(event) {
    event.stopPropagation();
    onQuickClose(conversation.id, nameLabel);
  }
```

Na `DashboardPage.jsx`, no lugar de `quickCloseConversation` (`:90-92`), com `useConfirm` importado de `../hooks/useConfirm`:

```jsx
  const { confirm: confirmar, confirmDialog } = useConfirm();

  // Um diálogo por lista (E.2), no dono: se o item sai da fila com a
  // confirmação aberta, ela não some mais sem explicação — o backend devolve
  // 409 e a frase traduzida aparece no diálogo. Fica aberto até a resposta.
  const pedirFinalizacao = useCallback((conversationId, nomeDoCliente) => {
    confirmar(`${nomeDoCliente} sai da fila e o atendimento entra no Relatório como "Sem motivo".`, {
      title: 'Finalizar sem motivo?',
      danger: true,
      confirmLabel: 'Finalizar',
      rotuloOcupado: 'Finalizando…',
      erroPadrao: 'Não foi possível finalizar. Tente de novo.',
      acao: () => closeConversation(conversationId, null, token),
    }).then((ok) => {
      if (ok) avisarNaMesa(`Atendimento de ${nomeDoCliente} finalizado sem motivo.`);
    });
  }, [confirmar, token, avisarNaMesa]);
```

e `{confirmDialog}` no fim do JSX (junto dos outros diálogos). `confirmar` vem de `useCallback` no hook, e `avisarNaMesa` (Task 9) também — `pedirFinalizacao` é estável e o memo dos itens continua. Até a Task 9, declarar `const avisarNaMesa = useCallback(() => {}, []);` e a Task 9 substitui.

Na `SupervisionPage.jsx`, o mesmo padrão: `quickCloseConversation` (`:394`, hoje sem `useCallback`) vira um `useCallback` com `useConfirm({ acao })`, e a linha de erro da página para este caso (`:397-399`) sai — o erro aparece no diálogo. O `ConversationListItem` da Supervisão (`:150`) recebe `onQuickClose={pedirFinalizacao}`. O objeto novo que a Supervisão cria por render para o item (S19 do dossiê: quebra o memo lá) fica como está — a Supervisão é da E5; registrar no registro da E2 como dívida conhecida.

- [ ] **Step 4: Rodar e ver passar; memo**

Run: `cd frontend && npx vitest run src/pages src/components/ConversationListItem src/guardas/memoLista.test.jsx src/hooks/useConfirm.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DashboardPage.jsx frontend/src/pages/DashboardPage.test.jsx frontend/src/pages/SupervisionPage.jsx frontend/src/pages/SupervisionPage.test.jsx frontend/src/components/ConversationListItem.jsx frontend/src/components/ConversationListItem.test.jsx
git commit -m "E2.3: finalizar sem motivo com um dialogo por lista, nome do cliente e erro visivel"
```

---

### Task 8: "Nossa equipe" dentro da coluna

**Files:**
- Rewrite: `frontend/src/components/TeamPanel.jsx` (barra)
- Create: `frontend/src/components/NossaEquipe.jsx`, `frontend/src/components/NossaEquipe.test.jsx`
- Delete: `frontend/src/components/TeamModal.jsx`
- Modify: `frontend/src/pages/DashboardPage.jsx` (a coluna troca de vista), `frontend/src/components/overlays.css:131-133,169,172` (regras `.dialog-team-*` e `[data-dialog=team]`)
- Modify: `frontend/src/components/TeamPanel.test.jsx`

Apêndice E.2/E.3 e anexo C §1: a equipe vira **painel na coluna da lista** ("← Nossa equipe"; "←" e ESC voltam e devolvem o foco à barra), com a conversa à vista (P6). Saem as 4 fichas de filtro (as três seções já são as partições, com a contagem no cabeçalho), as frases-resumo, a ficha colorida "N ativos", o rodapé "Fechar" + nota, o portal redundante e o chevron. Barra de 44 px: "Equipe · ● 5 online", ponto cheio em tinta-2, sem pílula verde, contagem com vaga fixa ("não carregou" no erro). Linha da pessoa: 2 linhas, avatar 32, presença **cheio × vazado** com "online/offline" no nome acessível, linha 2 = "2 atendimentos ativos" / "Disponível" / "Visto por último …" (+ " · 1 atendimento ativo" se offline com ativos). Estados: 4 linhas-esqueleto; erro + "Tentar de novo" (`refresh`); busca sem resultado + "Limpar busca". **Não regride o AgentsContext:** mesmo `useAgents`, nenhum pedido novo; `refresh` ao abrir e nos 4 eventos continua.

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/components/NossaEquipe.test.jsx`:

```jsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NossaEquipe from './NossaEquipe';

const AGENTES = [
  { id: 'a1', name: 'Ana', activeConversations: 2, lastSeenAt: null },
  { id: 'a2', name: 'Carlos', activeConversations: 0, lastSeenAt: null },
  { id: 'a3', name: 'Bruno', activeConversations: 1, lastSeenAt: '2026-09-24T11:37:00Z' },
];
const ONLINE = new Set(['a1', 'a2']);

function montar(props = {}) {
  const onVoltar = vi.fn();
  const refresh = vi.fn();
  render(<NossaEquipe agents={AGENTES} onlineIds={ONLINE} status="ready" refresh={refresh} onVoltar={onVoltar} {...props} />);
  return { onVoltar, refresh };
}

describe('Nossa equipe na coluna', () => {
  test('cabeçalho com "←", linha de contexto e três seções com a contagem', () => {
    montar();
    expect(screen.getByRole('button', { name: 'Voltar para a lista' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nossa equipe' })).toBeInTheDocument();
    expect(screen.getByText('3 integrantes · 2 online')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Em atendimento 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Disponíveis 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Offline 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^todos|^online|^offline/i })).not.toBeInTheDocument();
  });

  test('linha da pessoa: uma frase na linha 2 e presença no nome acessível', () => {
    montar();
    const ana = screen.getByRole('listitem', { name: /Ana/ });
    expect(ana).toHaveAccessibleName(/Ana, online, 2 atendimentos ativos/);
    expect(within(screen.getByRole('listitem', { name: /Carlos/ })).getByText('Disponível')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: /Bruno/ })).getByText(/Visto por último .* · 1 atendimento ativo/)).toBeInTheDocument();
  });

  test('"←" e ESC voltam', async () => {
    const { onVoltar } = montar();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar para a lista' }));
    await userEvent.keyboard('{Escape}');
    expect(onVoltar).toHaveBeenCalledTimes(2);
  });

  test('carregando: 4 linhas-esqueleto e nenhuma contagem inventada', () => {
    montar({ status: 'loading', agents: [] });
    expect(document.querySelectorAll('[data-esqueleto-linha]')).toHaveLength(4);
    expect(screen.queryByText(/integrantes/)).not.toBeInTheDocument();
  });

  test('erro: frase e "Tentar de novo" chama refresh', async () => {
    const { refresh } = montar({ status: 'error', agents: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('busca sem resultado: frase e "Limpar busca"', async () => {
    montar();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar integrante' }), 'zzz');
    expect(screen.getByText('Nada encontrado para “zzz”')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });
});
```

Os seis testes de `TeamPanel.test.jsx` que abriam o popup e olhavam o conteúdo mudam de casa junto com o conteúdo (a vista agora é a `NossaEquipe`): "em carregamento não mostra…" já tem equivalente ("carregando: 4 linhas-esqueleto…"); os outros cinco entram em `NossaEquipe.test.jsx` e em `TeamPanel.test.jsx` (a ordem, que é do `ordenarEquipe` exportado dali):

```jsx
// NossaEquipe.test.jsx
  test('sem ninguém cadastrado: "Nenhum atendente cadastrado."', () => {
    montar({ agents: [] });
    expect(screen.getByText('Nenhum atendente cadastrado.')).toBeInTheDocument();
  });

  test('o nome completo aparece', () => {
    montar({ agents: [{ id: 'a9', name: 'Agnieska Amorim Cutrim', activeConversations: 0, lastSeenAt: null }], onlineIds: new Set(['a9']) });
    expect(screen.getByText('Agnieska Amorim Cutrim')).toBeInTheDocument();
  });

  test('a busca filtra por nome, sem acento', async () => {
    montar({ agents: [{ id: 'a1', name: 'Agnieska Amorim', activeConversations: 0, lastSeenAt: null }, { id: 'a2', name: 'José', activeConversations: 0, lastSeenAt: null }], onlineIds: new Set(['a1', 'a2']) });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar integrante' }), 'jose');
    expect(screen.getByText('José')).toBeInTheDocument();
    expect(screen.queryByText('Agnieska Amorim')).not.toBeInTheDocument();
  });

  test('cada integrante tem o avatar: foto quando há, inicial quando não', () => {
    montar({ agents: [{ id: 'a1', name: 'Ana', avatarPath: 'avatars/a1.jpg', activeConversations: 0 }, { id: 'a2', name: 'Bruno', avatarPath: null, activeConversations: 0 }], onlineIds: new Set() });
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByText('B')).toBeInTheDocument();
  });

// TeamPanel.test.jsx
describe('ordenarEquipe', () => {
  test('online antes de offline, em ordem alfabética dentro de cada grupo', () => {
    const agentes = [{ id: 'a1', name: 'Carlos' }, { id: 'a2', name: 'Ana' }, { id: 'a3', name: 'Bruno' }];
    expect(ordenarEquipe(agentes, new Set(['a1', 'a2'])).map((a) => a.name)).toEqual(['Ana', 'Carlos', 'Bruno']);
  });
});
```

(`import TeamPanel, { ordenarEquipe } from './TeamPanel';` no teste.) Em `TeamPanel.test.jsx`: "começa fechado" continua (`aria-expanded 'false'`, "1 online"); "clicar abre e busca de novo" passa a afirmar `onAbrir` chamado e `refresh` chamado (a vista mora na coluna); saem "ocupados/disponíveis/offline com contagem", "carga e disponibilidade", "offline mostra última atividade", "filtros com contagem", "Fechar e o X", "ponto online/offline" (cobertos em `NossaEquipe.test.jsx`); "busca de novo em assumido/encerrado" muda de casa para `useEquipeAoVivo.test.jsx` (acima), sem mudar asserção.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/NossaEquipe.test.jsx src/components/TeamPanel.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`frontend/src/components/NossaEquipe.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react';
import AgentAvatar from './AgentAvatar';
import { useCamadaLeve } from './ui/camadaLeve';
import { IconArrowLeft, IconSearch } from './icons/IconesTrabalho';
import { formatLastSeen } from '../utils/formatLastSeen';

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const normalizar = (texto) => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function Pessoa({ pessoa, online }) {
  const ativos = pessoa.activeConversations || 0;
  const frase = online
    ? ativos > 0 ? plural(ativos, 'atendimento ativo', 'atendimentos ativos') : 'Disponível'
    : `Visto por último ${formatLastSeen(pessoa.lastSeenAt) || 'sem registro'}${ativos > 0 ? ` · ${plural(ativos, 'atendimento ativo', 'atendimentos ativos')}` : ''}`;
  const nome = `${pessoa.name}, ${online ? 'online' : 'offline'}, ${frase}`;
  return (
    <li aria-label={nome} className="flex h-14 items-center gap-3 px-4">
      <span className="relative shrink-0">
        <AgentAvatar agentId={pessoa.id} avatarPath={pessoa.avatarPath} name={pessoa.name} size={32} />
        {/* Presença por FORMA (P8): cheio = online, vazado = offline. Sem verde. */}
        <span aria-hidden="true" className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-tinta-2 ring-2 ring-painel ${online ? 'bg-tinta-2' : 'bg-painel'}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-corpo font-semibold text-tinta">{pessoa.name}</span>
        <span className="block truncate text-rotulo text-tinta-2">{frase}</span>
      </span>
    </li>
  );
}

function Secao({ titulo, pessoas, online }) {
  if (pessoas.length === 0) return null;
  return (
    <section className="border-b border-linha py-2 last:border-b-0">
      <h3 className="flex items-center justify-between px-4 py-1 text-rotulo font-medium text-tinta-2">
        {titulo} <span className="tabular-nums">{pessoas.length}</span>
      </h3>
      <ul>{pessoas.map((p) => <Pessoa key={p.id} pessoa={p} online={online} />)}</ul>
    </section>
  );
}

// Vista "Nossa equipe" DENTRO da coluna da lista (Apêndice E.3): consultar quem
// está livre olhando a conversa que se pensa transferir. Não é modal — ESC pela
// camada leve volta à lista.
function NossaEquipe({ agents, onlineIds, status, refresh, onVoltar }) {
  const [busca, setBusca] = useState('');
  const voltarRef = useRef(null);
  useCamadaLeve(true, onVoltar);
  useEffect(() => { if (voltarRef.current) voltarRef.current.focus(); }, []);

  const eOnline = (p) => onlineIds.has(p.id);
  const termo = normalizar(busca.trim());
  const visiveis = agents.filter((p) => !termo || normalizar(p.name).includes(termo));
  const emAtendimento = visiveis.filter((p) => eOnline(p) && (p.activeConversations || 0) > 0);
  const disponiveis = visiveis.filter((p) => eOnline(p) && !(p.activeConversations || 0));
  const offline = visiveis.filter((p) => !eOnline(p));
  const pronto = status === 'ready';

  return (
    <section aria-labelledby="nossa-equipe-titulo" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 pl-2 pr-4">
        <button ref={voltarRef} type="button" onClick={onVoltar} aria-label="Voltar para a lista" className="grid h-9 w-9 place-items-center rounded-ui-md text-tinta-2 hover:bg-hover hover:text-tinta">
          <IconArrowLeft size={20} />
        </button>
        <div className="min-w-0">
          <h2 id="nossa-equipe-titulo" className="font-display text-titulo font-semibold text-tinta">Nossa equipe</h2>
          {pronto && <p className="text-meta text-tinta-3">{`${plural(agents.length, 'integrante', 'integrantes')} · ${agents.filter(eOnline).length} online`}</p>}
        </div>
      </div>
      <div className="shrink-0 px-4 pb-2">
        <label className="flex h-9 items-center gap-2 rounded-ui-md bg-campo px-3 focus-within:outline focus-within:outline-2 focus-within:outline-focus-ring">
          <span aria-hidden="true" className="text-tinta-3"><IconSearch size={16} /></span>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar integrante" aria-label="Buscar integrante" className="min-w-0 flex-1 bg-transparent text-corpo text-tinta outline-none placeholder:text-tinta-3" />
        </label>
      </div>
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto">
        {status === 'loading' && (
          <div role="status" aria-live="polite">
            <span className="sr-only">Carregando…</span>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} data-esqueleto-linha="" aria-hidden="true" className="flex h-14 items-center gap-3 px-4">
                <span className="h-8 w-8 rounded-full bg-tinta-3/30" />
                <span className="flex flex-1 flex-col gap-2"><span className="h-3 w-2/5 rounded-full bg-tinta-3/30" /><span className="h-3 w-3/5 rounded-full bg-tinta-3/30" /></span>
              </div>
            ))}
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p role="alert" className="text-corpo text-tinta-2">Não foi possível carregar a equipe.</p>
            <button type="button" onClick={refresh} className="text-rotulo font-semibold text-accent-soft hover:underline">Tentar de novo</button>
          </div>
        )}
        {pronto && agents.length === 0 && <p className="px-6 py-10 text-center text-corpo text-tinta-2">Nenhum atendente cadastrado.</p>}
        {pronto && agents.length > 0 && visiveis.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-corpo text-tinta-2">Nada encontrado para “{busca.trim()}”</p>
            <button type="button" onClick={() => setBusca('')} className="text-rotulo font-semibold text-accent-soft hover:underline">Limpar busca</button>
          </div>
        )}
        {pronto && visiveis.length > 0 && (
          <>
            <Secao titulo="Em atendimento" pessoas={emAtendimento} online />
            <Secao titulo="Disponíveis" pessoas={disponiveis} online />
            <Secao titulo="Offline" pessoas={offline} online={false} />
          </>
        )}
      </div>
    </section>
  );
}

export default NossaEquipe;
```

(A frase "Nenhum atendente cadastrado." é a de hoje — o teste "barra da equipe abre" da `DashboardPage` continua achando `/nenhum atendente cadastrado/i`. `bg-tinta-3/30` no esqueleto: o mesmo valor que a Task 6 valida por contraste.)

`frontend/src/components/TeamPanel.jsx` inteiro:

```jsx
import { useEffect } from 'react';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';
import { useSocket } from '../contexts/SocketContext';
import { IconTeam } from './icons/IconesTrabalho';

// Eventos que mudam "quantos atendimentos cada um tem" (AgentsContext agrupa
// as rajadas — ganho publicado 20 → 8 pedidos, não pode regredir).
const REFRESH_EVENTS = ['conversation:assigned', 'conversation:closed', 'queue:removed', 'dashboard:conversation'];

export function ordenarEquipe(agents, onlineIds) {
  return [...agents].sort((a, b) => {
    const aOnline = onlineIds.has(a.id);
    const bOnline = onlineIds.has(b.id);
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// Barra de 44 px no rodapé da coluna: "Equipe · ● N online". Abre a vista
// "Nossa equipe" NA coluna (quem desenha é a DashboardPage). Sem chevron — a
// barra abre uma vista, não expande. A contagem tem vaga fixa.
function TeamPanel({ aberta = false, onAbrir, botaoRef }) {
  const { agents, status, refresh } = useAgents();
  const onlineIds = usePresence(agents);

  const online = agents.filter((p) => onlineIds.has(p.id)).length;

  function abrir() {
    if (typeof refresh === 'function') refresh();
    onAbrir();
  }

  return (
    <div className="shrink-0 border-t border-linha">
      <button ref={botaoRef} type="button" onClick={abrir} aria-expanded={aberta} className="flex h-11 w-full items-center gap-3 px-4 text-left transition-colors duration-120 hover:bg-hover">
        <span aria-hidden="true" className="text-tinta-2"><IconTeam size={20} /></span>
        <span className="text-corpo font-medium text-tinta">Equipe</span>
        <span className="ml-auto flex min-w-16 items-center justify-end gap-1.5 text-rotulo text-tinta-2">
          {status === 'error' ? (
            <span className="text-tinta-3">não carregou</span>
          ) : status === 'ready' ? (
            <>
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-tinta-2" />
              {online} online
            </>
          ) : null}
        </span>
      </button>
    </div>
  );
}

export default TeamPanel;
```

Na `DashboardPage.jsx`: estado `const [vistaDaColuna, setVistaDaColuna] = useState('lista');` e, dentro do `aside`, quando `vistaDaColuna === 'equipe'`, renderizar só `<NossaEquipe agents={ordenarEquipe(agents, onlineIds)} onlineIds={onlineIds} status={status} refresh={refresh} onVoltar={voltarDaEquipe} />` no lugar de cabeçalho/busca/abas/lista/barra. Os dados vêm dos mesmos hooks (`useAgents`, `usePresence`) chamados na página — o `AgentsContext` agrupa, e **não** há pedido novo (conferir com o guarda da E0). `voltarDaEquipe` volta a `'lista'` e devolve o foco à barra — **por efeito**, depois que ela reaparece (com a vista aberta a barra está desmontada, e um `focus()` dentro do próprio `voltarDaEquipe` não teria em quem focar):

```jsx
  const barraDaEquipeRef = useRef(null);
  const focarBarraRef = useRef(false);
  const voltarDaEquipe = useCallback(() => {
    focarBarraRef.current = true;
    setVistaDaColuna('lista');
  }, []);
  useEffect(() => {
    if (vistaDaColuna === 'lista' && focarBarraRef.current && barraDaEquipeRef.current) {
      focarBarraRef.current = false;
      barraDaEquipeRef.current.focus();
    }
  }, [vistaDaColuna]);
```

e a barra recebe `botaoRef={barraDaEquipeRef}`.

**Os eventos que atualizam a equipe saem da barra e vão para a mesa.** Só a `TeamPanel` ouvia `conversation:assigned`, `conversation:closed`, `queue:removed` e `dashboard:conversation` (o `AgentsContext` não ouve socket): com a vista "Nossa equipe" aberta a barra está desmontada, e a lista parava de se atualizar justo quando o atendente olha quem está livre. `frontend/src/hooks/useEquipeAoVivo.js`:

```js
import { useEffect } from 'react';
import { useAgents } from './useAgents';
import { useSocket } from '../contexts/SocketContext';

// Eventos que mudam "quantos atendimentos cada um tem". Ouvidos pela MESA
// (sempre montada), não pela barra da equipe, que sai de cena com a vista
// "Nossa equipe" aberta. O AgentsContext agrupa as rajadas — o ganho publicado
// de 20 → 8 pedidos não pode regredir (guarda da E0).
const REFRESH_EVENTS = ['conversation:assigned', 'conversation:closed', 'queue:removed', 'dashboard:conversation'];

export function useEquipeAoVivo() {
  const { refresh } = useAgents();
  const socket = useSocket();
  useEffect(() => {
    if (!socket || typeof refresh !== 'function') return undefined;
    const handler = () => refresh();
    REFRESH_EVENTS.forEach((event) => socket.on(event, handler));
    return () => REFRESH_EVENTS.forEach((event) => socket.off(event, handler));
  }, [socket, refresh]);
}
```

chamado uma vez no corpo da `DashboardPage` (`useEquipeAoVivo();`). Na `TeamPanel`, saem o efeito, o `useSocket`, o `useEffect` e o `REFRESH_EVENTS` (que muda de casa). O teste "busca a lista de novo quando um atendimento é assumido ou encerrado" (`TeamPanel.test.jsx:222`) muda de casa junto, para `frontend/src/hooks/useEquipeAoVivo.test.jsx`, com as mesmas asserções:

```jsx
import { describe, test, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEquipeAoVivo } from './useEquipeAoVivo';
import { useAgents } from './useAgents';
import { useSocket } from '../contexts/SocketContext';

vi.mock('./useAgents');
vi.mock('../contexts/SocketContext');

describe('useEquipeAoVivo', () => {
  test('busca a equipe de novo quando um atendimento é assumido ou encerrado', () => {
    const refresh = vi.fn();
    const handlers = {};
    useSocket.mockReturnValue({ on: vi.fn((event, handler) => { handlers[event] = handler; }), off: vi.fn() });
    useAgents.mockReturnValue({ agents: [], status: 'ready', refresh });
    renderHook(() => useEquipeAoVivo());
    handlers['conversation:assigned']();
    handlers['conversation:closed']();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
```

Na `DashboardPage.test.jsx`, acrescentar a volta do foco:

```jsx
  test('voltar da "Nossa equipe" devolve o foco à barra', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    await userEvent.click(screen.getByRole('button', { name: /^equipe/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Voltar para a lista' }));
    expect(screen.getByRole('button', { name: /^equipe/i })).toHaveFocus();
  });
``` A barra `<TeamPanel key={profileVersion} aberta={vistaDaColuna === 'equipe'} onAbrir={() => setVistaDaColuna('equipe')} />` fica no fim da lista, como hoje, e não é montada no trilho (`{!emRail && …}` — S18: hoje ela fica montada escondida).

Apagar `TeamModal.jsx` e as regras `.dialog-team-grupos`, `.dialog-team-grupo`, `[data-dialog=team] [role=group] button` e o seletor `[data-dialog=team] h2` de `overlays.css`.

- [ ] **Step 4: Rodar e ver passar; AgentsContext**

Run: `cd frontend && npx vitest run src/components/NossaEquipe.test.jsx src/components/TeamPanel.test.jsx src/contexts/AgentsContext.test.jsx src/pages/DashboardPage.test.jsx`
Expected: PASS — os 8 do `AgentsContext` sem mudança.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/components/NossaEquipe.jsx frontend/src/components/NossaEquipe.test.jsx frontend/src/components/TeamPanel.jsx frontend/src/components/TeamPanel.test.jsx frontend/src/components/TeamModal.jsx frontend/src/hooks/useEquipeAoVivo.js frontend/src/hooks/useEquipeAoVivo.test.jsx frontend/src/pages/DashboardPage.jsx frontend/src/pages/DashboardPage.test.jsx frontend/src/components/overlays.css
git commit -m "E2.3: Nossa equipe como vista na coluna da lista, sem fichas nem modal"
```

---

### Task 9: Mesa vazia e confirmação de sucesso

**Files:**
- Create: `frontend/src/components/MesaVazia.jsx`
- Modify: `frontend/src/pages/DashboardPage.jsx:295-310` e `avisarNaMesa`
- Modify: `frontend/src/pages/DashboardPage.test.jsx` (textos da mesa vazia), `frontend/src/App.test.jsx:39,54`

Spec 6.5: sem o título de 32 px em Sora light — ícone da conversa (48 px, tinta-3), "Selecione um atendimento na lista" e a nota de registro em 12 px. Apêndice E.3: depois de transferir, encerrar ou finalizar, a mesa vazia mostra por alguns segundos a confirmação ("Atendimento de Maria transferido para Pedro.") com ícone de confirmação em tinta neutra, no `role="status"` único da mesa (hoje a conversa só some).

- [ ] **Step 1: Atualizar os testes**

Em `DashboardPage.test.jsx`: "a tela sem conversa selecionada cita a empresa", "em carregamento não mostra Atendimento" e "sem empresa mostra só Atendimento" saem (o título saiu; `useCompanyName` não é mais lido pela mesa). "placeholder sem conversa" passa a `getByText('Selecione um atendimento na lista')`; os do modo estreito que usavam `'Net Fibra · Atendimento'` como marca da mesa vazia passam a usar a mesma frase. Em `App.test.jsx:39,54` e em `DashboardPage.test.jsx:308,373` (o `:373` é o de "clears the pending conversation…"), `/Selecione uma conversa/i` → `/Selecione um atendimento na lista/i`. Acrescentar (`act` entra no import de `@testing-library/react`):

```jsx
  test('depois de finalizar sem motivo, a mesa vazia confirma por alguns segundos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useQueue.mockReturnValue({ queue: [{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting' }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    closeConversation.mockResolvedValue({});
    renderDashboard();
    await userEvent.click(await screen.findByRole('tab', { name: /espera/i }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Finalizar sem motivo' })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/finalizado sem motivo/);
    act(() => vi.advanceTimersByTime(6100));
    expect(screen.getByRole('status')).toHaveTextContent('');
    vi.useRealTimers();
  });
```

- [ ] **Step 2: Implementar**

`frontend/src/components/MesaVazia.jsx`:

```jsx
import { IconChats, IconCheck, IconLock } from './icons/IconesTrabalho';

// Mesa sem conversa aberta (spec 6.5). O role="status" é o ÚNICO da mesa
// enquanto nenhuma conversa está aberta (a da conversa não está montada), e
// recebe a confirmação depois de transferir, encerrar ou finalizar — antes a
// conversa só sumia.
function MesaVazia({ aviso = null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span aria-hidden="true" className="text-tinta-3"><IconChats size={48} /></span>
      <p className="text-corpo text-tinta-2">Selecione um atendimento na lista</p>
      <p role="status" className="flex min-h-5 items-center gap-1.5 text-rotulo text-tinta">
        {aviso ? <><span aria-hidden="true" className="text-tinta-2"><IconCheck size={16} /></span>{aviso}</> : null}
      </p>
      <p className="mt-6 flex items-center gap-1.5 text-meta text-tinta-3">
        <IconLock size={12} aria-hidden="true" />
        Todo atendimento fica registrado no sistema.
      </p>
    </div>
  );
}

export default MesaVazia;
```

Na `DashboardPage.jsx`, no lugar do `<div>` da mesa vazia (`:295-310`): `<MesaVazia aviso={avisoDaMesa} />`; e, no lugar do `avisarNaMesa` provisório da Task 7:

```jsx
  const [avisoDaMesa, setAvisoDaMesa] = useState(null);
  const temporizadorDoAviso = useRef(null);
  const avisarNaMesa = useCallback((frase) => {
    clearTimeout(temporizadorDoAviso.current);
    setAvisoDaMesa(frase);
    temporizadorDoAviso.current = setTimeout(() => setAvisoDaMesa(null), 6000);
  }, []);
  useEffect(() => () => clearTimeout(temporizadorDoAviso.current), []);
```

`avisarNaMesa` também é passada à `ConversationView` (`onEncerrado`) e ao `TransferModal` (`onTransferido`) — as duas pontas são ligadas na E2.4 (Task 4) e na E2.5 (Task 2). `IconEmptyChat` deixa de ter uso: apagar `components/icons/WaIcons.jsx` e conferir `grep -rln "WaIcons" frontend/src | grep -v "/guardas/"` → nada (o guarda `entradaSemIcones.test.js` cita o nome na própria regex). E sai o import de `useCompanyName` da `DashboardPage`: a mesa vazia era o último uso.

- [ ] **Step 3: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.jsx src/App.test.jsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src/components/MesaVazia.jsx frontend/src/pages/DashboardPage.jsx frontend/src/pages/DashboardPage.test.jsx frontend/src/App.test.jsx frontend/src/components/icons/WaIcons.jsx
git commit -m "E2.3: mesa vazia simples, com a confirmacao de sucesso no status unico"
```

---

### Task 10: Fechamento da E2.3

**Files:**
- Modify: `frontend/src/estilo/acentoUnico.test.js` (`PENDENCIAS`)
- Modify: `ferramentas/medicao/lib/ganchos.mjs` (ganchos da lista)
- Modify: `docs/superpowers/specs/2026-09-24-redesenho-registro-E2.md`

- [ ] **Step 1: Pendências do acento**

Run: `cd frontend && npx vitest run src/estilo/acentoUnico.test.js`
Expected: FAIL em "a lista só encolhe", listando os arquivos que ficaram limpos — no mínimo `components/AppShell.jsx`, `components/ChannelStatusBanner.jsx`, `pages/DashboardPage.jsx`, e os apagados (`components/TeamModal.jsx`, `components/TransferNotice.jsx`, `components/side-nav.css`). Tirá-los de `PENDENCIAS` e rodar de novo até passar. `components/ConversationListItem.jsx` continua pendente só se a variante não compacta ainda tiver `chat-orange` (sai na E2.5).

- [ ] **Step 2: Ganchos do harness**

Em `ferramentas/medicao/lib/ganchos.mjs` (o arquivo que o próprio harness diz ser "o ÚNICO a revisar" quando o DOM muda), trocar os seletores da linha: `chat-conversation-name` → `linha-nome`, `chat-conversation-time` → `linha-hora`, `chat-conversation-snippet` → `linha-previa`, `chat-conversation-figure` → `linha-avatar`, o `title="Mensagem não lida"` continua; os de `chat-conversation-ai`/`-chip`/`-chip.is-dono` saem (não existem mais — anotar no README do harness que a medição M4 passa a contar as peças novas). Rodar o `smoke.mjs` contra o build:

Run: `cd frontend && npx vite build && cd .. && MSYS_NO_PATHCONV=1 MEDICAO_DIST=frontend/dist node ferramentas/medicao/diagnostico/smoke.mjs atendente /`
Expected: "itens na lista" > 0 e nenhum pedido não atendido novo.

- [ ] **Step 3: Pesos e CSS de entrada**

Run: `cd frontend && npx vite build --manifest && node ../ferramentas/medicao/pesos.mjs dist`
Expected: `login.css` ≤ o valor medido no fim da E2.2 (spec 12.2: o CSS de entrada não cresce em nenhuma etapa; o Tailwind gera ali todo utilitário novo, e as regras apagadas de `dashboard.css`/`side-nav.css` saem do CSS da mesa). Se crescer, listar os utilitários novos (`grep -o` no CSS de entrada) e trocar valores arbitrários por passos da escala.

- [ ] **Step 4: Registro S × C**

Acrescentar ao registro da E2 a seção "E2.3 — moldura, menu e lista", uma linha por item do Apêndice B (B.1, B.2) e do Apêndice E (Nossa equipe, Finalizar sem motivo, Menu da conta, Aviso de transferência, Faixa do canal, Avisos de conexão), com a classe. Exemplo das primeiras linhas:

| Elemento | Antes | Depois | Classe |
|---|---|---|---|
| Moldura da casca | 12 px de respiro, 12 de vão, halos | linhas de 1 px, sem halo | S |
| Menu | 196 px com grupos e "Recolher menu" em 3 rotas; 64 px na mesa | trilho único de 64 px | S |
| Item ativo do menu | fundo tingido + borda cobre | barra de 3 px + fundo + ícone no acento | S |
| Menu da conta | nome + "Minha conta" + chevron para baixo, 2 itens | só o avatar; cabeçalho nome + papel; divisória antes de Sair | S |
| Aviso de conexão | faixa flutuante 3 s + indicador; até 3 `role=status` | um indicador; região viva única | S |
| Faixa do canal | uma linha por canal, N links iguais | uma linha, um link com verbo | S |
| Item da lista | 68 px, 3 linhas, até 22 elementos | 72 px, 2 linhas | S |
| Fichas de cidade/setor, chip do responsável, filete | na linha | nome acessível, busca, painel Cliente | S |
| Aviso de transferência | toast 9 s sobre o compositor | marca na linha + região viva | S |
| Nossa equipe | modal central com 4 fichas | vista na coluna, 3 seções | S |
| Confirmação "Finalizar" | um diálogo por item, sem título, fecha antes da resposta | um por lista, título, nome, consequência, erro | S |
| Mesa vazia | ilustração 320×190 + título 32 px | ícone 48 + frase + confirmação de sucesso | S |
| Abas | pílula laranja cheia com bolinha | sublinhado de 2 px + número | C |
| Superfícies da coluna | vidro, 3 camadas | painel sólido | C |

- [ ] **Step 5: Suíte e commit**

Run: `cd frontend && npx vitest run`
Expected: verde, salvo as falhas antigas que a E0 ainda não tiver corrigido (listar pelo nome).

```bash
git add frontend/src/estilo/acentoUnico.test.js ferramentas/medicao/lib/ganchos.mjs ferramentas/medicao/README.md docs/superpowers/specs/2026-09-24-redesenho-registro-E2.md
git commit -m "E2.3: pendencias do acento, ganchos do harness e registro S x C"
```
