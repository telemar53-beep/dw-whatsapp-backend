import { useState } from 'react';
import WaDialog from './WaDialog';
import AgentAvatar from './AgentAvatar';
import { AsyncState } from './ui';
import { IconClock, IconSearch, IconTeam } from './icons/WaIcons';
import { formatLastSeen } from '../utils/formatLastSeen';

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
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

function TeammateRow({ teammate, tone }) {
  const active = teammate.activeConversations || 0;
  const lastSeen = formatLastSeen(teammate.lastSeenAt);
  const online = tone !== 'offline';
  return (
    <li className="flex min-w-0 items-center gap-2.5 border-b border-wa-border px-3 py-2 last:border-b-0">
      <span className="relative shrink-0">
        <AgentAvatar agentId={teammate.id} avatarPath={teammate.avatarPath} name={teammate.name} size={34} />
        <span
          title={online ? 'Online' : 'Offline'}
          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#30383d] ${online ? 'bg-chat-online' : 'bg-white/35'}`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold leading-[18px] text-wa-text" title={teammate.name}>{teammate.name}</span>
        <span className="flex min-w-0 items-center gap-1 text-[11.5px] leading-[16px] text-wa-muted" title={!online ? `Última atividade: ${lastSeen || 'sem registro'}` : undefined}>
          {!online && <IconClock size={12} />}
          <span className="truncate">
            {tone === 'busy' ? 'Online · Em atendimento' : tone === 'available' ? 'Online · Disponível para atender' : `Última: ${lastSeen || 'sem registro'}`}
          </span>
        </span>
      </span>
      <span
        aria-label={plural(active, 'atendimento ativo', 'atendimentos ativos')}
        className={`shrink-0 rounded-[8px] px-2 py-1 text-right text-[11.5px] font-semibold tabular-nums ${tone === 'busy' || (tone === 'offline' && active > 0) ? 'bg-chat-orange/15 text-[#ff9a6e]' : tone === 'available' ? 'bg-chat-online/10 text-chat-online' : 'bg-white/[0.06] text-wa-muted'}`}
      >
        {active} {active === 1 ? 'ativo' : 'ativos'}
      </span>
    </li>
  );
}

function Section({ tone, title, count, summary, children }) {
  const color = tone === 'busy' ? 'bg-[#f5a524]' : tone === 'available' ? 'bg-chat-online' : 'bg-white/35';
  return (
    <section className="dialog-team-grupo min-w-0">
      <header className="border-b border-wa-border px-3 py-2.5">
        <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-wa-text">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${color}`} />
          {title}
          <span className="ml-auto rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] tabular-nums text-wa-muted">{count}</span>
        </h3>
        <p className="mt-0.5 pl-4 text-[11.5px] text-wa-muted">{summary}</p>
      </header>
      {count > 0 ? <ul>{children}</ul> : <p className="px-3 py-4 text-[12px] text-wa-muted">Nenhum integrante neste grupo.</p>}
    </section>
  );
}

