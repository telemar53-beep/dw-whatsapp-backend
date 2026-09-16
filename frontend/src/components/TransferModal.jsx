import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';
import { transferConversation } from '../services/api';
import WaDialog, { waErrorClass } from './WaDialog';
import AgentAvatar from './AgentAvatar';
import { AsyncState } from './ui';
import { IconChats, IconChevronDown, IconClose, IconInfo, IconSearch, IconTransfer } from './icons/WaIcons';

// Nível de carga pelo número de atendimentos abertos. Os limites são uma
// escolha de produto (não vêm do backend): quem está offline nunca é sugerido
// como "disponível", e a partir de 10 conversas o atendente é marcado em
// vermelho para desencorajar mais uma transferência.
export function loadLevel({ online, active }) {
  if (!online) {
    return { key: 'offline', label: 'Offline', hint: 'Não está disponível no momento', tone: 'gray' };
  }
  if (active >= 10) {
    return { key: 'high', label: 'Carga alta', hint: 'Alta carga de atendimentos', tone: 'red', alert: true };
  }
  if (active >= 5) {
    return { key: 'heavy', label: 'Movimentado', hint: 'Alto volume no momento', tone: 'orange' };
  }
  if (active >= 1) {
    return { key: 'busy', label: 'Em atendimento', hint: 'Atendendo normalmente', tone: 'yellow' };
  }
  return { key: 'free', label: 'Disponível', hint: 'Atendendo normalmente', tone: 'green' };
}

const TONE_CLASSES = {
  green: 'border-chat-online/45 bg-chat-online/15 text-chat-online',
  yellow: 'border-[#f5c518]/45 bg-[#f5c518]/15 text-[#f5d35e]',
  orange: 'border-chat-orange/45 bg-chat-orange/15 text-[#ff9a6e]',
  red: 'border-[#ef4444]/50 bg-[#ef4444]/15 text-[#ff7b7b]',
  gray: 'border-white/15 bg-white/[0.08] text-wa-muted',
};

const DOT_CLASSES = {
  green: 'bg-chat-online',
  yellow: 'bg-[#f5c518]',
  orange: 'bg-chat-orange',
  red: 'bg-[#ef4444]',
  gray: 'bg-white/35',
};

