# Abas do dashboard + edição de contato e cidades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the dashboard sidebar into three tabs with counters (Andamento/Espera/Automação), let an attendant correct a contact's name and tag them with a city, and let an admin manage the list of served cities.

**Architecture:** The tab split is a pure frontend filter of data the app already fetches (no new backend route). Contact editing and cities are a new, minimal admin-managed list (mirroring the existing `sectors` feature almost exactly) plus one new `PATCH` endpoint on the contact resource, threaded through the same conversation-summary queries that already carry `contactDisplayName`/`contactAvatarPath`.

**Tech Stack:** Node.js/Express/PostgreSQL backend (Jest), React/Vite frontend (Vitest + Testing Library).

**Spec:** [docs/superpowers/specs/2026-09-08-dashboard-tabs-and-contact-cities-design.md](../specs/2026-09-08-dashboard-tabs-and-contact-cities-design.md)

## Global Constraints

- The three dashboard tabs are computed client-side from data `useQueue()`/`useMyConversations()` already fetch — no new backend route for the tab split itself. "Automação" = `triageState === 'pending'`; "Espera" = everything else in the queue; "Andamento" = `useMyConversations()`, unchanged.
- A contact has **at most one** city (a nullable `city_id` FK), never several.
- Cities support create + list + delete only — **no rename/update** in this delivery.
- Any authenticated attendant (not just admin) can edit a contact's name/city — it's a day-to-day correction, not system configuration.
- A contact's name field is optional — blank saves as `null`, falling back to the phone number everywhere it's displayed, same as today.
- New screens in the **admin area** (the "Cidades" tab) follow the glass/`teal-signal`/`ink-950` visual already in use there (copy `SectorsAdminTab.jsx`/`CreateSectorForm.jsx`'s exact classes). New screens in the **dashboard/conversation area** (tabs, edit-contact modal) follow that area's current plain style (copy `TransferModal.jsx`'s exact classes) — that area has not been redesigned yet by the parallel session doing the visual overhaul, and this plan does not restyle it.
- Deliberately out of scope, do not build: creating a brand-new contact from scratch (only editing contacts that already exist), live cross-tab/cross-window updates when a contact is edited (the editor's own currently-open conversation updates immediately; everywhere else updates on next load, matching this project's existing pattern for similar low-priority live-update gaps).

---

### Task 1: Dashboard tabs (Andamento / Espera / Automação)

**Files:**
- Modify: `frontend/src/components/QueueList.jsx`
- Modify: `frontend/src/pages/DashboardPage.jsx`
- Modify: `frontend/src/pages/DashboardPage.test.jsx`

**Interfaces:**
- Produces: `<QueueList conversations onSelect title? emptyMessage? />` — `title` defaults to `'Fila de espera'`, `emptyMessage` defaults to `'Nenhuma conversa aguardando.'` (today's hardcoded values), both overridable.
- No backend interface — this task is fully self-contained, no dependency on any other task in this plan.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `frontend/src/pages/DashboardPage.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from './DashboardPage';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useChannels } from '../hooks/useChannels';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueue');
vi.mock('../hooks/useMyConversations');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents', () => ({ useAgents: () => [] }));
vi.mock('../hooks/usePresence', () => ({ usePresence: () => new Set() }));
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../components/StartConversationModal', () => ({
  default: ({ onCreated }) => (
    <button
      onClick={() =>
        onCreated({ id: 'conv-new', contactPhoneNumber: '5598999990000', assignedAgentId: 'agent-1', status: 'assigned' })
      }
    >
      Mock Start Conversation
    </button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' }, logout: vi.fn() });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
});

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
}

describe('DashboardPage', () => {
  test('shows my conversations in the Andamento tab by default', () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos' }]);
    useMyConversations.mockReturnValue([{ id: 'c2', contactDisplayName: 'Maria' }]);
    renderDashboard();
    expect(screen.getByText('Maria')).toBeInTheDocument();
    expect(screen.queryByText('Carlos')).not.toBeInTheDocument();
  });

  test('shows the queue in the Espera tab after clicking it', async () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos' }]);
    useMyConversations.mockReturnValue([{ id: 'c2', contactDisplayName: 'Maria' }]);
    renderDashboard();

    await userEvent.click(screen.getByRole('button', { name: /espera/i }));

    expect(screen.getByText('Carlos')).toBeInTheDocument();
    expect(screen.queryByText('Maria')).not.toBeInTheDocument();
  });

  test('separates conversations still in automatic triage into the Automação tab', async () => {
    useQueue.mockReturnValue([
      { id: 'c1', contactDisplayName: 'Aguardando', triageState: null },
      { id: 'c2', contactDisplayName: 'Em Triagem', triageState: 'pending' },
    ]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();

    await userEvent.click(screen.getByRole('button', { name: /espera/i }));
    expect(screen.getByText('Aguardando')).toBeInTheDocument();
    expect(screen.queryByText('Em Triagem')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /automação/i }));
    expect(screen.getByText('Em Triagem')).toBeInTheDocument();
    expect(screen.queryByText('Aguardando')).not.toBeInTheDocument();
  });

  test('shows a badge with the count on each tab', () => {
    useQueue.mockReturnValue([
      { id: 'c1', contactDisplayName: 'Aguardando', triageState: null },
      { id: 'c2', contactDisplayName: 'Em Triagem', triageState: 'pending' },
    ]);
    useMyConversations.mockReturnValue([{ id: 'c3', contactDisplayName: 'Minha' }]);
    renderDashboard();

    expect(screen.getByRole('button', { name: /andamento/i }).textContent).toContain('1');
    expect(screen.getByRole('button', { name: /espera/i }).textContent).toContain('1');
    expect(screen.getByRole('button', { name: /automação/i }).textContent).toContain('1');
  });

  test('does not show a badge on a tab with no items', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();

    const inProgressButton = screen.getByRole('button', { name: /andamento/i });
    expect(inProgressButton.querySelector('span')).not.toBeInTheDocument();
  });

  test('selecting a conversation from the Espera tab opens the conversation view', async () => {
    useQueue.mockReturnValue([{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    await userEvent.click(screen.getByRole('button', { name: /espera/i }));
    await userEvent.click(screen.getByText('Carlos'));
    expect(screen.getByRole('button', { name: /assumir/i })).toBeInTheDocument();
  });

  test('shows a placeholder when no conversation is selected', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByText(/selecione uma conversa/i)).toBeInTheDocument();
  });

  test('shows an Administração link for an admin agent', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'admin' }, logout: vi.fn() });
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByRole('link', { name: /administração/i })).toBeInTheDocument();
  });

  test('hides the Administração link for a non-admin agent', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.queryByRole('link', { name: /administração/i })).not.toBeInTheDocument();
  });

  test('opens the change-password modal from the header', async () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();

    expect(screen.queryByText(/trocar minha senha/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^trocar senha$/i }));

    expect(screen.getByText(/trocar minha senha/i)).toBeInTheDocument();
  });

  test('shows an Iniciar conversa button for any attendant', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByRole('button', { name: /iniciar conversa/i })).toBeInTheDocument();
  });

  test('starting a conversation opens it immediately, even before it appears in myConversations', async () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();

    await userEvent.click(screen.getByRole('button', { name: /iniciar conversa/i }));
    await userEvent.click(screen.getByText('Mock Start Conversation'));

    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();
  });

  test('clears the pending conversation once it appears in myConversations, so a later close is not masked by stale state', async () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    const { rerender } = renderDashboard();

    await userEvent.click(screen.getByRole('button', { name: /iniciar conversa/i }));
    await userEvent.click(screen.getByText('Mock Start Conversation'));
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();

    useMyConversations.mockReturnValue([
      { id: 'conv-new', contactPhoneNumber: '5598999990000', assignedAgentId: 'agent-1', status: 'assigned' },
    ]);
    rerender(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();

    useMyConversations.mockReturnValue([]);
    rerender(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
    expect(screen.getByText(/selecione uma conversa/i)).toBeInTheDocument();
  });

  test('shows a Métricas link for any attendant', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByRole('link', { name: /métricas/i })).toBeInTheDocument();
  });

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
    await userEvent.click(screen.getByRole('button', { name: /espera/i }));
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
    await userEvent.click(screen.getByRole('button', { name: /espera/i }));
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
    await userEvent.click(screen.getByRole('button', { name: /espera/i }));
    await userEvent.click(screen.getByText('Carlos'));

    expect(container.querySelector('header').className).toMatch(/\bhidden\b/);
    expect(container.querySelector('[data-testid="channel-banner-wrapper"]').className).toMatch(/\bhidden\b/);
  });

  test('uses the dynamic viewport height unit so mobile browser chrome cannot cover the composer', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    const { container } = renderDashboard();
    expect(container.firstChild.className).toContain('h-dvh');
  });

  test('renders the team panel', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByText('Equipe')).toBeInTheDocument();
    expect(screen.getByText(/nenhum atendente cadastrado/i)).toBeInTheDocument();
  });

  test('shows the sound toggle button reflecting the unmuted state', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    renderDashboard();
    expect(screen.getByRole('button', { name: /som ativado/i })).toBeInTheDocument();
  });

  test('shows the sound toggle button reflecting the muted state', () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    useQueueNotificationSound.mockReturnValue({ muted: true, toggleMuted: vi.fn() });
    renderDashboard();
    expect(screen.getByRole('button', { name: /som mutado/i })).toBeInTheDocument();
  });

  test('clicking the sound toggle button calls toggleMuted', async () => {
    useQueue.mockReturnValue([]);
    useMyConversations.mockReturnValue([]);
    const toggleMuted = vi.fn();
    useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted });
    renderDashboard();

    await userEvent.click(screen.getByRole('button', { name: /som ativado/i }));

    expect(toggleMuted).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run DashboardPage.test.jsx` (from `frontend/`)
Expected: FAIL — most tests fail because `useQueue`'s items render unconditionally today (no "Espera"/"Automação"/"Andamento" tab buttons exist yet), so `getByRole('button', { name: /espera/i })` etc. cannot be found.

- [ ] **Step 3: Modify `frontend/src/components/QueueList.jsx`**

```jsx
import ConversationListItem from './ConversationListItem';

function QueueList({ conversations, onSelect, title = 'Fila de espera', emptyMessage = 'Nenhuma conversa aguardando.' }) {
  return (
    <div>
      <h2 className="mb-2 font-semibold text-gray-700">{title}</h2>
      {conversations.length === 0 ? (
        <p className="text-sm text-gray-400">{emptyMessage}</p>
      ) : (
        <ul className="space-y-1">
          {conversations.map((conversation) => (
            <ConversationListItem key={conversation.id} conversation={conversation} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default QueueList;
```

- [ ] **Step 4: Replace the full contents of `frontend/src/pages/DashboardPage.jsx`**

```jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import QueueList from '../components/QueueList';
import MyConversationsList from '../components/MyConversationsList';
import ConversationView from '../components/ConversationView';
import TransferModal from '../components/TransferModal';
import ChannelStatusBanner from '../components/ChannelStatusBanner';
import ChangePasswordModal from '../components/ChangePasswordModal';
import StartConversationModal from '../components/StartConversationModal';
import TeamPanel from '../components/TeamPanel';

const TABS = [
  { value: 'inProgress', label: 'Andamento' },
  { value: 'waiting', label: 'Espera' },
  { value: 'automation', label: 'Automação' },
];

function TabBadge({ count }) {
  if (count === 0) return null;
  return (
    <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white">
      {count}
    </span>
  );
}

function DashboardPage() {
  const { agent, logout } = useAuth();
  const queue = useQueue();
  const myConversations = useMyConversations();
  const { muted, toggleMuted } = useQueueNotificationSound();
  const [activeTab, setActiveTab] = useState('inProgress');
  const [selectedId, setSelectedId] = useState(null);
  const [transferringId, setTransferringId] = useState(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);
  const [pendingConversation, setPendingConversation] = useState(null);

  const waitingConversations = queue.filter((c) => c.triageState !== 'pending');
  const automationConversations = queue.filter((c) => c.triageState === 'pending');

  const tabCounts = {
    inProgress: myConversations.length,
    waiting: waitingConversations.length,
    automation: automationConversations.length,
  };

  const selectedConversation =
    [...queue, ...myConversations].find((c) => c.id === selectedId) ||
    (pendingConversation && pendingConversation.id === selectedId ? pendingConversation : null);

  useEffect(() => {
    if (pendingConversation && [...queue, ...myConversations].some((c) => c.id === pendingConversation.id)) {
      setPendingConversation(null);
    }
  }, [queue, myConversations, pendingConversation]);

  return (
    <div className="flex h-dvh flex-col">
      <div data-testid="channel-banner-wrapper" className={selectedConversation ? 'hidden md:block' : ''}>
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
          <button
            onClick={toggleMuted}
            aria-pressed={muted}
            title={muted ? 'Ativar som de notificações' : 'Mutar som de notificações'}
            className="text-sm text-gray-500 hover:underline"
          >
            {muted ? '🔕 Som mutado' : '🔔 Som ativado'}
          </button>
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
          <div className="flex rounded border border-gray-200">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={`flex-1 px-2 py-2 text-xs font-medium ${
                  activeTab === tab.value ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {tab.label}
                <TabBadge count={tabCounts[tab.value]} />
              </button>
            ))}
          </div>
          {activeTab === 'inProgress' && <MyConversationsList conversations={myConversations} onSelect={setSelectedId} />}
          {activeTab === 'waiting' && (
            <QueueList
              conversations={waitingConversations}
              onSelect={setSelectedId}
              title="Espera"
              emptyMessage="Nenhuma conversa aguardando."
            />
          )}
          {activeTab === 'automation' && (
            <QueueList
              conversations={automationConversations}
              onSelect={setSelectedId}
              title="Automação"
              emptyMessage="Nenhuma conversa em triagem automática."
            />
          )}
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

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --run DashboardPage.test.jsx` (from `frontend/`)
Expected: PASS (all tests).

- [ ] **Step 6: Run the full frontend suite to confirm no regressions**

Run: `npm test -- --run` (from `frontend/`)
Expected: PASS (all test files — baseline was 255/255 clean before this task).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/QueueList.jsx frontend/src/pages/DashboardPage.jsx frontend/src/pages/DashboardPage.test.jsx
git commit -m "feat: split the dashboard sidebar into Andamento/Espera/Automação tabs"
```

---

### Task 2: `cities` table and `city.repository.js`

**Files:**
- Create: `migrations/1788770000000_create-cities-table.js`
- Create: `src/cities/city.repository.js`
- Test: `src/cities/city.repository.test.js`

**Interfaces:**
- Produces: `listCities()` → `Promise<Array<{id, name, createdAt}>>`, ordered by name ascending.
- Produces: `createCity({ name })` → `Promise<{id, name, createdAt}>`.
- Produces: `deleteCity(id)` → `Promise<boolean>` (true if a row was deleted).
- Produces: DB column `contacts.city_id UUID REFERENCES cities(id) ON DELETE SET NULL` (nullable) — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `src/cities/city.repository.test.js`:

```js
const { getPool, closePool } = require('../db/pool');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { listCities, createCity, deleteCity } = require('./city.repository');

describe('city repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE cities, contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createCity stores and returns a city', async () => {
    const city = await createCity({ name: 'Bahia' });
    expect(city.id).toBeDefined();
    expect(city.name).toBe('Bahia');
    expect(city.createdAt).toBeDefined();
  });

  test('listCities returns an empty array when there are none', async () => {
    const cities = await listCities();
    expect(cities).toEqual([]);
  });

  test('listCities returns all cities ordered by name', async () => {
    await createCity({ name: 'Zebra' });
    await createCity({ name: 'Abelha' });

    const cities = await listCities();

    expect(cities.map((c) => c.name)).toEqual(['Abelha', 'Zebra']);
  });

  test('deleteCity removes the row and returns true', async () => {
    const city = await createCity({ name: 'Para excluir' });

    const deleted = await deleteCity(city.id);

    expect(deleted).toBe(true);
    expect(await listCities()).toEqual([]);
  });

  test('deleteCity returns false when the id does not exist', async () => {
    const deleted = await deleteCity('00000000-0000-0000-0000-000000000000');
    expect(deleted).toBe(false);
  });

  test('deleting a city that has an associated contact leaves the contact without a city instead of blocking', async () => {
    const city = await createCity({ name: 'Bahia' });
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    await getPool().query('UPDATE contacts SET city_id = $2 WHERE id = $1', [contact.id, city.id]);

    const deleted = await deleteCity(city.id);

    expect(deleted).toBe(true);
    const result = await getPool().query('SELECT city_id FROM contacts WHERE id = $1', [contact.id]);
    expect(result.rows[0].city_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/cities/city.repository.test.js`
Expected: FAIL — `Cannot find module './city.repository'`, and the `contacts.city_id` column does not exist yet.

- [ ] **Step 3: Create `migrations/1788770000000_create-cities-table.js`**

```js
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE cities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE contacts ADD COLUMN city_id UUID REFERENCES cities(id) ON DELETE SET NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE contacts DROP COLUMN city_id;
    DROP TABLE cities;
  `);
};
```

- [ ] **Step 4: Apply the migration to the test database**

Run: `npm run migrate:test -- up`
Expected: reports the new migration applied.

- [ ] **Step 5: Create `src/cities/city.repository.js`**

```js
const { getPool } = require('../db/pool');

