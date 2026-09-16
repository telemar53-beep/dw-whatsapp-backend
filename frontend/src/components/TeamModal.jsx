import { useState } from 'react';
import WaDialog from './WaDialog';
import AgentAvatar from './AgentAvatar';
import { AsyncState } from './ui';
import { IconChats, IconClock, IconClose, IconSearch, IconTeam } from './icons/WaIcons';
import { formatLastSeen } from '../utils/formatLastSeen';

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function IconHeadset({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="13" width="4" height="6" rx="1.5" />
      <rect x="17" y="13" width="4" height="6" rx="1.5" />
    </svg>
  );
}

const FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'online', label: 'Online', dot: 'bg-chat-online' },
  { key: 'offline', label: 'Offline', dot: 'bg-white/35' },
  { key: 'busy', label: 'Em atendimento', dot: 'bg-[#f5a524]' },
];

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function StatusChip({ busy }) {
  return busy ? (
    <span className="flex shrink-0 items-center gap-2 rounded-[12px] border border-chat-orange/40 bg-chat-orange/15 px-4 py-2 text-[14px] font-medium text-[#ff9a6e]">
      <IconHeadset size={16} />
      Em atendimento
    </span>
  ) : (
    <span className="flex shrink-0 items-center gap-2 rounded-[12px] border border-chat-online/40 bg-chat-online/15 px-4 py-2 text-[14px] font-medium text-chat-online">
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-chat-online" />
      Disponível
    </span>
  );
}

