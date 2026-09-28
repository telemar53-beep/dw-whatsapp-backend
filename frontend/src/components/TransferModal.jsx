import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';
import { transferConversation } from '../services/api';
import { Dialog } from './ui/Dialog';
import AgentAvatar from './AgentAvatar';
import { IconeBuscar, IconeRecolher, IconeTransferir } from './icones';
import { descreverErro } from '../utils/errorMessages';
import './dialogo-transferir.css';

// "Transferir atendimento", o mesmo diálogo na mesa e na Supervisão. Claro e
// sólido (folha própria, dialogo-transferir.css): sem o desfoque, a animação e
// a sombra da base, e sem o "×" dela — a saída é "Fechar" no desktop e a seta
// de voltar no celular, nunca as duas. Chega sob demanda nas duas páginas.

// Nível de carga pelo número de atendimentos abertos. Os limites são uma
// escolha de produto (não vêm do backend): quem está offline nunca é sugerido
// como "disponível", e a partir de 10 conversas o atendente é marcado para
// desencorajar mais uma transferência.
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

// A cor da presença no diálogo claro: verde para quem pode receber, cinza para
// movimentado e offline, vermelho só na carga alta. Laranja não entra aqui. A
// cor nunca vai sozinha: o nível está escrito ao lado.
const TOM_DA_PRESENCA = { green: 'verde', yellow: 'verde', orange: 'neutro', gray: 'neutro', red: 'alerta' };

const SORTS = [
  { key: 'load', label: 'Menor carga' },
  { key: 'name', label: 'Nome' },
];

// O mesmo corte de celular do popup da Supervisão (ConversaDaSupervisao.jsx).
// Decidido aqui, e não pelo CSS: a saída é uma só (seta ou "Fechar") e o foco
// inicial muda — no celular, o teclado não sobe sozinho por cima da lista.
const CELULAR = '(max-width: 767px)';
function assinarTela(aviso) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const consulta = window.matchMedia(CELULAR);
  consulta.addEventListener('change', aviso);
  return () => consulta.removeEventListener('change', aviso);
}
function telaDeCelular() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(CELULAR).matches;
}
function useCelular() {
  return useSyncExternalStore(assinarTela, telaDeCelular, () => false);
}

const PARA_A_ESQUERDA = { transform: 'rotate(90deg)' };

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Só o primeiro nome no botão: o nome inteiro estourava o rodapé em telas
// estreitas. O nome completo continua na linha escolhida.
function primeiroNomeDe(a) {
  const partes = String(a.name || a.email || '').trim().split(/\s+/).filter(Boolean);
  return partes[0] || 'atendente';
}

function AgentRow({ agent, online, selecionado, tabulavel, onEscolher, tamanhoDoAvatar }) {
  const id = useId();
  const active = agent.activeConversations || 0;
  const level = loadLevel({ online, active });
  const displayName = agent.name || agent.email;
  return (
    <li>
      <button
        type="button"
        role="radio"
        aria-checked={selecionado}
        aria-labelledby={`${id}-nome`}
        aria-describedby={`${id}-presenca ${id}-carga`}
        tabIndex={tabulavel ? 0 : -1}
        data-agente={agent.id}
        onClick={onEscolher}
        className="tr-linha"
      >
        <span className="tr-avatar" aria-hidden="true">
          <AgentAvatar agentId={agent.id} avatarPath={agent.avatarPath} name={displayName} size={tamanhoDoAvatar} />
        </span>
        <span className="tr-quem">
          <span id={`${id}-nome`} className="tr-nome">{displayName}</span>
          <span id={`${id}-presenca`} className="tr-presenca" data-tom={TOM_DA_PRESENCA[level.tone]}>
            <i aria-hidden="true" />
            {level.label}
          </span>
        </span>
        <span id={`${id}-carga`} className="tr-carga">
          <span className="tr-carga-num"><strong>{active}</strong> {active === 1 ? 'atendimento' : 'atendimentos'}</span>
          <span className="tr-carga-dica" data-alerta={level.alert ? 'true' : undefined}>{level.hint}</span>
        </span>
        <span className="tr-marca" aria-hidden="true" />
      </button>
    </li>
  );
}