function toCity(row) {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

async function listCities() {
  const result = await getPool().query('SELECT id, name, created_at FROM cities ORDER BY name ASC');
  return result.rows.map(toCity);
}

async function createCity({ name }) {
  const result = await getPool().query('INSERT INTO cities (name) VALUES ($1) RETURNING id, name, created_at', [name]);
  return toCity(result.rows[0]);
}

async function deleteCity(id) {
  const result = await getPool().query('DELETE FROM cities WHERE id = $1', [id]);
  return result.rowCount > 0;
}

module.exports = { listCities, createCity, deleteCity };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- src/cities/city.repository.test.js`
Expected: PASS (all 6 tests).

- [ ] **Step 7: Commit**

```bash
git add migrations/1788770000000_create-cities-table.js src/cities/city.repository.js src/cities/city.repository.test.js
git commit -m "feat: add cities table and city repository"
```

---

### Task 3: `contact.repository.js` gains `updateContact` and `cityId`

**Files:**
- Modify: `src/conversations/contact.repository.js`
- Modify: `src/conversations/contact.repository.test.js`

**Interfaces:**
- Consumes: `createCity({ name })` (Task 2, `../cities/city.repository`).
- Produces: `toContact(row)` output (used by every function in this file) now includes `cityId: string | null`.
- Produces: `updateContact(id, { displayName, cityId })` → `Promise<Contact | null>` — `Contact` is the same shape `toContact` returns; `null` when the id doesn't exist.

- [ ] **Step 1: Write the failing tests**

In `src/conversations/contact.repository.test.js`, add `createCity` to the imports (new import line, alongside the existing ones):

```js
const { createCity } = require('../cities/city.repository');
```

Add `updateContact` to the existing `require('./contact.repository')` destructure:

```js
const {
  findOrCreateContactByPhoneNumber,
  setContactAvatarPath,
  findContactById,
  updateContact,
  listContactsMissingAvatarForBaileysBackfill,
} = require('./contact.repository');
```

Add these 3 tests right after the existing `'findContactById returns null for an unknown id'` test, before the `describe('listContactsMissingAvatarForBaileysBackfill', ...)` block:

```js
  test('updateContact updates the display name and city', async () => {
    const city = await createCity({ name: 'Bahia' });
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');

    const updated = await updateContact(contact.id, { displayName: 'Maria Editada', cityId: city.id });

    expect(updated.displayName).toBe('Maria Editada');
    expect(updated.cityId).toBe(city.id);
  });

  test('updateContact with cityId null removes the city', async () => {
    const city = await createCity({ name: 'Bahia' });
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    await updateContact(contact.id, { displayName: 'Maria', cityId: city.id });

    const updated = await updateContact(contact.id, { displayName: 'Maria', cityId: null });

    expect(updated.cityId).toBeNull();
  });

  test('updateContact returns null when the id does not exist', async () => {
    const updated = await updateContact('00000000-0000-0000-0000-000000000000', { displayName: 'X', cityId: null });
    expect(updated).toBeNull();
  });
```

Also change the `beforeEach`'s truncate to include `cities` (cities must start empty for the new tests too, since `contacts.city_id` references it). Combine it into the same statement rather than a second `TRUNCATE cities CASCADE` call — `TRUNCATE ... CASCADE` also truncates tables that reference the named table, so a separate `TRUNCATE cities CASCADE` would cascade back into `contacts`; one combined statement avoids that:

```js
  beforeEach(async () => {
    await getPool().query('TRUNCATE contacts, cities CASCADE');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/conversations/contact.repository.test.js`
Expected: FAIL — `updateContact` is not exported, and `contact.cityId` is `undefined` on existing calls.

- [ ] **Step 3: Replace the full contents of `src/conversations/contact.repository.js`**

```js
const { getPool } = require('../db/pool');

function toContact(row) {
  return {
    id: row.id,
    phoneNumber: row.phone_number,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    cityId: row.city_id,
    createdAt: row.created_at,
  };
}

async function findOrCreateContactByPhoneNumber(phoneNumber, displayName) {
  const existing = await getPool().query(
    'SELECT id, phone_number, display_name, avatar_path, city_id, created_at FROM contacts WHERE phone_number = $1',
    [phoneNumber]
  );
  if (existing.rowCount > 0) {
    return { ...toContact(existing.rows[0]), wasCreated: false };
  }
  const inserted = await getPool().query(
    `INSERT INTO contacts (phone_number, display_name) VALUES ($1, $2)
     ON CONFLICT (phone_number) DO UPDATE SET phone_number = EXCLUDED.phone_number
     RETURNING id, phone_number, display_name, avatar_path, city_id, created_at`,
    [phoneNumber, displayName || null]
  );
  return { ...toContact(inserted.rows[0]), wasCreated: true };
}

async function setContactAvatarPath(contactId, avatarPath) {
  await getPool().query('UPDATE contacts SET avatar_path = $2 WHERE id = $1', [contactId, avatarPath]);
}

async function findContactById(id) {
  const result = await getPool().query(
    'SELECT id, phone_number, display_name, avatar_path, city_id, created_at FROM contacts WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toContact(result.rows[0]);
}

async function updateContact(id, { displayName, cityId }) {
  const result = await getPool().query(
    `UPDATE contacts SET display_name = $2, city_id = $3 WHERE id = $1
     RETURNING id, phone_number, display_name, avatar_path, city_id, created_at`,
    [id, displayName || null, cityId || null]
  );
  if (result.rowCount === 0) return null;
  return toContact(result.rows[0]);
}

async function listContactsMissingAvatarForBaileysBackfill() {
  const result = await getPool().query(`
    SELECT DISTINCT ON (ct.id) ct.id AS contact_id, ct.phone_number, c.channel_id
    FROM contacts ct
    JOIN conversations c ON c.contact_id = ct.id
    JOIN channels ch ON ch.id = c.channel_id AND ch.type = 'baileys'
    WHERE ct.avatar_path IS NULL
    ORDER BY ct.id, c.updated_at DESC
  `);
  return result.rows.map((row) => ({
    contactId: row.contact_id,
    phoneNumber: row.phone_number,
    channelId: row.channel_id,
  }));
}

module.exports = {
  findOrCreateContactByPhoneNumber,
  setContactAvatarPath,
  findContactById,
  updateContact,
  listContactsMissingAvatarForBaileysBackfill,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/conversations/contact.repository.test.js`
Expected: PASS (all tests, including the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/conversations/contact.repository.js src/conversations/contact.repository.test.js
git commit -m "feat: add updateContact and surface cityId on the contact repository"
```

---

### Task 4: Surface `contactCityId`/`contactCityName` on conversation summaries

**Files:**
- Modify: `src/conversations/conversation.repository.js`
- Modify: `src/conversations/conversation.repository.test.js`

**Interfaces:**
- Consumes: `createCity({ name })` (Task 2); `updateContact(id, { displayName, cityId })` (Task 3).
- Produces: `toConversationSummary(row)` output (used by `getConversationWithContact`, `listWaitingConversations`, `listConversationsByAgent`) now includes `contactCityId: string | null` and `contactCityName: string | null`.

- [ ] **Step 1: Write the failing tests**

In `src/conversations/conversation.repository.test.js`, add these two imports at the top, alongside the existing ones:

```js
const { createCity } = require('../cities/city.repository');
const { updateContact } = require('./contact.repository');
```

Add these tests right after the existing `'getConversationWithContact includes the contact avatar path'`/`'getConversationWithContact has a null contactAvatarPath...'` tests:

```js
  test('getConversationWithContact includes the contact city', async () => {
    const city = await createCity({ name: 'Bahia' });
    await updateContact(contactId, { displayName: 'Joao', cityId: city.id });
    const conversation = await createConversation(contactId, channelId);

    const result = await getConversationWithContact(conversation.id);

    expect(result.contactCityId).toBe(city.id);
    expect(result.contactCityName).toBe('Bahia');
  });

  test('getConversationWithContact has null contactCityId/contactCityName when the contact has no city', async () => {
    const conversation = await createConversation(contactId, channelId);

    const result = await getConversationWithContact(conversation.id);

    expect(result.contactCityId).toBeNull();
    expect(result.contactCityName).toBeNull();
  });
```

Add this test right after the existing `'listWaitingConversations includes the contact avatar path'` test:

```js
  test('listWaitingConversations includes the contact city', async () => {
    const city = await createCity({ name: 'Bahia' });
    await updateContact(contactId, { displayName: 'Joao', cityId: city.id });
    await createConversation(contactId, channelId);

    const waiting = await listWaitingConversations();

    expect(waiting[0].contactCityId).toBe(city.id);
    expect(waiting[0].contactCityName).toBe('Bahia');
  });
```

Add this test right after the existing `'listConversationsByAgent includes the contact avatar path'` test:

```js
  test('listConversationsByAgent includes the contact city', async () => {
    const city = await createCity({ name: 'Bahia' });
    await updateContact(contactId, { displayName: 'Joao', cityId: city.id });
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'listagent5@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent.id);

    const mine = await listConversationsByAgent(agent.id);

    expect(mine[0].contactCityId).toBe(city.id);
    expect(mine[0].contactCityName).toBe('Bahia');
  });
```

Also add `TRUNCATE cities CASCADE` to the file's top-level `beforeEach` (alongside the existing truncate of `conversations, contacts, channels, agents, conversation_events, sectors`):

```js
  beforeEach(async () => {
    await getPool().query('TRUNCATE conversations, contacts, channels, agents, conversation_events, sectors, cities CASCADE');
    ...
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/conversations/conversation.repository.test.js`
Expected: FAIL — `contactCityId`/`contactCityName` are `undefined` on every result.

- [ ] **Step 3: Modify `src/conversations/conversation.repository.js`**

Change `toConversationSummary`:

```js
function toConversationSummary(row) {
  return {
    ...toConversation(row),
    contactPhoneNumber: row.contact_phone_number,
    contactDisplayName: row.contact_display_name,
    contactAvatarPath: row.contact_avatar_path,
    contactCityId: row.contact_city_id,
    contactCityName: row.contact_city_name,
    sectorName: row.sector_name,
  };
}
```

In `getConversationWithContact`, `listWaitingConversations`, and `listConversationsByAgent`, change the shared query shape. Each currently has this exact `FROM`/`JOIN` block:

```sql
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN sectors s ON s.id = c.sector_id
```

Change it to add a `cities` join, in all three functions:

```sql
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
```

And change the shared `SELECT` fragment (also present identically in all three functions):

```sql
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            s.name AS sector_name
```

to:

```sql
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name,
            s.name AS sector_name
```

(`listClosedConversationsByContact` does not join `contacts` at all and is intentionally left unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/conversations/conversation.repository.test.js`
Expected: PASS (all tests, including the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/conversations/conversation.repository.js src/conversations/conversation.repository.test.js
git commit -m "feat: surface contactCityId/contactCityName on conversation summary queries"
```

---

### Task 5: Backend routes — cities (open + admin) and `PATCH /api/contacts/:id`

**Files:**
- Create: `src/api/cities.routes.js`
- Create: `src/api/cities.routes.test.js`
- Create: `src/api/admin-cities.routes.js`
- Create: `src/api/admin-cities.routes.test.js`
- Modify: `src/api/contacts.routes.js`
- Modify: `src/api/contacts.routes.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `listCities()`, `createCity({ name })`, `deleteCity(id)` (Task 2); `updateContact(id, { displayName, cityId })` (Task 3).
- Produces: `GET /api/cities` (any authenticated agent) → `200` with the city list.
- Produces: `POST /api/admin/cities` (admin only) → `201` with the created city; `400` if `name` is missing/blank.
- Produces: `DELETE /api/admin/cities/:id` (admin only) → `204`; `404` if not found.
- Produces: `PATCH /api/contacts/:id` (any authenticated agent) → `200` with the updated contact; `404` if not found.

- [ ] **Step 1: Write the failing test files**

Create `src/api/cities.routes.test.js`:

```js
jest.mock('../cities/city.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listCities } = require('../cities/city.repository');
const citiesRoutes = require('./cities.routes');

function buildApp() {
  const app = express();
  app.use('/api/cities', citiesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/cities', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the city list for any authenticated agent', async () => {
    listCities.mockResolvedValue([{ id: 'city-1', name: 'Bahia', createdAt: new Date() }]);

    const res = await request(buildApp())
      .get('/api/cities')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'city-1', name: 'Bahia', createdAt: expect.any(String) }]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/cities');
    expect(res.status).toBe(401);
    expect(listCities).not.toHaveBeenCalled();
  });
});
```

Create `src/api/admin-cities.routes.test.js`:

```js
jest.mock('../cities/city.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createCity, deleteCity } = require('../cities/city.repository');
const adminCitiesRoutes = require('./admin-cities.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/cities', adminCitiesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('POST /api/admin/cities', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a new city', async () => {
    createCity.mockResolvedValue({ id: 'city-1', name: 'Bahia', createdAt: new Date() });

    const res = await request(buildApp())
      .post('/api/admin/cities')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Bahia' });

    expect(res.status).toBe(201);
    expect(createCity).toHaveBeenCalledWith({ name: 'Bahia' });
    expect(res.body.id).toBe('city-1');
  });

  test('returns 400 when name is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/cities')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({});

    expect(res.status).toBe(400);
    expect(createCity).not.toHaveBeenCalled();
  });

  test('returns 400 when name is only whitespace', async () => {
    const res = await request(buildApp())
      .post('/api/admin/cities')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '   ' });

    expect(res.status).toBe(400);
    expect(createCity).not.toHaveBeenCalled();
  });

  test('trims leading and trailing whitespace before creating', async () => {
    createCity.mockResolvedValue({ id: 'city-1', name: 'Bahia', createdAt: new Date() });

    const res = await request(buildApp())
      .post('/api/admin/cities')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '  Bahia  ' });

    expect(res.status).toBe(201);
    expect(createCity).toHaveBeenCalledWith({ name: 'Bahia' });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/cities')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Bahia' });

    expect(res.status).toBe(403);
    expect(createCity).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/cities/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes an existing city', async () => {
    deleteCity.mockResolvedValue(true);

    const res = await request(buildApp())
      .delete('/api/admin/cities/city-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(204);
    expect(deleteCity).toHaveBeenCalledWith('city-1');
  });

  test('returns 404 when the city does not exist', async () => {
    deleteCity.mockResolvedValue(false);

    const res = await request(buildApp())
      .delete('/api/admin/cities/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .delete('/api/admin/cities/city-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(403);
    expect(deleteCity).not.toHaveBeenCalled();
  });
});
```

In `src/api/contacts.routes.test.js`, change `buildApp()` to parse JSON bodies (needed for the new `PATCH` route):

```js
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/contacts', contactsRoutes);
  return app;
}
```

Add `updateContact` to the existing `require('../conversations/contact.repository')` destructure at the top of the file:

```js
const { findContactById, updateContact } = require('../conversations/contact.repository');
```

Add this new `describe` block at the end of the file, after the existing `describe('GET /api/contacts/:contactId/avatar', ...)` block:

```js
describe('PATCH /api/contacts/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates the contact and returns it', async () => {
    updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Maria Editada', cityId: 'city-1' });

    const res = await request(buildApp())
      .patch('/api/contacts/contact-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ displayName: 'Maria Editada', cityId: 'city-1' });

    expect(res.status).toBe(200);
    expect(updateContact).toHaveBeenCalledWith('contact-1', { displayName: 'Maria Editada', cityId: 'city-1' });
    expect(res.body.displayName).toBe('Maria Editada');
  });

  test('trims the display name and treats a missing cityId as null', async () => {
    updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Maria', cityId: null });

    const res = await request(buildApp())
      .patch('/api/contacts/contact-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ displayName: '  Maria  ' });

    expect(res.status).toBe(200);
    expect(updateContact).toHaveBeenCalledWith('contact-1', { displayName: 'Maria', cityId: null });
  });

  test('treats a blank display name as null', async () => {
    updateContact.mockResolvedValue({ id: 'contact-1', displayName: null, cityId: null });

    const res = await request(buildApp())
      .patch('/api/contacts/contact-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ displayName: '   ', cityId: null });

    expect(res.status).toBe(200);
    expect(updateContact).toHaveBeenCalledWith('contact-1', { displayName: null, cityId: null });
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).patch('/api/contacts/contact-1').send({ displayName: 'Maria' });
    expect(res.status).toBe(401);
    expect(updateContact).not.toHaveBeenCalled();
  });

  test('returns 404 when the contact does not exist', async () => {
    updateContact.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/api/contacts/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ displayName: 'Maria' });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/api/cities.routes.test.js src/api/admin-cities.routes.test.js src/api/contacts.routes.test.js`
Expected: FAIL — `Cannot find module './cities.routes'`, `Cannot find module './admin-cities.routes'`, and the new `PATCH` tests get 404 (no such route).

- [ ] **Step 3: Create `src/api/cities.routes.js`**

```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listCities } = require('../cities/city.repository');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const cities = await listCities();
  res.json(cities);
});

