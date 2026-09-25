import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';
import { transferConversation } from '../services/api';
import WaDialog, { waErrorClass, WaError } from './WaDialog';
import AgentAvatar from './AgentAvatar';
import { AsyncState } from './ui';
import { IconChats, IconChevronDown, IconInfo, IconSearch, IconTransfer } from './icons/WaIcons';
import { descreverErro } from '../utils/errorMessages';

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
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
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

function AgentRow({ agent, online, selecionado, onEscolher }) {
  const active = agent.activeConversations || 0;
  const level = loadLevel({ online, active });
  const displayName = agent.name || agent.email;
  return (
    <li>
    <button
      type="button"
      role="radio"
      aria-checked={selecionado}
      onClick={onEscolher}
      className={`dialog-transfer-linha flex w-full items-center gap-3 px-3.5 py-2.5 text-left ${selecionado ? 'is-escolhido' : ''}`}
    >
      <span className="relative shrink-0">
        <AgentAvatar agentId={agent.id} avatarPath={agent.avatarPath} name={displayName} size={46} />
        <span
          title={online ? 'Online' : 'Offline'}
          className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#30383d] ${DOT_CLASSES[level.tone]}`}
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
      <span aria-hidden="true" className={`dialog-transfer-marca ${selecionado ? 'is-escolhido' : ''}`} />
    </button>
    </li>
  );
}

// So o primeiro nome no botao: o nome inteiro estourava o rodape em telas
// estreitas. O nome completo continua na linha escolhida.
function primeiroNomeDe(a) {
  const partes = String(a.name || a.email || '').trim().split(/\s+/).filter(Boolean);
  return partes[0] || 'atendente';
}

function TransferModal({ conversationId, onClose }) {
  const { token, agent } = useAuth();
  const { agents: allAgents, status } = useAgents();
  const onlineIds = usePresence(allAgents);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('load');
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [escolhido, setEscolhido] = useState(null);

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

  // Agrupar por disponibilidade e a ordem de "menor carga". Pedir "Nome" e
  // pedir uma lista alfabetica: agrupar ali quebraria a ordem que a pessoa
  // acabou de escolher, e o proprio "Ordenar por" deixaria de fazer sentido.
  const agrupar = sort !== 'name';
  const disponiveis = agrupar ? agents.filter(isOnline) : agents;
  const offline = agrupar ? agents.filter((a) => !isOnline(a)) : [];
  // A escolha vale sobre a lista INTEIRA: antes ela sumia com a busca e o
  // botão desabilitava sem dizer por quê (A2-7).
  const escolhidoAgora = allAgents.find((a) => a.id === escolhido && a.id !== agent.id) || null;
  const escolhidoForaDaBusca = Boolean(escolhidoAgora) && !agents.some((a) => a.id === escolhidoAgora.id);

  async function handleSelect(toAgentId) {
    setError(null);
    setBusyId(toAgentId);
    try {
      await transferConversation(conversationId, toAgentId, token);
      onClose();
    } catch (err) {
      setError(descreverErro(err, 'Não foi possível transferir este atendimento.'));
      setBusyId(null);
    }
  }

  const hasOthers = allAgents.some((a) => a.id !== agent.id);

  return (
    <WaDialog
      variant="transfer"
      onClose={onClose}
      title="Transferir atendimento"
      description="Escolha um atendente para transferir esta conversa."
      icon={<IconTransfer size={18} />}
      size="max-w-[760px]"
    >

      <div className="flex shrink-0 flex-wrap gap-2.5 px-5">
        <label className="flex h-[42px] min-w-0 flex-1 basis-[240px] items-center gap-2.5 rounded-[10px] border border-wa-border bg-white/[0.05] px-3 transition focus-within:border-white/25">
          <span className="shrink-0 text-wa-muted">
            <IconSearch size={18} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar atendente por nome…"
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
                <option key={item.key} value={item.key} className="bg-[#30383d] text-white">
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
            <div role="radiogroup" aria-label="Atendente que vai receber">
              {agrupar && disponiveis.length > 0 && <p className="dialog-transfer-grupo"><i aria-hidden="true" data-on="true" />Disponíveis<b>{disponiveis.length}</b></p>}
              {disponiveis.length > 0 && (
                <ul className="divide-y divide-wa-border overflow-hidden rounded-[12px] border border-wa-border bg-white/[0.03]">
                  {disponiveis.map((a) => (
                    <AgentRow key={a.id} agent={a} online={isOnline(a)} selecionado={escolhido === a.id} onEscolher={() => setEscolhido(a.id)} />
                  ))}
                </ul>
              )}
              {/* Offline no fim, e nao no meio da lista: quem esta fora do
                  turno nao deve competir com quem pode receber agora. */}
              {offline.length > 0 && <p className="dialog-transfer-grupo"><i aria-hidden="true" />Offline<b>{offline.length}</b></p>}
              {offline.length > 0 && (
                <ul className="divide-y divide-wa-border overflow-hidden rounded-[12px] border border-wa-border bg-white/[0.03]">
                  {offline.map((a) => (
                    <AgentRow key={a.id} agent={a} online={false} selecionado={escolhido === a.id} onEscolher={() => setEscolhido(a.id)} />
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="px-2 py-5 text-center text-[13px] text-wa-muted">Nenhum atendente encontrado com esse nome.</p>
          )}
        </AsyncState>
        {error && <WaError className="mt-3">{error}</WaError>}
      </div>

      <div className="dw-dialog-footer">
        <span className="dw-dialog-nota">
          {escolhidoForaDaBusca
            ? `Escolhido: ${escolhidoAgora.name || escolhidoAgora.email} (fora da busca).`
            : 'A transferência será registrada no histórico da conversa.'}
        </span>
        <span className="dw-dialog-acoes">
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-[10px] border border-wa-border-strong bg-white/[0.06] px-5 py-2 text-[13.5px] font-medium text-wa-text transition-colors hover:bg-white/[0.10] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => escolhidoAgora && handleSelect(escolhidoAgora.id)}
            disabled={!escolhidoAgora || busyId !== null}
            className="flex shrink-0 items-center gap-2 rounded-[10px] bg-accent px-5 py-2 text-[13.5px] font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-50"
          >
            <IconArrowRight size={15} />
            {escolhidoAgora ? `Transferir para ${primeiroNomeDe(escolhidoAgora)}` : 'Transferir'}
          </button>
        </span>
      </div>
    </WaDialog>
  );
}

export default TransferModal;
