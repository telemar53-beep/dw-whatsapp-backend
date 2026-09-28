import { memo, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useUnreadMyConversations } from '../hooks/useUnreadMyConversations';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { useCompanyName } from '../hooks/useCompanyName';
import { useDicaFlutuante, DicaFlutuante } from '../components/DicaFlutuante';
import { useTransferNotice } from '../hooks/useTransferNotice';
import TransferNotice from '../components/TransferNotice';
import { closeConversation } from '../services/api';
import QueueList from '../components/QueueList';
import MyConversationsList from '../components/MyConversationsList';
import ConversationView from '../components/ConversationView';
import ChannelStatusBanner from '../components/ChannelStatusBanner';
import TrilhoDaMesa, { IconeDoMenu, iniciais } from '../components/TrilhoDaMesa';
import { VARIANTE_DA_MESA } from '../components/ConversaDaMesa';
import { marcaDaInstalacao } from '../branding';
import { aplicarContatoSalvo } from '../utils/contatoSalvo';
import { sobDemanda, useSobDemanda } from '../utils/sobDemanda';
import { useAlert } from '../hooks/useAlert';
import { Tabs } from '../components/ui/Tabs';
import { IconLock } from '../components/icons/WaIcons';
import { IconeNovaConversa, IconeBuscar, IconeRecolher } from '../components/icones';
import './dashboard.css';
import './mesa.css';

// A conversa aberta só redesenha com o que é dela. Evento de outra conversa,
// busca, troca de aba ou aviso redesenham a página, mas a conversa aberta
// continua com as mesmas props — `conversation` mantém a referência (os hooks
// da lista trocam só o item afetado), os setters são estáveis e o `onBack` vem
// de useCallback. Comparação rasa, de propósito: um comparador por campo
// congelaria o cabeçalho no primeiro campo esquecido (BUG-004, achado A2).
const ConversaAbertaDaMesa = memo(ConversationView);

// A transferência chega quando é aberta: a mesa não baixa nem avalia o diálogo
// (nem a folha dele) antes de alguém pedir (guardas/dialogosSobDemanda.test.jsx).
const TRANSFERENCIA = sobDemanda(() => import('../components/TransferModal'));
// A "Nova conversa" também: o formulário e a folha dele chegam no clique
// (guardas/bloco1SobDemanda.test.jsx), e nada dele roda com o diálogo fechado.
const NOVA_CONVERSA = sobDemanda(() => import('../components/StartConversationModal'));

// O chevron de recolher/expandir da família DW, girado: para a direita abre a
// lista estreita, para a esquerda volta à conversa.
const PARA_A_DIREITA = { transform: 'rotate(-90deg)' };
const PARA_A_ESQUERDA = { transform: 'rotate(90deg)' };

const TABS = [
  { value: 'inProgress', label: 'Atendimento' },
  { value: 'waiting', label: 'Espera' },
  { value: 'automation', label: 'Automação' },
];

function matchesSearch(conversation, term) {
  if (!term) return true;
  return [
    conversation.contactDisplayName,
    conversation.contactPhoneNumber,
    conversation.contactCityName,
    conversation.sectorName,
    conversation.lastMessageContent,
  ]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(term));
}

function DashboardPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { setConversationOpen, openProfile, closeMobileNav, profileVersion, mobileNavOpen, encaixeDoTrilho, encaixeDoIcone } = useOutletContext();
  const { queue, status: queueStatus, aplicarContatoSalvo: aplicarNaFila } = useQueue();
  const { conversations: myConversations, status: myConversationsStatus, aplicarContatoSalvo: aplicarNosMeus } = useMyConversations();
  const { name: companyName, status: companyNameStatus } = useCompanyName();
  const [activeTab, setActiveTab] = useState('inProgress');
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  // Espera e Automação também acendem o sinal de mensagem nova. `queue` já é
  // referência estável, então o hook não reassina os eventos a cada render.
  const { unreadIds, clearUnread } = useUnreadMyConversations(myConversations, selectedId, queue);
  const { notice: transferNotice, dismiss: dismissTransferNotice } = useTransferNotice();
  // Mede o espaço real da mesa (o menu troca de 196px para 64px sem a janela
  // mudar de tamanho, e media query não vê isso). A conversa tem piso; quem
  // cede é a lista, depois o painel. Nada sobrepõe a conversa.
  const colunasRef = useRef(null);
  const [painelAberto, setPainelAberto] = useState(false);
  const [listaAberta, setListaAberta] = useState(false);
  // A dica do rail e portada para o body: dentro da coluna ela era
  // recortada por tres ancestrais com overflow e nunca aparecia.
  const { gatilho: gatilhoDoExpandir, caixa: caixaDoExpandir } = useDicaFlutuante();
  const layout = useWorkspaceLayout(colunasRef, painelAberto);
  const emRail = layout.lista === 'rail' && !listaAberta;
  const listaOcupaTudo = layout.lista === 'oculta' || listaAberta;

  // useCallback aqui não é enfeite: é o que faz o React.memo do
  // ConversationListItem valer. Recriada a cada render, esta função é uma prop
  // nova para os 40 itens da lista, e o memo compararia sem nunca encontrar
  // igualdade. Os três setters são estáveis e clearUnread já vem de useCallback.
  const selectConversation = useCallback((conversationId) => {
    clearUnread(conversationId);
    setSelectedId(conversationId);
    // Escolher um atendimento devolve o espaço para a conversa.
    setListaAberta(false);
  }, [clearUnread]);

  // Estável pelo mesmo motivo: recriada a cada render, derrubaria o memo da
  // conversa aberta.
  const voltarParaLista = useCallback(() => setSelectedId(null), []);

  // A conversa transferida cai em "Meus atendimentos", então abrir pelo aviso
  // também troca de aba — senão o atendente clica e não vê nada acontecer.
  function openTransferred(conversationId) {
    setActiveTab('inProgress');
    selectConversation(conversationId);
    dismissTransferNotice();
  }

  // Devolve a promessa: quem espera o resultado (e mostra o erro) é a
  // confirmação da linha (A4-4). Antes a falha era engolida aqui.
  const quickCloseConversation = useCallback(
    (conversationId) => closeConversation(conversationId, null, token),
    [token]
  );

  const [transferringId, setTransferringId] = useState(null);
  const { avisar, alertDialog } = useAlert();
  const fecharTransferencia = useCallback(() => setTransferringId(null), []);
  const transferenciaNaoBaixou = useCallback(() => {
    setTransferringId(null);
    avisar('Não foi possível abrir a transferência. Verifique a conexão e tente de novo.', { tom: 'erro' });
  }, [avisar]);
  const Transferencia = useSobDemanda(TRANSFERENCIA, Boolean(transferringId), transferenciaNaoBaixou);
  const [startingConversation, setStartingConversation] = useState(false);
  const novaConversaNaoBaixou = useCallback(() => {
    setStartingConversation(false);
    avisar('Não foi possível abrir a nova conversa. Verifique a conexão e tente de novo.', { tom: 'erro' });
  }, [avisar]);
  const NovaConversa = useSobDemanda(NOVA_CONVERSA, startingConversation, novaConversaNaoBaixou);
  const [pendingConversation, setPendingConversation] = useState(null);

  // "Editar cliente" salvou, e a rota não emite evento. Sem isto, voltar à
  // lista e reabrir a conversa trazia o contato antigo — e a nota antiga ia de
  // novo para a edição. Só as conversas daquele contato mudam; as outras
  // mantêm a referência. Estável: a conversa aberta é memo.
  const aoSalvarContato = useCallback((salvo) => {
    aplicarNaFila(salvo);
    aplicarNosMeus(salvo);
    setPendingConversation((anterior) => (anterior ? aplicarContatoSalvo([anterior], salvo)[0] : anterior));
  }, [aplicarNaFila, aplicarNosMeus]);

  // Sem o useMemo, os dois filtros devolvem arrays NOVOS a cada render do
  // Dashboard — e uma lista nova é prop nova, o que derrubaria o memo dos itens
  // antes mesmo de ele comparar item por item.
  const waitingConversations = useMemo(() => queue.filter((c) => c.triageState !== 'pending'), [queue]);
  const automationConversations = useMemo(() => queue.filter((c) => c.triageState === 'pending'), [queue]);

  const tabCounts = {
    inProgress: myConversations.length,
    waiting: waitingConversations.length,
    automation: automationConversations.length,
  };

  const term = search.trim().toLowerCase();
  const visibleMine = myConversations.filter((c) => matchesSearch(c, term));
  const visibleWaiting = waitingConversations.filter((c) => matchesSearch(c, term));
  const visibleAutomation = automationConversations.filter((c) => matchesSearch(c, term));

  const selectedConversation =
    [...queue, ...myConversations].find((c) => c.id === selectedId) ||
    (pendingConversation && pendingConversation.id === selectedId ? pendingConversation : null);

  // A casca esconde o botão "Abrir menu" quando isto é verdade, então a
  // condição tem de ser "a conversa ocupa a tela inteira" — exatamente a mesma
  // em que a lista é escondida, mais abaixo. Antes bastava HAVER conversa
  // selecionada, e isso apagava a única navegação do produto em dois casos
  // reais: de 500 a 767px, onde o rail continua visível e a conversa não ocupa
  // tudo, e no desktop com zoom de 200% (1366x768 vira 683x384).
  const conversaOcupaTudo = layout.lista === 'oculta' && !listaAberta && Boolean(selectedConversation);

  useEffect(() => {
    setConversationOpen(conversaOcupaTudo);
    return () => setConversationOpen(false);
  }, [conversaOcupaTudo, setConversationOpen]);

  useEffect(() => {
    if (pendingConversation && [...queue, ...myConversations].some((c) => c.id === pendingConversation.id)) {
      setPendingConversation(null);
    }
  }, [queue, myConversations, pendingConversation]);

  useEffect(() => {
    if (location.state && location.state.pendingConversation) {
      const conversation = location.state.pendingConversation;
      setPendingConversation(conversation);
      setSelectedId(conversation.id);
      navigate(location.pathname, { replace: true, state: null });
    }
    // Only ever consume the one-shot navigation payload on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="chat-workspace flex min-h-0 flex-1 flex-col">
      <div data-testid="channel-banner-wrapper" className={`mesa-aviso-canal relative ${selectedConversation ? 'hidden lg:block' : ''}`}>
        <ChannelStatusBanner />
      </div>

      <div ref={colunasRef} data-lista={layout.lista} data-painel={layout.painel} className="chat-workspace-columns flex min-h-0 min-w-0 flex-1 gap-0 overflow-hidden">
        {/* `mesa-clara`: a fundação clara vale só para esta coluna (mesa.css).
            A conversa ao lado continua com os tokens de antes, por enquanto. */}
        <aside
          aria-label="Atendimentos"
          className={`${
            listaOcupaTudo && selectedConversation && !listaAberta ? 'hidden' : 'flex'
          } chat-workspace-list mesa-lista mesa-clara ${emRail ? 'is-rail' : ''} ${listaOcupaTudo ? 'is-aberta' : ''} w-full min-w-0 shrink-0 flex-col overflow-clip`}
        >
          {emRail && (
            <button
              type="button"
              {...gatilhoDoExpandir}
              onClick={() => setListaAberta(true)}
              aria-label="Ver lista de atendimentos"
              className="chat-rail-expandir"
            >
              <IconeRecolher tamanho={18} style={PARA_A_DIREITA} />
              <DicaFlutuante caixa={caixaDoExpandir}>Ver lista de atendimentos</DicaFlutuante>
            </button>
          )}
          {listaAberta && (
            <button type="button" onClick={() => setListaAberta(false)} className="chat-lista-voltar">
              <IconeRecolher tamanho={16} style={PARA_A_ESQUERDA} />
              Voltar à conversa
            </button>
          )}
          <div className="chat-inbox-heading flex shrink-0 items-center justify-between gap-3">
            <h1 className="mesa-titulo">Conversas</h1>
            <button type="button" onClick={() => setStartingConversation(true)} aria-label="Nova conversa" className="mesa-acao">
              <IconeNovaConversa />
              <span className="mesa-dica" aria-hidden="true">Nova conversa</span>
            </button>
          </div>

          <div className="chat-inbox-search shrink-0">
            {/* O campo É a pílula: o anel de foco do tema desenha em volta
                dela inteira, e a lupa fica por cima, sem roubar o clique. */}
            <label className="mesa-busca">
              <IconeBuscar tamanho={18} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar conversa"
                aria-label="Buscar conversa"
              />
            </label>
          </div>

          {/* A contagem da fila só existia DENTRO do nome da aba ("Espera 12"),
              e nome de aba que muda não é anunciado: quem usa leitor de tela não
              sabia que entrou atendimento novo — o som avisa, a tela não. Região
              discreta e à parte, para não transformar a própria aba em live
              region (aí cada troca de aba viraria anúncio). */}
          {/* `aria-live` sem `role="status"`: a contagem da fila é conteúdo que
              se atualiza, não o estado de uma operação — e `role="status"` aqui
              ainda disputaria o papel com o aviso de transferência, que é um
              status de verdade. O anúncio é o mesmo. */}
          <p aria-live="polite" className="sr-only">
            {tabCounts.waiting} em espera, {tabCounts.inProgress} em andamento.
          </p>

          <div className="chat-inbox-tabs shrink-0 px-4 pb-1 pt-1">
            <Tabs
              look="segmented"
              label="Filas"
              active={activeTab}
              onChange={setActiveTab}
              tabs={TABS.map((tab) => ({ key: tab.value, label: tab.label, count: tabCounts[tab.value] }))}
            />
          </div>

          <div
            role="tabpanel"
            id={`tabpanel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}`}
            className="chat-scroll min-h-0 flex-1 overflow-y-auto pt-1"
          >
            {activeTab === 'inProgress' && (
              <MyConversationsList
                conversations={visibleMine}
                status={myConversationsStatus}
                onSelect={selectConversation}
                unreadIds={unreadIds}
                selectedId={selectedId}
                compact
                rail={emRail}
                variante="mesa"
              />
            )}
            {activeTab === 'waiting' && (
              <QueueList
                conversations={visibleWaiting}
                status={queueStatus}
                onSelect={selectConversation}
                unreadIds={unreadIds}
                onQuickClose={quickCloseConversation}
                selectedId={selectedId}
                emptyMessage="Nenhum atendimento em espera."
                compact
                rail={emRail}
                variante="mesa"
                soLocalidade
              />
            )}
            {activeTab === 'automation' && (
              <QueueList
                conversations={visibleAutomation}
                status={queueStatus}
                onSelect={selectConversation}
                unreadIds={unreadIds}
                onQuickClose={quickCloseConversation}
                selectedId={selectedId}
                emptyMessage="Nenhum atendimento em automação."
                compact
                rail={emRail}
                variante="mesa"
              />
            )}
          </div>
        </aside>

        <main
          className={`chat-workspace-main mesa-conversa ${
            listaOcupaTudo && !selectedConversation ? 'hidden' : listaOcupaTudo && listaAberta ? 'hidden' : 'block'
          } min-w-0 flex-1 overflow-clip`}
        >
          {selectedConversation ? (
            <ConversaAbertaDaMesa
              conversation={selectedConversation}
              painelModo={layout.painel}
              onPainelAbertoChange={setPainelAberto}
              onTransferClick={setTransferringId}
              onBack={voltarParaLista}
              onContatoSalvo={aoSalvarContato}
              workspace
              variante={VARIANTE_DA_MESA}
            />
          ) : (
            // Sem conversa: a marca desta instalação (a mesma do trilho, já em
            // cache), uma orientação e o registro. Sem ilustração. A marca vai
            // sobre o índigo do trilho: ela é desenhada para fundo escuro, e
            // logotipo não se recolore.
            <div className="mesa-vazia">
              {marcaDaInstalacao.compacta
                ? <span className="mesa-vazia-selo" aria-hidden="true" style={{ backgroundImage: `url("${marcaDaInstalacao.compacta}")` }} />
                : <span className="mesa-vazia-monograma" aria-hidden="true">{companyNameStatus === 'loading' ? '' : iniciais(companyName)}</span>}
              <p className="mesa-vazia-titulo">
                {companyNameStatus === 'loading' ? '' : companyName ? `${companyName} · Atendimento` : 'Atendimento'}
              </p>
              <p className="mesa-vazia-texto">
                Selecione uma conversa na lista ao lado para ler o histórico e responder ao cliente.
              </p>
              <p className="mesa-vazia-registro">
                <IconLock size={13} />
                Todo atendimento fica registrado no sistema.
              </p>
            </div>
          )}
        </main>
      </div>

      {transferringId && (Transferencia
        ? <Transferencia conversationId={transferringId} onClose={fecharTransferencia} />
        : <p role="status" className="sr-only">Abrindo a transferência…</p>)}
      {alertDialog}
      {startingConversation && (NovaConversa ? (
        <NovaConversa
          onClose={() => setStartingConversation(false)}
          onCreated={(conversation) => {
            setPendingConversation(conversation);
            setSelectedId(conversation.id);
            setStartingConversation(false);
          }}
        />
      ) : <p role="status" className="sr-only">Abrindo a nova conversa…</p>)}
      <TransferNotice notice={transferNotice} onOpen={openTransferred} onDismiss={dismissTransferNotice} />
      {/* Trilho e ícone do botão "Abrir menu" vão para os encaixes que a casca
          reserva na mesa (AppShell.jsx): chegam com esta página, e a casca não
          importa nada da mesa. Fora da casca (testes), não há encaixe. */}
      {encaixeDoTrilho && createPortal(
        <TrilhoDaMesa onProfileClick={openProfile} mobileOpen={mobileNavOpen} onMobileClose={closeMobileNav} profileVersion={profileVersion} />,
        encaixeDoTrilho
      )}
      {encaixeDoIcone && createPortal(<IconeDoMenu />, encaixeDoIcone)}
    </div>
  );
}

export default DashboardPage;