// Uma seção da lista (Disponíveis ou Offline): o título e a contagem são
// vistos; o nome do grupo leva os dois para quem ouve.
function Grupo({ titulo, online, children, total }) {
  return (
    <div role="group" aria-label={`${titulo}, ${total}`} className="tr-grupo">
      <p className="tr-grupo-titulo" aria-hidden="true">
        <i data-on={online ? 'true' : undefined} />
        {titulo}
        <b>{total}</b>
      </p>
      <ul className="tr-lista">{children}</ul>
    </div>
  );
}

// Enquanto a carga é conferida, a forma da lista sem nenhum número: ninguém
// decide com carga velha. Parado — sem piscar.
function Conferindo() {
  return (
    <div role="status" className="tr-carregando">
      <span className="tr-carregando-texto">Conferindo a carga atual dos atendentes…</span>
      <span className="tr-carregando-linhas" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="tr-carregando-linha"><i /><b /><b /></span>
        ))}
      </span>
    </div>
  );
}

function TransferModal({ conversationId, onClose }) {
  const { token, agent } = useAuth();
  // Mostra a carga de cada um e ordena por ela: a lista é conferida ao abrir,
  // e até lá o status fica "loading" (ninguém escolhe com carga velha).
  const { agents: allAgents, status, error: erroDaLista, refresh } = useAgents({ carga: true });
  const onlineIds = usePresence(allAgents);
  const celular = useCelular();
  const idBase = useId();
  const tituloId = `${idBase}-titulo`;
  const descricaoId = `${idBase}-descricao`;
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('load');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
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

  // Agrupar por disponibilidade é a ordem de "menor carga". Pedir "Nome" é
  // pedir uma lista alfabética: agrupar ali quebraria a ordem que a pessoa
  // acabou de escolher.
  const agrupar = sort !== 'name';
  const disponiveis = agrupar ? agents.filter(isOnline) : agents;
  const offline = agrupar ? agents.filter((a) => !isOnline(a)) : [];
  const naOrdemDaTela = [...disponiveis, ...offline];
  // A escolha vale sobre a lista INTEIRA: com a busca ela continua valendo, e
  // a nota diz quem está escolhido (A2-7).
  const escolhidoAgora = allAgents.find((a) => a.id === escolhido && a.id !== agent.id) || null;
  const escolhidoForaDaBusca = Boolean(escolhidoAgora) && !agents.some((a) => a.id === escolhidoAgora.id);
  // Um ponto de Tab só na lista: a linha escolhida, ou a primeira.
  const tabulavel = naOrdemDaTela.some((a) => a.id === escolhido) ? escolhido : naOrdemDaTela[0]?.id;

  async function transferir() {
    // O ref barra o segundo clique antes mesmo de o botão desabilitar.
    if (!escolhidoAgora || enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    try {
      await transferConversation(conversationId, escolhidoAgora.id, token);
      onClose();
    } catch (err) {
      setError(descreverErro(err, 'Não foi possível transferir este atendimento.'));
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  // Grupo de rádio: setas andam e escolhem, Home e End vão às pontas. Enter e
  // Espaço são do próprio botão da linha.
  function aoTeclarNaLista(evento) {
    const linhas = [...evento.currentTarget.querySelectorAll('[role=radio]')];
    const i = linhas.indexOf(document.activeElement);
    if (i < 0 || linhas.length === 0) return;
    const alvos = {
      ArrowDown: linhas[(i + 1) % linhas.length],
      ArrowRight: linhas[(i + 1) % linhas.length],
      ArrowUp: linhas[(i - 1 + linhas.length) % linhas.length],
      ArrowLeft: linhas[(i - 1 + linhas.length) % linhas.length],
      Home: linhas[0],
      End: linhas[linhas.length - 1],
    };
    const alvo = alvos[evento.key];
    if (!alvo) return;
    evento.preventDefault();
    alvo.focus();
    setEscolhido(alvo.dataset.agente);
  }

  const hasOthers = allAgents.some((a) => a.id !== agent.id);
  const linha = (a) => (
    <AgentRow
      key={a.id}
      agent={a}
      online={isOnline(a)}
      selecionado={escolhido === a.id}
      tabulavel={tabulavel === a.id}
      tamanhoDoAvatar={celular ? 36 : 40}
      onEscolher={() => setEscolhido(a.id)}
    />
  );

  let corpo;
  if (status === 'loading') {
    corpo = <Conferindo />;
  } else if (status === 'forbidden') {
    corpo = <p className="tr-aviso">Você não tem permissão para ver esta lista.</p>;
  } else if (status === 'error') {
    corpo = (
      <div role="alert" className="tr-falha">
        <span>{erroDaLista || 'Não foi possível carregar os atendentes.'}</span>
        <button type="button" className="tr-botao" onClick={refresh}>Tentar de novo</button>
      </div>
    );
  } else if (!hasOthers) {
    corpo = <p className="tr-vazio">Nenhum outro atendente disponível.</p>;
  } else {
    corpo = (
      <>
        {erroDaLista && (
          <div role="alert" className="tr-falha is-aviso">
            <span>Não foi possível conferir a carga agora. Os números são da última atualização.</span>
            <button type="button" className="tr-botao" onClick={refresh}>Tentar de novo</button>
          </div>
        )}
        {agents.length > 0 ? (
          <div role="radiogroup" aria-label="Atendente que vai receber" className="tr-escolha" onKeyDown={aoTeclarNaLista}>
            {agrupar ? (
              <>
                {disponiveis.length > 0 && <Grupo titulo="Disponíveis" online total={disponiveis.length}>{disponiveis.map(linha)}</Grupo>}
                {/* Offline no fim: quem está fora do turno não compete com quem pode receber agora. */}
                {offline.length > 0 && <Grupo titulo="Offline" total={offline.length}>{offline.map(linha)}</Grupo>}
              </>
            ) : (
              <ul className="tr-lista">{agents.map(linha)}</ul>
            )}
          </div>
        ) : (
          <p className="tr-vazio">Nenhum atendente encontrado com esse nome.</p>
        )}
      </>
    );
  }

  return (
    <Dialog
      variant="transfer"
      size=""
      labelledBy={tituloId}
      describedBy={descricaoId}
      onClose={onClose}
      dismissible={false}
      initialFocus={celular ? 'dialog' : 'auto'}
      className={`tr-dialogo${celular ? ' is-celular' : ''}`}
    >
      <div className="tr-cab">
        {celular ? (
          <button type="button" className="tr-voltar" aria-label="Voltar" onClick={onClose}>
            <IconeRecolher tamanho={22} style={PARA_A_ESQUERDA} />
          </button>
        ) : (
          <span className="tr-cab-icone" aria-hidden="true"><IconeTransferir tamanho={22} /></span>
        )}
        <div className="tr-cab-texto">
          <h2 id={tituloId}>Transferir atendimento</h2>
          <p id={descricaoId}>Escolha o atendente que continuará esta conversa.</p>
        </div>
        {!celular && <button type="button" className="tr-fechar" onClick={onClose}>Fechar</button>}
      </div>

      <div className="tr-ferramentas">
        <label className="tr-busca">
          <IconeBuscar tamanho={18} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar atendente por nome…"
            aria-label="Buscar atendente por nome"
          />
        </label>
        <label className="tr-ordem">
          <span className="tr-ordem-rotulo" aria-hidden="true">Ordenar por</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Ordenar por">
            {SORTS.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
          <IconeRecolher tamanho={18} className="tr-ordem-seta" />
        </label>
      </div>

      <div className="tr-corpo">{corpo}</div>

      {error && <p role="alert" className="tr-erro">{error}</p>}
      {enviando && <p role="status" className="sr-only">Transferindo o atendimento…</p>}

      <div className="tr-rodape">
        <p className="tr-nota">
          {escolhidoForaDaBusca
            ? `Escolhido: ${escolhidoAgora.name || escolhidoAgora.email} (fora da busca).`
            : 'A transferência será registrada no histórico da conversa.'}
        </p>
        <div className="tr-acoes">
          <button type="button" className="tr-botao" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="tr-botao is-principal"
            onClick={transferir}
            disabled={!escolhidoAgora || enviando}
          >
            {/* No celular o botão tem meia largura: o nome quebrava a linha, e a escolha já está à vista. */}
            {enviando ? 'Transferindo…' : escolhidoAgora && !celular ? `Transferir para ${primeiroNomeDe(escolhidoAgora)}` : 'Transferir'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export default TransferModal;
