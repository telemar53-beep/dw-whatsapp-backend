# Mobile Responsiveness (Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the attendant dashboard (and the screens it opens) usable on a phone-sized screen, without changing anything about the desktop layout.

**Architecture:** Pure Tailwind CSS changes to existing components — no new components, no new state beyond what already exists, no backend changes. The `DashboardPage`'s existing `selectedId`/`selectedConversation` state (already there for picking which conversation to show) doubles as the mobile list↔conversation toggle: below Tailwind's `md` breakpoint (768px), the sidebar and the conversation panel are mutually exclusive (`hidden`/`block` based on whether a conversation is selected); at `md` and above, both stay always-visible exactly as today (an `md:block` override on both).

**Tech Stack:** React + Tailwind CSS v4 (already in place, no new dependencies).

**Spec:** none — this was brainstormed as a bounded task (existing screens only, no new concept), approved directly in chat, not written up as a separate design doc. This plan is the record of what was agreed.

## Global Constraints

- Breakpoint: Tailwind's default `md:` (768px) separates "compact/mobile" from "desktop" layout everywhere in this plan. Below `md` is compact; `md` and above must look and behave exactly as it does today (verify with existing tests, which run without any breakpoint simulation and therefore exercise the "no `md:` override active" — i.e. compact — code path; the `md:` classes themselves are Tailwind CSS the test runner doesn't evaluate, but their presence in the rendered className is what a test can and must assert on).
- Scope for this plan: `DashboardPage` and the screens it opens (`ConversationView`, `ConversationHistoryModal`, `TransferModal`, `ChangePasswordModal`, `StartConversationModal`, `MessageInput`'s quick-replies popup) plus `LoginPage`. Explicitly OUT of scope: `AdminChannelsPage` (and its tabs) and `MetricsPage` — left exactly as they are.
- No backend changes, no new dependencies, no new components.
- Every existing test must keep passing unmodified unless this plan explicitly says to change it — Testing Library's queries (`getByText`, `getByRole`, etc.) are visibility-agnostic in jsdom (they find elements in the DOM regardless of a `hidden` CSS class, since jsdom doesn't compute `display: none` from Tailwind's stylesheet), so pre-existing assertions must keep passing unchanged by design, not by accident.
- Where this plan asks for a new test asserting responsive behavior, assert on the presence/absence of the literal `hidden` class in an element's `className` string (via `container.querySelector(...).className` and a `/\bhidden\b/` regex) — this project's test setup (Vitest + jsdom) does not evaluate CSS media queries, so this is the only meaningful way to verify the conditional logic is wired correctly.

---

### Task 1: `DashboardPage` list↔conversation toggle

**Files:**
- Modify: `frontend/src/pages/DashboardPage.jsx` (whole file, 96 lines)
- Modify: `frontend/src/pages/DashboardPage.test.jsx` (add tests; existing tests unchanged)

**Interfaces:**
- Produces: `ConversationView` is now called with a new `onBack` prop (`() => setSelectedId(null)`), consumed by Task 2.
- No other interface changes — `queue`, `myConversations`, `selectedConversation` all keep their existing shapes.

- [ ] **Step 1: Write the failing tests**

`frontend/src/pages/DashboardPage.test.jsx` currently ends with (after the `'shows a Métricas link for any attendant'` test, right before the `'renders the team panel'` test — insert the new tests between them, or anywhere inside the `describe('DashboardPage', ...)` block; exact position doesn't matter, but keep them together):

```jsx
  test('shows the list and hides the conversation panel on mobile when nothing is selected', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    const { container } = renderDashboard();
    const aside = container.querySelector('aside');
    const main = container.querySelector('main');
    expect(aside.className).not.toMatch(/\bhidden\b/);
    expect(main.className).toMatch(/\bhidden\b/);
  });

  test('shows the conversation panel and hides the list on mobile when a conversation is selected', async () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }]);
    useMyConversations.mockReturnValue([]);
    const { container } = renderDashboard();
    await userEvent.click(screen.getByText('Carlos'));

    const aside = container.querySelector('aside');
    const main = container.querySelector('main');
    expect(main.className).not.toMatch(/\bhidden\b/);
    expect(aside.className).toMatch(/\bhidden\b/);
  });

  test('clicking the back button in the conversation view returns to the list', async () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }]);
    useMyConversations.mockReturnValue([]);
    const { container } = renderDashboard();
    await userEvent.click(screen.getByText('Carlos'));
    expect(container.querySelector('main').className).not.toMatch(/\bhidden\b/);

    await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));

    expect(container.querySelector('main').className).toMatch(/\bhidden\b/);
    expect(container.querySelector('aside').className).not.toMatch(/\bhidden\b/);
  });

  test('hides the dashboard header on mobile when a conversation is selected', async () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }]);
    useMyConversations.mockReturnValue([]);
    const { container } = renderDashboard();
    await userEvent.click(screen.getByText('Carlos'));

    expect(container.querySelector('header').className).toMatch(/\bhidden\b/);
  });
```

Note: the third test above (`'clicking the back button...'`) depends on Task 2's `ConversationView` rendering a button with accessible name "Voltar para a lista" and calling the `onBack` prop `DashboardPage` passes it — this is why Task 1 and Task 2 must both land before this specific test can pass; if executing Task 1 before Task 2, expect this one test to fail until Task 2's `ConversationView` change is in place (see the note in Task 2's own test step for the matching half of this).

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npx vitest run src/pages/DashboardPage.test.jsx`
Expected: the first two new tests (list/conversation `hidden` toggling) FAIL — today `aside` has no conditional class at all, so `main.className` never contains `hidden`. The third and fourth new tests also fail (no back button exists yet, and the header is never hidden).

- [ ] **Step 3: Implement the toggle**

Replace the full contents of `frontend/src/pages/DashboardPage.jsx` (currently 96 lines) with:

```jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import QueueList from '../components/QueueList';
import MyConversationsList from '../components/MyConversationsList';
import ConversationView from '../components/ConversationView';
import TransferModal from '../components/TransferModal';
import ChannelStatusBanner from '../components/ChannelStatusBanner';
import ChangePasswordModal from '../components/ChangePasswordModal';
import StartConversationModal from '../components/StartConversationModal';
import TeamPanel from '../components/TeamPanel';

function DashboardPage() {
  const { agent, logout } = useAuth();
  const queue = useQueue();
  const myConversations = useMyConversations();
  const [selectedId, setSelectedId] = useState(null);
  const [transferringId, setTransferringId] = useState(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);
  const [pendingConversation, setPendingConversation] = useState(null);

  const selectedConversation =
    [...queue, ...myConversations].find((c) => c.id === selectedId) ||
    (pendingConversation && pendingConversation.id === selectedId ? pendingConversation : null);

  useEffect(() => {
    if (pendingConversation && [...queue, ...myConversations].some((c) => c.id === pendingConversation.id)) {
      setPendingConversation(null);
    }
  }, [queue, myConversations, pendingConversation]);

  return (
    <div className="flex h-screen flex-col">
      <div className={selectedConversation ? 'hidden md:block' : ''}>
        <ChannelStatusBanner />
      </div>
      <header
        className={`${selectedConversation ? 'hidden md:flex' : 'flex'} items-center justify-between border-b border-gray-200 px-4 py-2`}
      >
        <h1 className="font-semibold text-gray-800">DW Telecom - Atendimento</h1>
        <div className="flex flex-wrap items-center gap-4">
          {agent?.role === 'admin' && (
            <Link to="/admin/channels" className="text-sm text-gray-500 hover:underline">
              Administração
            </Link>
          )}
          <Link to="/metrics" className="text-sm text-gray-500 hover:underline">
            Métricas
          </Link>
          <button onClick={() => setChangingPassword(true)} className="text-sm text-gray-500 hover:underline">
            Trocar senha
          </button>
          <button onClick={logout} className="text-sm text-gray-500 hover:underline">
            Sair
          </button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside
          className={`${selectedConversation ? 'hidden' : 'block'} w-full space-y-4 overflow-y-auto border-r border-gray-200 p-3 md:block md:w-64`}
        >
          <button
            onClick={() => setStartingConversation(true)}
            className="w-full rounded bg-green-600 px-3 py-2 text-sm text-white"
          >
            Iniciar conversa
          </button>
          <QueueList conversations={queue} onSelect={setSelectedId} />
          <MyConversationsList conversations={myConversations} onSelect={setSelectedId} />
          <TeamPanel />
        </aside>
        <main className={`${selectedConversation ? 'block' : 'hidden'} flex-1 md:block`}>
          {selectedConversation ? (
            <ConversationView
              conversation={selectedConversation}
              onTransferClick={setTransferringId}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <p className="flex h-full items-center justify-center text-gray-400">
              Selecione uma conversa na lista ao lado.
            </p>
          )}
        </main>
      </div>
      {transferringId && <TransferModal conversationId={transferringId} onClose={() => setTransferringId(null)} />}
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
      {startingConversation && (
        <StartConversationModal
          onClose={() => setStartingConversation(false)}
          onCreated={(conversation) => {
            setPendingConversation(conversation);
            setSelectedId(conversation.id);
            setStartingConversation(false);
          }}
        />
      )}
    </div>
  );
}

export default DashboardPage;
```

(This adds `flex-wrap` to the nav-links container too, so "Administração" / "Métricas" / "Trocar senha" / "Sair" wrap onto a second line instead of overflowing on a narrow screen, instead of a single always-scrolling row.)

- [ ] **Step 4: Run the tests**

Run (from `frontend/`): `npx vitest run src/pages/DashboardPage.test.jsx`
Expected: the two `hidden`-toggle tests and the header test now PASS. The back-button test still FAILS at this point — that's expected, it needs Task 2's `ConversationView` change too. All pre-existing tests in this file still PASS unchanged.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DashboardPage.jsx frontend/src/pages/DashboardPage.test.jsx
git commit -m "feat: toggle between list and conversation panel on mobile"
```

---

### Task 2: `ConversationView` back button + wrapping + fluid message bubbles (and `ConversationHistoryModal`'s matching bubble/width fix)

**Files:**
- Modify: `frontend/src/components/ConversationView.jsx` (whole file, 78 lines)
- Modify: `frontend/src/components/ConversationView.test.jsx` (add one test; existing tests unchanged)
- Modify: `frontend/src/components/ConversationHistoryModal.jsx` (whole file, 78 lines)

**Interfaces:**
- Consumes: the new `onBack` prop `DashboardPage` (Task 1) now passes to `ConversationView`.
- Produces: `ConversationView` now renders a button with accessible name "Voltar para a lista" (visible only below `md`) that calls `onBack` — this is what Task 1's `'clicking the back button...'` test (already written in Task 1, will now pass) depends on.

- [ ] **Step 1: Write the failing test**

Add this test to `frontend/src/components/ConversationView.test.jsx`, after the last existing test (`'opens the previous-conversations history modal for the conversation contact'`), before the `describe` block's closing `});`:

```jsx
  test('shows a back button that calls onBack when clicked', async () => {
    const onBack = vi.fn();
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
        onBack={onBack}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));
    expect(onBack).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/components/ConversationView.test.jsx`
Expected: FAIL — no button with that accessible name exists yet.

- [ ] **Step 3: Implement the change**

Replace the full contents of `frontend/src/components/ConversationView.jsx` (currently 78 lines) with:

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { claimConversation, closeConversation } from '../services/api';
import MessageInput from './MessageInput';
import MessageAttachment from './MessageAttachment';
import ConversationHistoryModal from './ConversationHistoryModal';

function ConversationView({ conversation, onTransferClick, onBack }) {
  const { token, agent } = useAuth();
  const { messages, sendMessage } = useConversationMessages(conversation.id);
  const { quickReplies } = useQuickReplies();
  const [showingHistory, setShowingHistory] = useState(false);

  const isUnassigned = conversation.status !== 'closed' && !conversation.assignedAgentId;
  const isMine = conversation.assignedAgentId === agent.id;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 p-3">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="rounded px-2 py-1 text-gray-500 md:hidden" aria-label="Voltar para a lista">
            ←
          </button>
          <h3 className="font-semibold text-gray-800">Conversa</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowingHistory(true)}
            className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700"
          >
            Ver atendimentos anteriores
          </button>
          {isUnassigned && (
            <button
              onClick={() => claimConversation(conversation.id, token)}
              className="rounded bg-green-600 px-3 py-1 text-sm text-white"
            >
              Assumir
            </button>
          )}
          {isMine && (
            <>
              <button
                onClick={() => onTransferClick(conversation.id)}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
              >
                Transferir
              </button>
              <button
                onClick={() => closeConversation(conversation.id, token)}
                className="rounded bg-gray-600 px-3 py-1 text-sm text-white"
              >
                Fechar
              </button>
            </>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-[85%] space-y-1 rounded px-3 py-2 text-sm ${
              message.direction === 'inbound' ? 'bg-gray-100 text-gray-800' : 'ml-auto bg-blue-100 text-gray-800'
            }`}
          >
            {message.content && <p>{message.content}</p>}
            <MessageAttachment message={message} />
          </div>
        ))}
      </div>
      {isMine && <MessageInput onSend={sendMessage} quickReplies={quickReplies} />}
      {showingHistory && (
        <ConversationHistoryModal contactId={conversation.contactId} onClose={() => setShowingHistory(false)} />
      )}
    </div>
  );
}

export default ConversationView;
```

Then replace the full contents of `frontend/src/components/ConversationHistoryModal.jsx` (currently 78 lines) with:

```jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getConversationHistory, getMessages } from '../services/api';
import MessageAttachment from './MessageAttachment';

function ConversationHistoryModal({ contactId, onClose }) {
  const { token } = useAuth();
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    getConversationHistory(contactId, token)
      .then(setHistory)
      .catch(() => {});
  }, [contactId, token]);

  function openConversation(conversation) {
    setSelected(conversation);
    getMessages(conversation.id, token)
      .then(setMessages)
      .catch(() => {});
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <div className="max-h-[80vh] w-[90vw] max-w-96 overflow-y-auto rounded bg-white p-4 shadow">
        {selected ? (
          <>
            <button onClick={() => setSelected(null)} className="mb-3 text-sm text-blue-600 underline">
              ← Voltar
            </button>
            <h3 className="mb-3 font-semibold text-gray-800">
              Atendimento em {new Date(selected.updatedAt).toLocaleDateString('pt-BR')} — {selected.channelName}
            </h3>
            <div className="space-y-2">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[85%] space-y-1 rounded px-3 py-2 text-sm ${
                    message.direction === 'inbound' ? 'bg-gray-100 text-gray-800' : 'ml-auto bg-blue-100 text-gray-800'
                  }`}
                >
                  {message.content && <p>{message.content}</p>}
                  <MessageAttachment message={message} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <h3 className="mb-3 font-semibold text-gray-800">Atendimentos anteriores</h3>
            {history.length === 0 && <p className="text-sm text-gray-500">Nenhum atendimento anterior encontrado.</p>}
            <ul className="mb-3 space-y-1">
              {history.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    onClick={() => openConversation(conversation)}
                    className="w-full rounded border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
                  >
                    <p className="text-sm text-gray-800">{new Date(conversation.updatedAt).toLocaleDateString('pt-BR')}</p>
                    <p className="text-xs text-gray-500">{conversation.channelName}</p>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <button onClick={onClose} className="w-full rounded bg-gray-200 py-2 text-sm text-gray-700">
          Fechar
        </button>
      </div>
    </div>
  );
}

export default ConversationHistoryModal;
```

(Only the outer `<div>`'s className and the two message-bubble classNames changed in `ConversationHistoryModal.jsx` — everything else is byte-for-byte the same as before.)

- [ ] **Step 4: Run the tests**

Run (from `frontend/`): `npx vitest run src/components/ConversationView.test.jsx src/components/ConversationHistoryModal.test.jsx src/pages/DashboardPage.test.jsx`
Expected: PASS, all tests in all three files — including Task 1's `'clicking the back button...'` test, which needed this task's change to pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ConversationView.jsx frontend/src/components/ConversationView.test.jsx frontend/src/components/ConversationHistoryModal.jsx
git commit -m "feat: add a mobile back button to the conversation view and use fluid widths for message bubbles"
```

---

### Task 3: Fluid widths for the remaining modals, the login form, and the quick-replies popup

**Files:**
- Modify: `frontend/src/components/TransferModal.jsx:16`
- Modify: `frontend/src/components/ChangePasswordModal.jsx:29`
- Modify: `frontend/src/components/StartConversationModal.jsx:47`
- Modify: `frontend/src/pages/LoginPage.jsx:29`
- Modify: `frontend/src/components/MessageInput.jsx:137`

**Interfaces:** none — every change in this task is a `className` string edit only; no props, no logic, no new tests are needed (none of these 5 files' existing tests assert on `className` values, and no behavior changes).

This task is 5 small, identical-shape edits (a fixed pixel width becomes a viewport-relative width capped at the original size) — batch them into one dispatch rather than one task each, per this project's usual practice for same-shape mechanical work.

- [ ] **Step 1: `TransferModal.jsx`**

Current (line 16):

```jsx
      <div className="w-72 rounded bg-white p-4 shadow">
```

New:

```jsx
      <div className="w-[90vw] max-w-72 rounded bg-white p-4 shadow">
```

- [ ] **Step 2: `ChangePasswordModal.jsx`**

Current (line 29):

```jsx
      <div className="w-80 rounded bg-white p-4 shadow">
```

New:

```jsx
      <div className="w-[90vw] max-w-80 rounded bg-white p-4 shadow">
```

- [ ] **Step 3: `StartConversationModal.jsx`**

Current (line 47):

```jsx
      <div className="w-80 rounded bg-white p-4 shadow">
```

New:

```jsx
      <div className="w-[90vw] max-w-80 rounded bg-white p-4 shadow">
```

- [ ] **Step 4: `LoginPage.jsx`**

Current (line 29):

```jsx
      <form onSubmit={handleSubmit} className="w-80 rounded bg-white p-6 shadow">
```

New:

```jsx
      <form onSubmit={handleSubmit} className="w-[90vw] max-w-80 rounded bg-white p-6 shadow">
```

- [ ] **Step 5: `MessageInput.jsx`**

Current (line 137):

```jsx
            <div className="absolute bottom-full left-0 z-10 mb-1 max-h-64 w-64 overflow-y-auto rounded border border-gray-200 bg-white p-2 shadow">
```

New:

```jsx
            <div className="absolute bottom-full left-0 z-10 mb-1 max-h-64 w-64 max-w-[90vw] overflow-y-auto rounded border border-gray-200 bg-white p-2 shadow">
```

- [ ] **Step 6: Run the full frontend suite**

Run (from `frontend/`): `npm test`
Expected: PASS, every test file green — these are pure styling edits, no test should need to change.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/TransferModal.jsx frontend/src/components/ChangePasswordModal.jsx frontend/src/components/StartConversationModal.jsx frontend/src/pages/LoginPage.jsx frontend/src/components/MessageInput.jsx
git commit -m "fix: use fluid widths for modals, login form, and the quick-replies popup on narrow screens"
```