module.exports = router;
```

- [ ] **Step 4: Create `src/api/admin-cities.routes.js`**

```js
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { createCity, deleteCity } = require('../cities/city.repository');

const router = express.Router();

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name: rawName } = req.body || {};
  const name = (rawName || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const city = await createCity({ name });
  res.status(201).json(city);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const deleted = await deleteCity(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'City not found' });
  }
  res.status(204).send();
});

module.exports = router;
```

- [ ] **Step 5: Modify `src/api/contacts.routes.js`**

Add `requireAuth` and `updateContact` to the top of the file:

```js
const express = require('express');
const { verifyToken } = require('../auth/auth.service');
const { requireAuth } = require('../auth/auth.middleware');
const { findContactById, updateContact } = require('../conversations/contact.repository');
const { getMediaFilePath } = require('../media/media-storage');
```

Add a new route, after the existing `router.get('/:contactId/avatar', ...)` block and before `module.exports = router;`:

```js
router.patch('/:id', requireAuth, async (req, res) => {
  const { displayName: rawDisplayName, cityId } = req.body || {};
  const displayName = typeof rawDisplayName === 'string' ? rawDisplayName.trim() || null : null;
  const contact = await updateContact(req.params.id, { displayName, cityId: cityId || null });
  if (!contact) {
    return res.status(404).json({ error: 'Contact not found' });
  }
  res.json(contact);
});
```

- [ ] **Step 6: Mount the new routes in `src/server.js`**

Add the requires alongside the other route requires:

```js
const citiesRoutes = require('./api/cities.routes');
const adminCitiesRoutes = require('./api/admin-cities.routes');
```

Add the mounts alongside the other `app.use('/api/...')` lines, right after `app.use('/api/sectors', sectorsRoutes);` and right after `app.use('/api/admin/sectors', adminSectorsRoutes);` respectively:

```js
app.use('/api/cities', citiesRoutes);
```

```js
app.use('/api/admin/cities', adminCitiesRoutes);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- src/api/cities.routes.test.js src/api/admin-cities.routes.test.js src/api/contacts.routes.test.js`
Expected: PASS (all tests).

- [ ] **Step 8: Run the full backend suite to confirm no regressions**

Run: `npm test`
Expected: PASS (all test files — the pre-existing ~3-4 known-flaky failures in `src/queue/outbound-queue.test.js`, an unrelated environmental Redis-queue-contention issue on this machine, are the expected baseline).

- [ ] **Step 9: Commit**

```bash
git add src/api/cities.routes.js src/api/cities.routes.test.js src/api/admin-cities.routes.js src/api/admin-cities.routes.test.js src/api/contacts.routes.js src/api/contacts.routes.test.js src/server.js
git commit -m "feat: add cities routes and PATCH /api/contacts/:id"
```

---

### Task 6: Cities admin tab (frontend)

**Files:**
- Modify: `frontend/src/services/api.js`
- Create: `frontend/src/hooks/useCities.js`
- Create: `frontend/src/components/CreateCityForm.jsx`
- Create: `frontend/src/components/CreateCityForm.test.jsx`
- Create: `frontend/src/components/CitiesAdminTab.jsx`
- Create: `frontend/src/components/CitiesAdminTab.test.jsx`
- Modify: `frontend/src/pages/AdminChannelsPage.jsx`
- Modify: `frontend/src/pages/AdminChannelsPage.test.jsx`

**Interfaces:**
- Consumes: `GET /api/cities`, `POST /api/admin/cities`, `DELETE /api/admin/cities/:id` (Task 5).
- Produces: `listCities(token)`, `createCity(payload, token)`, `deleteCity(id, token)` in `services/api.js`.
- Produces: `useCities()` → `{ cities, loading, refresh }`, same shape as `useSectors()`.

- [ ] **Step 1: Write the failing test files**

Create `frontend/src/components/CreateCityForm.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateCityForm from './CreateCityForm';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CreateCityForm', () => {
  test('creates a city and calls onCreated', async () => {
    api.createCity.mockResolvedValue({ id: 'city-1', name: 'Bahia' });
    const onCreated = vi.fn();
    render(<CreateCityForm onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Bahia');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() => expect(api.createCity).toHaveBeenCalledWith({ name: 'Bahia' }, 'tok-123'));
    expect(onCreated).toHaveBeenCalled();
  });

  test('shows an error message when creation fails', async () => {
    api.createCity.mockRejectedValue({ body: { error: 'Falha ao cadastrar' } });
    render(<CreateCityForm onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Bahia');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    expect(await screen.findByText('Falha ao cadastrar')).toBeInTheDocument();
  });
});
```

Create `frontend/src/components/CitiesAdminTab.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CitiesAdminTab from './CitiesAdminTab';
import { useCities } from '../hooks/useCities';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useCities');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CitiesAdminTab', () => {
  test('lists existing cities', () => {
    useCities.mockReturnValue({ cities: [{ id: 'city-1', name: 'Bahia' }], refresh: vi.fn() });
    render(<CitiesAdminTab />);

    expect(screen.getByText('Bahia')).toBeInTheDocument();
  });

  test('deleting a city asks for confirmation and calls deleteCity when accepted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const refresh = vi.fn();
    useCities.mockReturnValue({ cities: [{ id: 'city-1', name: 'Bahia' }], refresh });
    api.deleteCity.mockResolvedValue(undefined);
    render(<CitiesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    await waitFor(() => expect(api.deleteCity).toHaveBeenCalledWith('city-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('does not delete when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    useCities.mockReturnValue({ cities: [{ id: 'city-1', name: 'Bahia' }], refresh: vi.fn() });
    render(<CitiesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    expect(api.deleteCity).not.toHaveBeenCalled();
  });

  test('shows an error message when deleting fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useCities.mockReturnValue({ cities: [{ id: 'city-1', name: 'Bahia' }], refresh: vi.fn() });
    api.deleteCity.mockRejectedValue({ body: { error: 'Falha ao excluir' } });
    render(<CitiesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    expect(await screen.findByText('Falha ao excluir')).toBeInTheDocument();
  });

  test('renders the create-city form', () => {
    useCities.mockReturnValue({ cities: [], refresh: vi.fn() });
    render(<CitiesAdminTab />);
    expect(screen.getByText(/Cadastrar nova cidade/)).toBeInTheDocument();
  });
});
```

In `frontend/src/pages/AdminChannelsPage.test.jsx`, add the mock import and mock alongside the existing ones:

```js
import { useCities } from '../hooks/useCities';
```

```js
vi.mock('../hooks/useCities');
```

Add a default mock in `beforeEach`, alongside `useSectors.mockReturnValue(...)`:

```js
  useCities.mockReturnValue({ cities: [], refresh: vi.fn() });
```

Add this test right after the existing `'switches to the Setores tab and shows the sector management UI'` test:

```js
  test('switches to the Cidades tab and shows the city management UI', async () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598985004187', status: 'connected' }],
      loading: false,
      refresh: vi.fn(),
    });
    useCities.mockReturnValue({
      cities: [{ id: 'city-1', name: 'Bahia' }],
      refresh: vi.fn(),
    });
    render(<AdminChannelsPage />);

    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Bahia')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /cidades/i }));

    expect(screen.getByText('Bahia')).toBeInTheDocument();
    expect(screen.queryByText('Berg')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run CreateCityForm.test.jsx CitiesAdminTab.test.jsx AdminChannelsPage.test.jsx` (from `frontend/`)
Expected: FAIL — `Cannot find module './CreateCityForm'`/`'./CitiesAdminTab'`, and the "Cidades" tab test can't find a button named "Cidades".

- [ ] **Step 3: Add city functions to `frontend/src/services/api.js`**

Add at the end of the file, after the existing `syncTemplatesAdmin` function:

```js
export function listCities(token) {
  return apiFetch('/api/cities', { token });
}

export function createCity(payload, token) {
  return apiFetch('/api/admin/cities', { method: 'POST', body: payload, token });
}

export function deleteCity(id, token) {
  return apiFetch(`/api/admin/cities/${id}`, { method: 'DELETE', token });
}
```

- [ ] **Step 4: Create `frontend/src/hooks/useCities.js`**

```js
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listCities } from '../services/api';

export function useCities() {
  const { token } = useAuth();
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return listCities(token)
      .then((data) => {
        setCities(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { cities, loading, refresh };
}
```

- [ ] **Step 5: Create `frontend/src/components/CreateCityForm.jsx`**

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createCity } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-950/70';

function CreateCityForm({ onCreated }) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createCity({ name }, token);
      setName('');
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar cidade');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
    >
      <h3 className="font-display text-base font-semibold text-ink-950">Cadastrar nova cidade</h3>
      <div>
        <label htmlFor="city-name" className={labelClass}>
          Nome
        </label>
        <input id="city-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
      </div>
      {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Cadastrar
      </button>
    </form>
  );
}

export default CreateCityForm;
```

- [ ] **Step 6: Create `frontend/src/components/CitiesAdminTab.jsx`**

```jsx
import { useState } from 'react';
import { useCities } from '../hooks/useCities';
import { useAuth } from '../contexts/AuthContext';
import { deleteCity } from '../services/api';
import CreateCityForm from './CreateCityForm';

function CityRow({ city, onDeleted }) {
  const { token } = useAuth();
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Excluir a cidade "${city.name}"?`)) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteCity(city.id, token);
      onDeleted();
    } catch (err) {
      setDeleteError((err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <p className="font-medium text-ink-950">{city.name}</p>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-sm font-medium text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
        >
          Excluir
        </button>
      </div>
      {deleteError && (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{deleteError}</p>
      )}
    </div>
  );
}

function CitiesAdminTab() {
  const { cities, refresh } = useCities();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {cities.map((city) => (
          <CityRow key={city.id} city={city} onDeleted={refresh} />
        ))}
      </div>
      <CreateCityForm onCreated={refresh} />
    </div>
  );
}

export default CitiesAdminTab;
```

- [ ] **Step 7: Modify `frontend/src/pages/AdminChannelsPage.jsx`**

Add the import, alongside the other admin-tab imports:

```jsx
import CitiesAdminTab from '../components/CitiesAdminTab';
```

Add an entry to the `TABS` array, right after `sectors`:

```js
const TABS = [
  { value: 'channels', label: 'Canais' },
  { value: 'agents', label: 'Atendentes' },
  { value: 'quickReplies', label: 'Respostas rápidas' },
  { value: 'sectors', label: 'Setores' },
  { value: 'cities', label: 'Cidades' },
  { value: 'triage', label: 'Triagem' },
  { value: 'templates', label: 'Templates' },
];
```

Add a branch to the conditional render, right after `sectors`:

```jsx
        ) : activeTab === 'sectors' ? (
          <SectorsAdminTab />
        ) : activeTab === 'cities' ? (
          <CitiesAdminTab />
        ) : activeTab === 'triage' ? (
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- --run CreateCityForm.test.jsx CitiesAdminTab.test.jsx AdminChannelsPage.test.jsx` (from `frontend/`)
Expected: PASS (all tests).

- [ ] **Step 9: Run the full frontend suite to confirm no regressions**

Run: `npm test -- --run` (from `frontend/`)
Expected: PASS (all test files).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/services/api.js frontend/src/hooks/useCities.js frontend/src/components/CreateCityForm.jsx frontend/src/components/CreateCityForm.test.jsx frontend/src/components/CitiesAdminTab.jsx frontend/src/components/CitiesAdminTab.test.jsx frontend/src/pages/AdminChannelsPage.jsx frontend/src/pages/AdminChannelsPage.test.jsx
git commit -m "feat: add the Cidades admin tab"
```

---

### Task 7: Edit-contact modal

**Files:**
- Modify: `frontend/src/services/api.js`
- Create: `frontend/src/components/EditContactModal.jsx`
- Create: `frontend/src/components/EditContactModal.test.jsx`
- Modify: `frontend/src/components/ConversationView.jsx`
- Modify: `frontend/src/components/ConversationView.test.jsx`

**Interfaces:**
- Consumes: `useCities()` (Task 6); `PATCH /api/contacts/:id` (Task 5).
- Produces: `updateContact(id, payload, token)` in `services/api.js`.
- Produces: `<EditContactModal conversation onClose onSaved />` — `conversation` needs `contactId`, `contactDisplayName`, `contactCityId`; `onSaved({ displayName, cityName })` is called with the post-save values (city name resolved client-side from the already-loaded cities list, since the `PATCH` response only carries `cityId`, not the joined name).

- [ ] **Step 1: Write the failing test files**

Create `frontend/src/components/EditContactModal.test.jsx`:

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditContactModal from './EditContactModal';
import { useAuth } from '../contexts/AuthContext';
import { useCities } from '../hooks/useCities';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useCities');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useCities.mockReturnValue({
    cities: [
      { id: 'city-1', name: 'Bahia' },
      { id: 'city-2', name: 'São Luís' },
    ],
    refresh: vi.fn(),
  });
});