function TeamModal({ agents, onlineIds, status, onClose, onRetry }) {
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
  const busy = visible.filter(isBusy);
  const available = visible.filter((teammate) => isOnline(teammate) && !isBusy(teammate));
  const offline = visible.filter((teammate) => !isOnline(teammate));
  const showBusy = filter === 'all' || filter === 'online' || filter === 'busy';
  const showAvailable = filter === 'all' || filter === 'online';
  const showOffline = filter === 'all' || filter === 'offline';
  // Grupo vazio nao ocupa espaco quando ha outros na tela; com filtro ativo a
  // frase continua, porque ali ela e a resposta.
  const esconderVazios = filter === 'all';

  return (
    <WaDialog
      variant="team"
      onClose={onClose}
      closeOnBackdrop
      title="Nossa equipe"
      // Carregando ou com erro, "0 integrantes · 0 online" era uma afirmação
      // falsa (ATD-EQM-01/07): só a lista pronta tem contagem.
      description={status === 'ready'
        ? `${plural(counts.all, 'integrante na equipe', 'integrantes na equipe')} · ${counts.online} online agora`
        : status === 'loading' ? 'Carregando a equipe…' : 'Não foi possível carregar a equipe.'}
      icon={<IconTeam size={18} />}
      tone="ok"
      size="max-w-[620px]"
    >

      <div className="shrink-0 border-b border-wa-border px-5 pb-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
        <label className="flex h-[38px] min-w-[220px] flex-1 items-center gap-2.5 rounded-[10px] border border-wa-border bg-white/[0.05] px-3 transition focus-within:border-white/25">
          <span className="shrink-0 text-wa-muted">
            <IconSearch size={18} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar um integrante da equipe…"
            aria-label="Buscar um integrante da equipe"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-wa-text outline-none placeholder:text-wa-muted"
          />
        </label>
        <div role="group" aria-label="Filtrar equipe" className="flex flex-wrap gap-1.5">
          {FILTERS.map((item) => {
            const active = filter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                aria-pressed={active}
                className={`flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                  active
                    ? 'border-chat-orange bg-chat-orange/15 text-wa-text'
                    : 'border-wa-border bg-white/[0.04] text-wa-text hover:bg-white/[0.08]'
                }`}
              >
                {item.key === 'all' ? (
                  <span className={active ? 'text-chat-orange' : 'text-wa-icon'}>
                    <IconTeam size={15} />
                  </span>
                ) : (
                  <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${item.dot}`} />
                )}
                {item.label}
                <span
                  className={`rounded-full px-1.5 py-[1px] text-[11px] font-semibold ${
                    active ? 'bg-chat-orange text-on-accent' : 'bg-white/[0.12] text-wa-text'
                  }`}
                >
                  {status === 'ready' ? counts[item.key] : null}
                </span>
              </button>
            );
          })}
        </div>
        </div>
      </div>

      <div className="wa-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-3 sm:px-6">
        <AsyncState status={status} isEmpty={agents.length === 0} emptyMessage="Nenhum atendente cadastrado." onRetry={onRetry}>
          {agents.length > 0 && visible.length === 0 ? (
            // Busca e filtro vazios tinham a mesma frase e nenhuma saída (ATD-EQM-09).
            <div className="flex flex-col items-center gap-2 px-2 py-5 text-center text-[13px] text-wa-muted">
              <p>{query ? `Ninguém encontrado para "${search.trim()}"${filter !== 'all' ? ' neste filtro' : ''}.` : 'Ninguém neste filtro.'}</p>
              <button type="button" onClick={() => { setSearch(''); setFilter('all'); }} className="text-[13px] font-medium text-wa-text underline-offset-4 hover:underline">
                {query && filter !== 'all' ? 'Limpar busca e filtro' : query ? 'Limpar busca' : 'Ver todos'}
              </button>
            </div>
          ) : (
            <div className="dialog-team-grupos">
              {showBusy && !(esconderVazios && busy.length === 0) && (
                <Section tone="busy" title="Em atendimento" count={busy.length} summary="Já estão com conversas ativas">
                  {busy.map((teammate) => <TeammateRow key={teammate.id} teammate={teammate} tone="busy" />)}
                </Section>
              )}
              {showAvailable && !(esconderVazios && available.length === 0) && (
                <Section tone="available" title="Disponíveis" count={available.length} summary="Online e sem atendimentos ativos">
                  {available.map((teammate) => <TeammateRow key={teammate.id} teammate={teammate} tone="available" />)}
                </Section>
              )}
              {showOffline && !(esconderVazios && offline.length === 0) && (
                <Section tone="offline" title="Offline" count={offline.length} summary="Não disponíveis no momento">
                  {offline.map((teammate) => <TeammateRow key={teammate.id} teammate={teammate} tone="offline" />)}
                </Section>
              )}
            </div>
          )}
        </AsyncState>
      </div>

      <div className="dw-dialog-footer">
        <span className="dw-dialog-nota">A carga vem dos atendimentos ativos de cada um.</span>
        <span className="dw-dialog-acoes">
        <button
          type="button"
          onClick={onClose}
          className="rounded-[10px] border border-wa-border-strong bg-white/[0.06] px-7 py-2 text-[13.5px] font-medium text-wa-text transition-colors hover:bg-white/[0.10] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Fechar
        </button>
        </span>
      </div>
    </WaDialog>
  );
}

export default TeamModal;