const SORTS = [
  { key: 'load', label: 'Menor carga' },
  { key: 'name', label: 'Nome' },
];

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function IconArrowRight({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function IconBars({ size = 14 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="currentColor">
      <rect x="4" y="13" width="4" height="7" rx="1" />
      <rect x="10" y="8" width="4" height="12" rx="1" />
      <rect x="16" y="3" width="4" height="17" rx="1" />
    </svg>
  );
}

function AgentRow({ agent, online, busy, onTransfer }) {
  const active = agent.activeConversations || 0;
  const level = loadLevel({ online, active });
  const displayName = agent.name || agent.email;
  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5">
      <span className="relative shrink-0">
        <AgentAvatar agentId={agent.id} avatarPath={agent.avatarPath} name={displayName} size={46} />
        <span
          title={online ? 'Online' : 'Offline'}
          className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#1c1a18] ${DOT_CLASSES[level.tone]}`}
        />
      </span>
      <span className="flex min-w-0 flex-1 basis-0 flex-col gap-1.5">
        <span className="truncate text-[14.5px] font-semibold leading-[18px] text-wa-text">{displayName}</span>
        <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-[3px] text-[12px] font-medium ${TONE_CLASSES[level.tone]}`}>
          {level.label}
        </span>
      </span>
      <span aria-hidden="true" className="hidden h-11 w-px shrink-0 bg-wa-border sm:block" />
      <span className="hidden min-w-0 flex-1 basis-0 items-start gap-2.5 sm:flex">
        <span className="mt-0.5 shrink-0 text-wa-muted">
          <IconChats size={16} />
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] leading-[18px] text-wa-text">
            <strong className="font-semibold">{active}</strong> {active === 1 ? 'atendimento' : 'atendimentos'}
          </span>
          {level.alert ? (
            <span className={`mt-1 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[12px] font-medium ${TONE_CLASSES.red}`}>
              <IconBars size={13} />
              {level.hint}
            </span>
          ) : (
            <span className="block text-[12.5px] leading-[17px] text-wa-muted">{level.hint}</span>
          )}
        </span>
      </span>
      <button
        type="button"
        onClick={onTransfer}
        disabled={busy}
        aria-label={`Transferir para ${displayName}`}
        className="flex shrink-0 items-center gap-2 rounded-[10px] border border-chat-orange/60 bg-chat-orange/20 px-3.5 py-2 text-[13.5px] font-semibold text-[#ffb08a] transition-colors hover:bg-chat-orange/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-chat-orange disabled:opacity-50"
      >
        <span className="text-chat-orange">
          <IconArrowRight size={15} />
        </span>
        Transferir
      </button>
    </li>
  );
}

function TransferModal({ conversationId, onClose }) {
  const { token, agent } = useAuth();
  const { agents: allAgents, status } = useAgents();
  const onlineIds = usePresence(allAgents);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('load');
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const isOnline = (a) => onlineIds.has(a.id);
  const query = normalize(search.trim());
  const agents = allAgents
    .filter((a) => a.id !== agent.id)
    .filter((a) => !query || normalize(a.name || a.email).includes(query))
    .sort((a, b) => {
      const nameOrder = String(a.name || a.email).localeCompare(String(b.name || b.email));
      if (sort === 'name') return nameOrder;
      // Menor carga: online antes de offline, depois menos atendimentos, depois nome.
      if (isOnline(a) !== isOnline(b)) return isOnline(a) ? -1 : 1;
      const loadOrder = (a.activeConversations || 0) - (b.activeConversations || 0);
      return loadOrder || nameOrder;
    });

  async function handleSelect(toAgentId) {
    setError(null);
    setBusyId(toAgentId);
    try {
      await transferConversation(conversationId, toAgentId, token);
      onClose();
    } catch (err) {
      setError((err.body && err.body.error) || 'Não foi possível transferir este atendimento.');
      setBusyId(null);
    }
  }

  const hasOthers = allAgents.some((a) => a.id !== agent.id);

  return (
    <WaDialog onClose={onClose} size="max-w-[760px]">
      <div className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-5">
        <span aria-hidden="true" className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full bg-chat-orange/20 text-chat-orange">
          <IconTransfer size={30} />
        </span>
        <div className="min-w-0 flex-1 pt-1">
          <h2 className="text-[20px] font-semibold leading-[26px] text-wa-text">Transferir atendimento</h2>
          <p className="mt-0.5 text-[13.5px] leading-[18px] text-wa-muted">Escolha um atendente para transferir esta conversa.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar o popup de transferência"
          title="Fechar"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-wa-border bg-white/[0.06] text-wa-icon transition-colors hover:text-wa-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green"
        >
          <IconClose size={17} />
        </button>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2.5 px-5">
        <label className="flex h-[42px] min-w-0 flex-1 basis-[240px] items-center gap-2.5 rounded-[10px] border border-wa-border bg-white/[0.05] px-3 transition focus-within:border-white/25">
          <span className="shrink-0 text-wa-muted">
            <IconSearch size={18} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar atendente por nome..."
            aria-label="Buscar atendente por nome"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-wa-text outline-none placeholder:text-wa-muted"
          />
        </label>
        <label className="relative flex h-[42px] shrink-0 items-center rounded-[10px] border border-wa-border bg-white/[0.05] pl-3 pr-9 focus-within:border-white/25">
          <span className="flex flex-col">
            <span className="text-[11px] leading-[13px] text-wa-muted">Ordenar por</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              aria-label="Ordenar por"
              className="cursor-pointer appearance-none bg-transparent pr-2 text-[13.5px] font-medium leading-[19px] text-wa-text outline-none"
            >
              {SORTS.map((item) => (
                <option key={item.key} value={item.key} className="bg-[#26221f] text-white">
                  {item.label}
                </option>
              ))}
            </select>
          </span>
          <span aria-hidden="true" className="pointer-events-none absolute right-2.5 text-wa-icon">
            <IconChevronDown size={18} />
          </span>
        </label>
      </div>

      <div className="wa-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-3">
        <AsyncState status={status} isEmpty={!hasOthers} emptyMessage="Nenhum outro atendente disponível.">
          {agents.length > 0 ? (
            <ul className="divide-y divide-wa-border overflow-hidden rounded-[12px] border border-wa-border bg-white/[0.03]">
              {agents.map((a) => (
                <AgentRow key={a.id} agent={a} online={isOnline(a)} busy={busyId === a.id} onTransfer={() => handleSelect(a.id)} />
              ))}
            </ul>
          ) : (
            <p className="px-2 py-5 text-center text-[13px] text-wa-muted">Nenhum atendente encontrado com esse nome.</p>
          )}
        </AsyncState>
        {error && <p className={`${waErrorClass} mt-3`}>{error}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-wa-border px-5 py-3">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-wa-icon">
          <IconInfo size={18} />
        </span>
        <p className="min-w-0 flex-1 text-[13px] text-wa-muted">A transferência será registrada no histórico da conversa.</p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-[10px] border border-wa-border-strong bg-white/[0.06] px-6 py-2 text-[13.5px] font-medium text-wa-text transition-colors hover:bg-white/[0.10] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green"
        >
          Cancelar
        </button>
      </div>
    </WaDialog>
  );
}

export default TransferModal;