const CONVERSATION = {
  id: 'conv-1',
  contactId: 'contact-1',
  contactDisplayName: 'Carlos',
  contactPhoneNumber: '+5511999990000',
  contactCityId: 'city-1',
};

describe('EditContactModal', () => {
  test('pre-fills the current name and city', () => {
    render(<EditContactModal conversation={CONVERSATION} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText(/nome/i)).toHaveValue('Carlos');
    expect(screen.getByLabelText(/cidade/i)).toHaveValue('city-1');
  });

  test('pre-fills with no city selected when the contact has none', () => {
    render(
      <EditContactModal conversation={{ ...CONVERSATION, contactCityId: null }} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    expect(screen.getByLabelText(/cidade/i)).toHaveValue('');
  });

  test('saving calls the API with the edited values, resolves the city name, then closes', async () => {
    api.updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Carlos Editado', cityId: 'city-2' });
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<EditContactModal conversation={CONVERSATION} onClose={onClose} onSaved={onSaved} />);

    await userEvent.clear(screen.getByLabelText(/nome/i));
    await userEvent.type(screen.getByLabelText(/nome/i), 'Carlos Editado');
    await userEvent.selectOptions(screen.getByLabelText(/cidade/i), 'city-2');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateContact).toHaveBeenCalledWith(
        'contact-1',
        { displayName: 'Carlos Editado', cityId: 'city-2' },
        'tok-123'
      )
    );
    expect(onSaved).toHaveBeenCalledWith({ displayName: 'Carlos Editado', cityName: 'São Luís' });
    expect(onClose).toHaveBeenCalled();
  });

  test('shows an error message and keeps the modal open when saving fails', async () => {
    api.updateContact.mockRejectedValue({ body: { error: 'Falha ao salvar' } });
    const onClose = vi.fn();
    render(<EditContactModal conversation={CONVERSATION} onClose={onClose} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(await screen.findByText('Falha ao salvar')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('clicking Cancelar closes the modal without saving', async () => {
    const onClose = vi.fn();
    render(<EditContactModal conversation={CONVERSATION} onClose={onClose} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(onClose).toHaveBeenCalled();
    expect(api.updateContact).not.toHaveBeenCalled();
  });
});
```

In `frontend/src/components/ConversationView.test.jsx`, add the import and mock alongside the existing ones:

```js
import { useCities } from '../hooks/useCities';
```

```js
vi.mock('../hooks/useCities');
```

Add a default mock in `beforeEach`, alongside the existing ones:

```js
  useCities.mockReturnValue({ cities: [], refresh: vi.fn() });
```

Add these two tests at the end of the `describe('ConversationView', ...)` block, right before the closing `});`:

```jsx
  test('clicking the contact name/avatar opens the edit-contact modal', async () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', contactId: 'contact-1', status: 'waiting', assignedAgentId: null, contactDisplayName: 'Carlos' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /editar cliente/i }));

    expect(screen.getByText('Editar cliente')).toBeInTheDocument();
  });

  test('saving in the edit-contact modal updates the header immediately', async () => {
    api.updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Carlos Editado', cityId: null });
    render(
      <ConversationView
        conversation={{ id: 'c1', contactId: 'contact-1', status: 'waiting', assignedAgentId: null, contactDisplayName: 'Carlos' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /editar cliente/i }));
    await userEvent.clear(screen.getByLabelText(/nome/i));
    await userEvent.type(screen.getByLabelText(/nome/i), 'Carlos Editado');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(screen.getByText('Carlos Editado')).toBeInTheDocument());
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run EditContactModal.test.jsx ConversationView.test.jsx` (from `frontend/`)
Expected: FAIL — `Cannot find module './EditContactModal'`, and the two new `ConversationView` tests can't find a button named "Editar cliente".

- [ ] **Step 3: Add `updateContact` to `frontend/src/services/api.js`**

Add right after the existing `avatarUrl` function:

```js
export function updateContact(id, payload, token) {
  return apiFetch(`/api/contacts/${id}`, { method: 'PATCH', body: payload, token });
}
```

- [ ] **Step 4: Create `frontend/src/components/EditContactModal.jsx`**

```jsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCities } from '../hooks/useCities';
import { updateContact } from '../services/api';

