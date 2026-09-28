import { useState } from 'react';
import AgentAvatar from './AgentAvatar';
import { DialogoClaro, useCelular } from './ui/DialogoClaro';
import { IconeBuscar } from './icones';
import { formatLastSeen } from '../utils/formatLastSeen';
import './dialogo-equipe.css';

// "Nossa equipe", claro (Bloco 1): a linha do Transferir aprovado — foto,
// nome, presença escrita ao lado do ponto e a carga numa coluna própria —
// sem o rádio, porque aqui ninguém é escolhido. Chega sob demanda pelo botão
// "Equipe" do trilho (TeamPanel); os dados são os mesmos de lá (useAgents +
// usePresence), já prontos quando o popup abre.

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

const FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'online', label: 'Online' },
  { key: 'offline', label: 'Offline' },
  { key: 'busy', label: 'Em atendimento' },
];

// Presença escrita: a cor do ponto só reforça. Verde para quem está online
// (atendendo ou livre), cinza para quem não está.
const PRESENCA = {
  busy: { rotulo: 'Em atendimento', tom: 'verde' },
  available: { rotulo: 'Disponível', tom: 'verde' },
  offline: { rotulo: 'Offline', tom: 'neutro' },
};

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function TeammateRow({ teammate, tone, tamanhoDoAvatar }) {
  const active = teammate.activeConversations || 0;
  const presenca = PRESENCA[tone];
  const lastSeen = tone === 'offline' ? formatLastSeen(teammate.lastSeenAt) : null;
  return (
    <li className="eq-linha">
      <span className="eq-avatar" aria-hidden="true">
        <AgentAvatar agentId={teammate.id} avatarPath={teammate.avatarPath} name={teammate.name} size={tamanhoDoAvatar} />
      </span>
      <span className="eq-quem">
        <span className="eq-nome" title={teammate.name}>{teammate.name}</span>
        <span className="eq-presenca" data-tom={presenca.tom}>
          <i aria-hidden="true" />
          {presenca.rotulo}
        </span>
      </span>
      <span className="eq-carga">
        <span className="eq-carga-num">{plural(active, 'atendimento ativo', 'atendimentos ativos')}</span>
        {tone === 'offline' && <span className="eq-carga-dica">Última atividade: {lastSeen || 'sem registro'}</span>}
      </span>
    </li>
  );
}

// O título e a contagem são um cabeçalho de verdade (h3): quem navega por
// cabeçalhos pula de grupo em grupo.
function Section({ title, count, children }) {
  return (
    <section className="eq-grupo">
      <h3 className="eq-grupo-titulo">
        {title}
        <span className="eq-grupo-total">{count}</span>
      </h3>
      {count > 0 ? <ul className="eq-lista">{children}</ul> : <p className="mc-vazio">Nenhum integrante neste grupo.</p>}
    </section>
  );
}

// Enquanto a lista chega: a forma dela, parada, sem piscar e sem número.
function Carregando() {
  return (
    <div role="status" className="eq-carregando">
      <span className="mc-carregando">Carregando a equipe…</span>
      <span aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="eq-carregando-linha"><i /><b /><b /></span>
        ))}
      </span>
    </div>
  );
}

function TeamModal({ agents, onlineIds, status, onClose, onRetry }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const celular = useCelular();

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
  const tamanhoDoAvatar = celular ? 36 : 40;
  const linha = (tone) => (teammate) => <TeammateRow key={teammate.id} teammate={teammate} tone={tone} tamanhoDoAvatar={tamanhoDoAvatar} />;

  let corpo;
  if (status === 'loading') {
    corpo = <Carregando />;
  } else if (status === 'forbidden') {
    corpo = <p className="mc-vazio">Você não tem permissão para ver esta lista.</p>;
  } else if (status === 'error') {
    corpo = (
      <div role="alert" className="mc-falha">
        <span>Não foi possível carregar a equipe.</span>
        {onRetry && <button type="button" className="mc-botao" onClick={onRetry}>Tentar de novo</button>}
      </div>
    );
  } else if (agents.length === 0) {
    corpo = <p className="mc-vazio">Nenhum atendente cadastrado.</p>;
  } else if (visible.length === 0) {
    // Busca e filtro vazios tinham a mesma frase e nenhuma saída (ATD-EQM-09).
    corpo = (
      <div className="eq-sem-resultado">
        <p>{query ? `Ninguém encontrado para "${search.trim()}"${filter !== 'all' ? ' neste filtro' : ''}.` : 'Ninguém neste filtro.'}</p>
        <button type="button" className="mc-link" onClick={() => { setSearch(''); setFilter('all'); }}>
          {query && filter !== 'all' ? 'Limpar busca e filtro' : query ? 'Limpar busca' : 'Ver todos'}
        </button>
      </div>
    );
  } else {
    corpo = (
      <>
        {showBusy && !(esconderVazios && busy.length === 0) && (
          <Section title="Em atendimento" count={busy.length}>{busy.map(linha('busy'))}</Section>
        )}
        {showAvailable && !(esconderVazios && available.length === 0) && (
          <Section title="Disponíveis" count={available.length}>{available.map(linha('available'))}</Section>
        )}
        {/* Offline no fim: quem está fora do turno não compete com quem está. */}
        {showOffline && !(esconderVazios && offline.length === 0) && (
          <Section title="Offline" count={offline.length}>{offline.map(linha('offline'))}</Section>
        )}
      </>
    );
  }

  return (
    <DialogoClaro
      variant="team"
      titulo="Nossa equipe"
      // Carregando ou com erro, "0 integrantes, 0 online" seria uma afirmação
      // falsa (ATD-EQM-01/07): só a lista pronta tem contagem.
      descricao={status === 'ready' ? `${plural(counts.all, 'integrante na equipe', 'integrantes na equipe')}, ${counts.online} online agora` : null}
      onClose={onClose}
      celular={celular}
      // Só de leitura: o clique no fundo também fecha, como antes.
      closeOnBackdrop
      className="eq-dialogo"
    >
      <div className="eq-ferramentas">
        <label className="mc-busca">
          <IconeBuscar tamanho={18} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar um integrante da equipe…"
            aria-label="Buscar um integrante da equipe"
          />
        </label>
        <div role="group" aria-label="Filtrar equipe" className="eq-filtros">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              aria-pressed={filter === item.key}
              className="eq-filtro"
            >
              {item.label}
              {status === 'ready' && <span className="eq-filtro-total">{counts[item.key]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="mc-corpo eq-corpo">{corpo}</div>

      <div className="mc-rodape">
        <p className="mc-nota">A carga vem dos atendimentos ativos de cada um.</p>
      </div>
    </DialogoClaro>
  );
}

export default TeamModal;