function TeammateRow({ teammate, online }) {
  const active = teammate.activeConversations || 0;
  const lastSeen = formatLastSeen(teammate.lastSeenAt);
  return (
    <li className="flex items-center gap-4 px-5 py-3.5">
      <span className="relative shrink-0">
        <AgentAvatar agentId={teammate.id} avatarPath={teammate.avatarPath} name={teammate.name} size={56} />
        <span
          title={online ? 'Online' : 'Offline'}
          className={`absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-[#1c1a18] ${online ? 'bg-chat-online' : 'bg-white/35'}`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-semibold leading-[22px] text-wa-text">{teammate.name}</span>
        <span className={`block text-[14px] leading-[19px] ${online ? 'text-chat-online' : 'text-wa-muted'}`}>{online ? 'Online' : 'Offline'}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[14px] leading-[19px] text-wa-muted">
          {online && active > 0 && (
            <>
              <IconHeadset size={16} />
              Atendendo {plural(active, 'conversa', 'conversas')}
            </>
          )}
          {online && active === 0 && (
            <>
              <IconChats size={15} />
              Disponível para atender
            </>
          )}
          {!online && (
            <>
              <IconClock size={16} />
              Última atividade: {lastSeen || 'sem registro'}
            </>
          )}
        </span>
      </span>
      {online && <StatusChip busy={active > 0} />}
    </li>
  );
}

function Section({ tone, title, count, summary, children }) {
  return (
    <section className="overflow-hidden rounded-[14px] border border-wa-border bg-white/[0.03]">
      <header className="flex items-center gap-3 border-b border-wa-border bg-white/[0.04] px-5 py-3.5">
        <span aria-hidden="true" className={`h-3 w-3 rounded-full ${tone === 'online' ? 'bg-chat-online' : 'bg-white/35'}`} />
        <h3 className="text-[16px] font-semibold text-wa-text">
          {title} ({count})
        </h3>
        <span className={`ml-auto text-[14px] ${tone === 'online' ? 'text-chat-online' : 'text-wa-muted'}`}>{summary}</span>
      </header>
      <ul className="divide-y divide-wa-border">{children}</ul>
    </section>
  );
}

function TeamModal({ agents, onlineIds, status, onClose }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const isOnline = (teammate) => onlineIds.has(teammate.id);
  const isBusy = (teammate) => isOnline(teammate) && (teammate.activeConversations || 0) > 0;
  const counts = {
    all: agents.length,
    online: agents.filter(isOnline).length,
    offline: agents.filter((teammate) => !isOnline(teammate)).length,
    busy: agents.filter(isBusy).length,
  };

  const query = normalize(search.trim());
  const visible = agents.filter((teammate) => {
    if (query && !normalize(teammate.name).includes(query)) return false;
    if (filter === 'online') return isOnline(teammate);
    if (filter === 'offline') return !isOnline(teammate);
    if (filter === 'busy') return isBusy(teammate);
    return true;
  });
  const online = visible.filter(isOnline);
  const offline = visible.filter((teammate) => !isOnline(teammate));

  return (
    <WaDialog onClose={onClose} size="max-w-[980px]">
      <div className="flex shrink-0 items-start gap-4 px-6 pb-4 pt-6">
        <span aria-hidden="true" className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-wa-text">
          <IconTeam size={40} />
        </span>
        <div className="min-w-0 flex-1 pt-2">
          <h2 className="text-[26px] font-semibold leading-[32px] text-wa-text">Nossa equipe</h2>
          <p className="mt-1 text-[16px] leading-[22px] text-wa-muted">Veja quem está disponível no momento</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar o popup da equipe"
          title="Fechar"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-wa-border bg-white/[0.06] text-wa-icon transition-colors hover:text-wa-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green"
        >
          <IconClose size={20} />
        </button>
      </div>

      <div className="shrink-0 px-6">
        <label className="flex h-[52px] items-center gap-3 rounded-[12px] border border-wa-border bg-white/[0.05] px-4 transition focus-within:border-white/25">
          <span className="shrink-0 text-wa-muted">
            <IconSearch size={22} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar um integrante da equipe..."
            aria-label="Buscar um integrante da equipe"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-wa-text outline-none placeholder:text-wa-muted"
          />
        </label>
        <div role="group" aria-label="Filtrar equipe" className="mt-4 flex flex-wrap gap-3">
          {FILTERS.map((item) => {
            const active = filter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                aria-pressed={active}
                className={`flex items-center gap-2.5 rounded-[14px] border px-4 py-2.5 text-[15px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green ${
                  active
                    ? 'border-chat-orange bg-chat-orange/15 text-wa-text'
                    : 'border-wa-border bg-white/[0.04] text-wa-text hover:bg-white/[0.08]'
                }`}
              >
                {item.key === 'all' ? (
                  <span className={active ? 'text-chat-orange' : 'text-wa-icon'}>
                    <IconTeam size={18} />
                  </span>
                ) : (
                  <span aria-hidden="true" className={`h-3 w-3 rounded-full ${item.dot}`} />
                )}
                {item.label}
                <span
                  className={`rounded-full px-2 py-[1px] text-[13px] font-semibold ${
                    active ? 'bg-chat-orange text-white' : 'bg-white/[0.12] text-wa-text'
                  }`}
                >
                  {counts[item.key]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="wa-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-4 pt-4">
        <AsyncState status={status} isEmpty={agents.length === 0} emptyMessage="Nenhum atendente cadastrado.">
          {online.length > 0 && (
            <Section tone="online" title="Online" count={online.length} summary="Disponíveis para atender">
              {online.map((teammate) => (
                <TeammateRow key={teammate.id} teammate={teammate} online />
              ))}
            </Section>
          )}
          {offline.length > 0 && (
            <Section tone="offline" title="Offline" count={offline.length} summary="Não disponíveis no momento">
              {offline.map((teammate) => (
                <TeammateRow key={teammate.id} teammate={teammate} online={false} />
              ))}
            </Section>
          )}
          {agents.length > 0 && visible.length === 0 && (
            <p className="px-2 py-6 text-center text-[15px] text-wa-muted">Nenhum integrante encontrado com esse filtro.</p>
          )}
        </AsyncState>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-4 border-t border-wa-border px-6 py-4">
        <span aria-hidden="true" className="text-wa-icon">
          <IconTeam size={32} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-medium text-wa-text">{plural(counts.all, 'integrante na equipe', 'integrantes na equipe')}</p>
          <p className="text-[14px] text-wa-muted">
            {counts.online} online • {counts.busy} em atendimento • {counts.offline} offline
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-[12px] border border-wa-border-strong bg-white/[0.06] px-9 py-3 text-[16px] font-medium text-wa-text transition-colors hover:bg-white/[0.10] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green"
        >
          Fechar
        </button>
      </div>
    </WaDialog>
  );
}

export default TeamModal;