function EditContactModal({ conversation, onClose, onSaved }) {
  const { token } = useAuth();
  const { cities } = useCities();
  const [displayName, setDisplayName] = useState(conversation.contactDisplayName || '');
  const [cityId, setCityId] = useState(conversation.contactCityId || '');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const updated = await updateContact(conversation.contactId, { displayName, cityId: cityId || null }, token);
      const cityName = updated.cityId ? cities.find((c) => c.id === updated.cityId)?.name || null : null;
      onSaved({ displayName: updated.displayName, cityName });
      onClose();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <div className="w-[90vw] max-w-80 rounded bg-white p-4 shadow">
        <h3 className="mb-3 font-semibold text-gray-800">Editar cliente</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="contact-name" className="mb-1 block text-sm text-gray-700">
              Nome
            </label>
            <input
              id="contact-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="contact-city" className="mb-1 block text-sm text-gray-700">
              Cidade
            </label>
            <select
              id="contact-city"
              value={cityId}
              onChange={(e) => setCityId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Nenhuma</option>
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded bg-blue-600 py-2 text-sm text-white disabled:opacity-50"
            >
              Salvar
            </button>
            <button type="button" onClick={onClose} className="flex-1 rounded bg-gray-200 py-2 text-sm text-gray-700">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EditContactModal;
```

- [ ] **Step 5: Modify `frontend/src/components/ConversationView.jsx`**

Add the import, alongside the other component imports:

```jsx
import EditContactModal from './EditContactModal';
```

Add two new pieces of state, alongside the existing `showingHistory` state:

```jsx
  const [editingContact, setEditingContact] = useState(false);
  const [contactOverride, setContactOverride] = useState(null);
```

Add these two derived values, right after the existing `isMine` line:

```jsx
  const displayName = contactOverride ? contactOverride.displayName : conversation.contactDisplayName;
  const cityName = contactOverride ? contactOverride.cityName : conversation.contactCityName;
  const nameLabel = displayName || conversation.contactPhoneNumber || 'Conversa';
  const headerLabel = cityName ? `${nameLabel} - ${cityName}` : nameLabel;
```

Replace:

```jsx
          <ContactAvatar
            contactId={conversation.contactId}
            avatarPath={conversation.contactAvatarPath}
            displayName={conversation.contactDisplayName}
            phoneNumber={conversation.contactPhoneNumber}
          />
          <h3 className="font-semibold text-gray-800">
            {conversation.contactDisplayName || conversation.contactPhoneNumber || 'Conversa'}
          </h3>
```

with:

```jsx
          <button onClick={() => setEditingContact(true)} className="flex items-center gap-2" aria-label="Editar cliente">
            <ContactAvatar
              contactId={conversation.contactId}
              avatarPath={conversation.contactAvatarPath}
              displayName={displayName}
              phoneNumber={conversation.contactPhoneNumber}
            />
            <h3 className="font-semibold text-gray-800">{headerLabel}</h3>
          </button>
```

Add the modal render, right after the existing `{showingHistory && (...)}` block, before the closing `</div>` of the component:

```jsx
      {editingContact && (
        <EditContactModal
          conversation={conversation}
          onClose={() => setEditingContact(false)}
          onSaved={(updated) => setContactOverride(updated)}
        />
      )}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --run EditContactModal.test.jsx ConversationView.test.jsx` (from `frontend/`)
Expected: PASS (all tests).

- [ ] **Step 7: Run the full frontend suite to confirm no regressions**

Run: `npm test -- --run` (from `frontend/`)
Expected: PASS (all test files).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/services/api.js frontend/src/components/EditContactModal.jsx frontend/src/components/EditContactModal.test.jsx frontend/src/components/ConversationView.jsx frontend/src/components/ConversationView.test.jsx
git commit -m "feat: add the edit-contact modal (name + city) to the conversation header"
```

---

### Task 8: Show the city suffix in the conversation list rows

**Files:**
- Modify: `frontend/src/components/ConversationListItem.jsx`
- Modify: `frontend/src/components/ConversationListItem.test.jsx`

**Interfaces:**
- Consumes: `conversation.contactCityName` (Task 4, already flows through `useQueue`/`useMyConversations` via the backend queries).

- [ ] **Step 1: Write the failing tests**

Add these two tests to `frontend/src/components/ConversationListItem.test.jsx`, right after the existing `'shows a placeholder initial when there is no contactAvatarPath'` test:

```jsx
  test('shows the city suffix after the name when the contact has one', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{
            id: 'c1',
            contactDisplayName: 'Carlos',
            contactPhoneNumber: '+5511999990000',
            contactCityName: 'Bahia',
          }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('Carlos - Bahia')).toBeInTheDocument();
  });

  test('shows just the name when the contact has no city', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{
            id: 'c1',
            contactDisplayName: 'Carlos',
            contactPhoneNumber: '+5511999990000',
            contactCityName: null,
          }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('Carlos')).toBeInTheDocument();
    expect(screen.queryByText(/Carlos -/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run ConversationListItem.test.jsx` (from `frontend/`)
Expected: FAIL — the "Carlos - Bahia" text is never rendered (only "Carlos" shows today).

- [ ] **Step 3: Modify `frontend/src/components/ConversationListItem.jsx`**

```jsx
import ContactAvatar from './ContactAvatar';

function ConversationListItem({ conversation, onSelect }) {
  const nameLabel = conversation.contactDisplayName || conversation.contactPhoneNumber;
  const displayLabel = conversation.contactCityName ? `${nameLabel} - ${conversation.contactCityName}` : nameLabel;

  return (
    <li>
      <button
        onClick={() => onSelect(conversation.id)}
        className="flex w-full items-center gap-2 rounded border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
      >
        <ContactAvatar
          contactId={conversation.contactId}
          avatarPath={conversation.contactAvatarPath}
          displayName={conversation.contactDisplayName}
          phoneNumber={conversation.contactPhoneNumber}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-gray-800">{displayLabel}</p>
            {conversation.sectorName && (
              <span className="shrink-0 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{conversation.sectorName}</span>
            )}
          </div>
          <p className="text-xs text-gray-500">{conversation.contactPhoneNumber}</p>
        </div>
      </button>
    </li>
  );
}

export default ConversationListItem;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run ConversationListItem.test.jsx` (from `frontend/`)
Expected: PASS (all tests, including the 2 new ones).

- [ ] **Step 5: Run the full frontend suite to confirm no regressions**

Run: `npm test -- --run` (from `frontend/`)
Expected: PASS (all test files).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ConversationListItem.jsx frontend/src/components/ConversationListItem.test.jsx
git commit -m "feat: show the contact's city as a suffix in the conversation list rows"
```
