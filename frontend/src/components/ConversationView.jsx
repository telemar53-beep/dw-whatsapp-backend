import { useState, useEffect, useLayoutEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useRolagemDaLinhaDoTempo } from '../hooks/useRolagemDaLinhaDoTempo';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAiSuggestion } from '../hooks/useAiSuggestion';
import { useCompanyName } from '../hooks/useCompanyName';
import { claimConversation, closeConversation, sendSgpBoletoPdf, sendSgpPix, sendSgpPixQr, sendSgpBarcode, analyzeReceipt } from '../services/api';
import MessageInput from './MessageInput';
import MessageAttachment from './MessageAttachment';
import MessageStatusTicks from './MessageStatusTicks';
import { descreverFalha } from '../utils/failureReasons';
import { rotuloDoAutor } from '../utils/messageAuthor';
import ContactAvatar from './ContactAvatar';
import PainelDadosCliente from './PainelDadosCliente';
import { IconeDadosCliente } from './icones/conversa';
import { PAINEL, CONVERSA_MINIMA } from '../hooks/useWorkspaceLayout';
import AiSuggestionCard from './AiSuggestionCard';
import { useAlert } from '../hooks/useAlert';
import {
  IconArrowLeft,
  IconChevronDown,
  IconHistory,
  IconTransfer,
  IconCheckCircle,
  IconClaim,
  IconLock,
  IconSearch,
  IconInfo,
} from './icons/WaIcons';
import { estadoDaJanela, JANELA_FECHADA, JANELA_INDETERMINADA } from '../utils/serviceWindow';

const OVERLAY_TYPES = ['image', 'video', 'sticker'];
const BLOCK_TYPES = ['document', 'location', 'pix'];

// De quanto em quanto tempo o estado da janela é recalculado sozinho. Sem isto
// a conta ficava presa no `now` do primeiro render: um chat aberto desde cedo
// continuava dizendo "aberta" muito depois de a janela ter fechado, e só um F5
// corrigia.
const RECALCULO_DA_JANELA_MS = 60000;

// A recusa do canal por janela de 24 h (131047). É a única autoridade de
// verdade sobre a janela; o nosso estado é palpite ao lado dela.
const RECUSA_POR_JANELA = '(131047)';

function foiRecusadaPorJanela(messages) {
  return messages.some((message) => {
    if (!message || message.direction !== 'outbound' || message.status !== 'failed') return false;
    const motivo = message.metadata && message.metadata.motivoFalha;
    return typeof motivo === 'string' && motivo.startsWith(RECUSA_POR_JANELA);
  });
}

function startOfDay(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// De que dia é esta mensagem, ou null quando não dá para saber. Duas
// armadilhas: startOfDay(new Date('lixo')) devolve NaN em vez de lançar (por
// isso Number.isNaN, e não só "valor falso"), e um createdAt nulo viraria 1970
// — uma data válida e absurda — em vez de "sem data".
function diaDaMensagem(value) {
  if (value === null || value === undefined || value === '') return null;
  const dia = startOfDay(value);
  return Number.isNaN(dia) ? null : dia;
}

function mesmoDiaDoCalendario(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(value) {
  const data = new Date(value);
  const hoje = new Date();
  if (mesmoDiaDoCalendario(data, hoje)) return 'Hoje';
  // "Ontem" é o dia ANTERIOR no calendário, não "86.400.000 ms atrás": num dia
  // de mudança de horário de verão a distância entre duas meias-noites locais é
  // de 23 h ou 25 h, e a subtração erra o dia. new Date(ano, mês, dia - 1) vira
  // o mês e o ano sozinho, então a conta funciona em 1º de janeiro também.
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  if (mesmoDiaDoCalendario(data, ontem)) return 'Ontem';
  // Mesma regra de antes (os últimos 7 dias do calendário, incluindo hoje),
  // só que contada em dias do calendário em vez de em milissegundos.
  const seisDiasAtras = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 6).getTime();
  if (startOfDay(data) >= seisDiasAtras) return data.toLocaleDateString('pt-BR', { weekday: 'long' });
  return data.toLocaleDateString('pt-BR');
}

function clockLabel(value) {
  if (!value) return null;
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Uma mensagem sem data legível não pode ficar escondida sob o cabeçalho do dia
// ANTERIOR, que é o que acontecia: sem separador, a bolha aparecia num dia que
// não é o dela, em silêncio. Ela ganha um grupo próprio e visível — e a próxima
// mensagem com data válida volta ao agrupamento da data dela, sem ficar presa
// aqui dentro.
const DIA_DESCONHECIDO = 'desconhecido';

function buildTimeline(messages) {
  const rows = [];
  let previousDay = null;
  let previousDirection = null;

  messages.forEach((message) => {
    const day = diaDaMensagem(message.createdAt);
    const grupo = day === null ? DIA_DESCONHECIDO : day;
    const dayChanged = grupo !== previousDay;

    if (dayChanged) {
      rows.push({
        kind: 'day',
        // A posição entra na chave porque o mesmo dia pode voltar depois de um
        // grupo desconhecido, e dois cabeçalhos não podem dividir a mesma chave.
        key: `day-${grupo}-${rows.length}`,
        label: day === null ? 'Data desconhecida' : dayLabel(message.createdAt),
      });
      previousDirection = null;
      previousDay = grupo;
    }

    rows.push({
      kind: 'message',
      key: message.id,
      message,
      firstOfGroup: previousDirection !== message.direction,
    });
    previousDirection = message.direction;
  });

  return rows;
}

// Todos os tipos de canal do sistema são WhatsApp; o que distingue é o nome dado
// ao canal em Configurações. Conversa sem canal na carga (ex.: recém-criada pelo
// popup "Nova conversa") não ganha linha inventada — cai no telefone.
function channelLine(conversation) {
  return conversation.channelName ? `WhatsApp · ${conversation.channelName}` : null;
}

import { formatPhone } from '../utils/phone';
import { descreverErro } from '../utils/errorMessages';
import { nomeDoLocal } from '../utils/place';
import { contatoSalvoDe, comContatoSalvo } from '../utils/contatoSalvo';
import { sobDemanda, useSobDemanda } from '../utils/sobDemanda';
import './conversa-painel.css';

// O painel do SGP (e a biblioteca de QR que ele usa) só chega quando o
// atendente pede: a conversa comum não baixa nem avalia nada dele.
const SgpLookupPanel = lazy(() => import('./SgpLookupPanel'));
// Editar cliente e Atendimentos anteriores abrem pouco: cada um chega quando a
// ação dele é pedida, e só ele (guardas/dadosClienteSobDemanda.test.jsx).
const EditContactModal = lazy(() => import('./EditContactModal'));
const ConversationHistoryModal = lazy(() => import('./ConversationHistoryModal'));
// O Encerrar chega quando é pedido, e com ele — só com ele — o módulo dos
// desenhos dos motivos: a conversa comum (mesa e Supervisão) não baixa nem
// avalia nada dele (guardas/dialogosSobDemanda.test.jsx). Sem React.lazy: com
// o trecho já em memória, o diálogo abre no mesmo render (utils/sobDemanda.js).
const ENCERRAMENTO = sobDemanda(() => import('./CloseReasonModal'));
// O "Enviar template" também: só existe com a janela de 24h fechada, e a
// conversa comum não baixa o diálogo nem a folha dele (guardas/bloco1SobDemanda).
const ENVIO_DE_TEMPLATE = sobDemanda(() => import('./SendTemplateModal'));

// Enquanto o código do modal chega: nada que mude o lugar das coisas; só o
// aviso para quem usa leitor de tela.
// Margem do popup em volta da conversa (o p-4/sm:p-8 do diálogo), para o
// palpite da largura antes da primeira medida.
const MOLDURA_DO_POPUP = 64;

const ABRINDO = <p role="status" className="sr-only">Abrindo…</p>;

// O estado da conversa, um nome só em toda a conversa (cabeçalho e painel
// "Dados do cliente"). `silent` é a conversa silenciada — um disparo (campanha
// ou SGP) que o cliente ainda não respondeu, fora de qualquer fila —, e não a
// da espera.
function conversationStatus(conversation) {
  if (conversation.status === 'closed') return { tipo: 'encerrado', label: 'Encerrado', dot: 'bg-chat-faint' };
  if (conversation.status === 'silent') return { tipo: 'silenciada', label: 'Silenciada', dot: 'bg-chat-faint' };
  if (conversation.assignedAgentId) return { tipo: 'atendimento', label: 'Em atendimento', dot: 'bg-chat-online' };
  if (conversation.triageState === 'pending') return { tipo: 'automacao', label: 'Em automação', dot: 'bg-chat-orange' };
  return { tipo: 'espera', label: 'Em espera', dot: 'bg-chat-orange' };
}

const ACTION =
  'flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[8px] text-[12.5px] font-medium leading-none transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';
// Tem borda e texto em cor cheia: pela regua do ui/Button isso e SECONDARY,
// nao ghost (ghost nao tem borda e usa texto apagado). O nome antigo era um
// convite a traducao errada na proxima migracao.
const ACTION_SECONDARY = `${ACTION} border border-white/[0.14] bg-transparent text-chat-text hover:bg-white/[0.08]`;
// Tres categorias distintas de propósito: assumir e a acao principal,
// transferir e secundaria, encerrar e irreversivel. Antes, assumir e encerrar
// compartilhavam o mesmo primario.
const ACTION_PRIMARY = `${ACTION} bg-accent px-3.5 text-on-accent shadow-[0_2px_10px_rgba(255,141,64,.16)] hover:bg-accent-strong`;
const ACTION_DANGER = `${ACTION} border border-wa-error-text/40 bg-wa-error-bg px-3.5 text-wa-error-text hover:brightness-110`;

function HeaderChip({ children, title, strong = false, className = '' }) {
  return (
    <span
      title={title || (typeof children === 'string' ? children : undefined)}
      className={`max-w-[180px] shrink-0 items-center truncate border-l border-white/[0.13] pl-2.5 text-[11.5px] leading-[16px] ${
        strong ? 'font-medium tabular-nums text-chat-muted' : 'text-chat-faint'
      } ${className}`}
    >
      {children}
    </span>
  );
}

function HeaderIconButton({ label, onClick, children, expanded, controls, botaoRef }) {
  return (
    <button
      ref={botaoRef}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-controls={expanded && controls ? controls : undefined}
      className={`${ACTION} w-8 text-chat-icon hover:bg-white/[0.08] hover:text-chat-text`}
    >
      {children}
    </button>
  );
}

// `variante`: o cabeçalho, a faixa de contexto e os ícones da mesa, passados
// pela página (components/ConversaDaMesa.jsx). A Supervisão passa a dela
// (components/supervisao/ConversaDaSupervisao.jsx), com um `Rodape` para
// quem só acompanha. Sem variante, a conversa é a do modal dos Encerrados. Vem
// de fora para que nada disso viaje no trecho que essas páginas também baixam.
// `onContatoSalvo`: quem monta a conversa ao lado de outro painel (o modal da
// Supervisão e dos Encerrados) recebe o que o "Editar cliente" salvou, já
// preso à conversa de onde saiu (utils/contatoSalvo.js).
// `popup`: a conversa aberta no popup da Supervisão e dos Encerrados. Lá os
// dados do cliente ficam à vista quando há espaço, e a troca de setor existe
// (como antes, no painel ao lado).
// `onPainelNoLugarChange`: avisa quem monta (o popup) quando um painel — Dados
// do cliente ou SGP — ocupa o lugar da conversa; o popup então esconde o
// fechar dele, e o voltar do painel é o único controle na tela.
function ConversationView({ conversation, onTransferClick, onBack, painelModo = 'coluna', onPainelAbertoChange, workspace = false, variante, onContatoSalvo, popup = false, onPainelNoLugarChange }) {
  const Cabecalho = variante && variante.Cabecalho;
  // O que a página põe no lugar do compositor quando quem olha não é quem
  // responde (a faixa de acompanhamento da Supervisão). Sem ele, nada — como
  // sempre foi na mesa.
  const Rodape = variante && variante.Rodape;
  const icones = variante && variante.icones;
  const IconeInfo = (icones && icones.Info) || IconInfo;
  const IconeResponder = (icones && icones.Responder) || IconChevronDown;
  const { token, agent } = useAuth();
  // `status` já é o estado do atendimento neste componente; o do carregamento
  // das mensagens entra com nome próprio.
  const {
    messages,
    status: messagesStatus,
    reloadMessages,
    sendMessage,
    appendMessage,
    temAnteriores,
    carregandoAnteriores,
    carregarAnteriores,
  } = useConversationMessages(conversation.id);
  // O relógio do cálculo da janela vive em estado, e não num `new Date()` solto
  // no corpo do render: assim a passagem do tempo (e o envio) conseguem
  // refazer a conta sem recarregar a página.
  const [agora, setAgora] = useState(() => new Date());
  const janela = estadoDaJanela({ channelType: conversation.channelType, messages, now: agora });
  const janelaFechada = janela === JANELA_FECHADA;
  const janelaIndeterminada = janela === JANELA_INDETERMINADA;
  const { quickReplies, status: quickRepliesStatus } = useQuickReplies();
  // O nome do provedor é configuração: o sistema roda em mais de uma empresa.
  // Pela rota pública, e não pela de admin: esta tela é do atendente comum.
  const { name: companyName } = useCompanyName();
  const isMine = conversation.assignedAgentId === agent.id && conversation.status !== 'closed';
  // Sem este guard, toda conversa aberta disparava GET /:id/ai-suggestion — mesmo
  // quando o atendente não é o dono (um 403 nos logs) e mesmo com a IA desligada.
  // Mesma condição isMine que já controla a exibição do card, mais abaixo.
  const { suggestion, send: sendSuggestion, edit: editSuggestion, discard: discardSuggestion } = useAiSuggestion(
    isMine ? conversation.id : null
  );
  const [showingHistory, setShowingHistory] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactOverride, setContactOverride] = useState(null);
  // A conversa que está na tela AGORA: a resposta de um "Salvar" que saiu de
  // outra conversa não toca no estado desta (ver o onSaved abaixo).
  const conversaNaTelaRef = useRef(conversation.id);
  conversaNaTelaRef.current = conversation.id;
  const [replyingTo, setReplyingTo] = useState(null);
  const { avisar, alertDialog, dispensar: dispensarAviso } = useAlert();
  const [sgpPanelOpen, setSgpPanelOpen] = useState(false);
  // "Dados do cliente" aberto pelo botão. No popup da Supervisão e dos
  // Encerrados, com espaço, o painel fica à vista mesmo sem o clique
  // (`dadosPorPadrao`, abaixo).
  const [dadosAbertos, setDadosAbertos] = useState(false);
  // O espaço é medido AQUI, no próprio componente, e não herdado da viewport.
  // Dentro do ConversationModal as duas divergem: a janela pode ter 1400px e o
  // diálogo 700px. Era essa divergência que deixava o painel do SGP em
  // `fixed inset-0` cobrindo a conversa inteira abaixo de 1024px.
  const raizRef = useRef(null);
  const voltarRef = useRef(null);
  const gatilhoSgpRef = useRef(null);
  const gatilhoClienteRef = useRef(null);
  const ultimoGatilhoRef = useRef(null);
  const [larguraReal, setLarguraReal] = useState(0);
  // Quando o espaço não comporta lista + conversa + painel, o painel deixa de
  // ser coluna e ocupa a área de trabalho, com volta explícita. Nunca por cima
  // da conversa: mensagem escondida atrás de painel foi problema real antes.
  useEffect(() => {
    const no = raizRef.current;
    if (!no || typeof ResizeObserver === 'undefined') return undefined;
    const observador = new ResizeObserver(([entrada]) => {
      setLarguraReal(Math.round(entrada.contentRect.width));
    });
    observador.observe(no);
    return () => observador.disconnect();
  }, []);

  // `painelModo` continua valendo quando quem monta já decidiu (a mesa, pelo
  // `useWorkspaceLayout`). Fora dela — o modal — a decisão sai da medida: se a
  // conversa não mantém seu piso com o painel ao lado, o painel substitui.
  const cabeAoLado = larguraReal === 0 || larguraReal >= PAINEL + CONVERSA_MINIMA;
  // No popup, antes da primeira medida, o palpite é a janela menos a moldura
  // do popup: sem ele, o celular mostraria o painel ao lado por um instante.
  const cabeNoPopup = larguraReal === 0
    ? typeof window === 'undefined' || window.innerWidth >= PAINEL + CONVERSA_MINIMA + MOLDURA_DO_POPUP
    : cabeAoLado;
  // Supervisão e Encerrados, com espaço: os dados do cliente ficam à vista o
  // tempo todo, sem fechar; o SGP, quando aberto, ocupa o lugar deles. Se
  // quem monta já decidiu alternar (o popup da Supervisão numa tela de
  // celular), os dados só aparecem quando pedidos, no lugar da conversa.
  const dadosPorPadrao = popup && cabeNoPopup && painelModo !== 'alternado';
  const dadosVisiveis = !sgpPanelOpen && (dadosAbertos || dadosPorPadrao);
  const painelAberto = sgpPanelOpen || dadosVisiveis;
  // Só o que o atendente abriu ele fecha (Escape, voltar, fechar).
  const painelFechavel = sgpPanelOpen || dadosAbertos;
  const modoEfetivo = painelModo === 'alternado' || !cabeAoLado ? 'alternado' : 'coluna';
  const painelAlternado = modoEfetivo === 'alternado' && painelAberto;

  // O foco volta ao botão que abriu o painel DEPOIS do render que o fecha. No
  // celular, até esse render, o botão está na conversa ainda escondida, e o
  // foco cairia no corpo da página.
  const focoPendenteRef = useRef(null);
  useEffect(() => {
    const alvo = focoPendenteRef.current;
    if (!alvo) return;
    focoPendenteRef.current = null;
    if (alvo.current) alvo.current.focus();
  }, [sgpPanelOpen, dadosVisiveis]);

  function fecharPaineisEDevolverFoco() {
    setSgpPanelOpen(false);
    setDadosAbertos(false);
    focoPendenteRef.current = ultimoGatilhoRef.current;
  }

  // Antes da pintura: o fechar do popup some no mesmo quadro em que o painel
  // toma o lugar da conversa, sem um instante com os dois controles.
  const painelAlternadoRef = useRef(painelAlternado);
  painelAlternadoRef.current = painelAlternado;
  useLayoutEffect(() => {
    if (onPainelNoLugarChange) onPainelNoLugarChange(painelAlternado);
  }, [painelAlternado, onPainelNoLugarChange]);

  // ESC fecha o painel e volta para a conversa. Nao entra na pilha de dialogos
  // de proposito: o painel nao e modal, e um dialogo aberto por cima dele tem
  // de continuar sendo o dono do ESC.
  useEffect(() => {
    if (!painelFechavel) return undefined;
    function aoTeclar(evento) {
      if (evento.key !== 'Escape' || evento.defaultPrevented) return;
      const dialogos = [...document.querySelectorAll('[data-dialog]')];
      // Um diálogo aberto por cima da conversa (Editar cliente, Histórico…).
      if (dialogos.some((dialogo) => !dialogo.contains(raizRef.current))) return;
      // Dentro do popup, o ESC é do popup — a não ser com o painel no lugar da
      // conversa: aí ele volta primeiro para a conversa (o popup, nesse
      // estado, não fecha com ESC).
      if (dialogos.length > 0 && !painelAlternadoRef.current) return;
      evento.stopPropagation();
      fecharPaineisEDevolverFoco();
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
    // fecharPaineisEDevolverFoco só usa setters e refs: a versão do render em
    // que o painel abriu serve até ele fechar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painelFechavel]);

  // Ao substituir a conversa, o foco precisa entrar no painel — senao ele fica
  // atras, num botao que a pessoa nao ve mais.
  useEffect(() => {
    if (painelAlternado && voltarRef.current) voltarRef.current.focus();
  }, [painelAlternado]);

  useEffect(() => {
    if (onPainelAbertoChange) onPainelAbertoChange(painelAberto);
  }, [painelAberto, onPainelAbertoChange]);

  function fecharSgp() {
    setSgpPanelOpen(false);
    focoPendenteRef.current = gatilhoSgpRef;
  }

  function fecharDados() {
    setDadosAbertos(false);
    focoPendenteRef.current = gatilhoClienteRef;
  }

  // Um painel por vez: abrir o SGP fecha os dados do cliente, e vice-versa.
  function alternarSgp() {
    ultimoGatilhoRef.current = gatilhoSgpRef;
    setDadosAbertos(false);
    setSgpPanelOpen((prev) => !prev);
  }

  function alternarCliente() {
    ultimoGatilhoRef.current = gatilhoClienteRef;
    if (dadosAbertos && !sgpPanelOpen) {
      fecharDados();
      return;
    }
    setSgpPanelOpen(false);
    setDadosAbertos(true);
  }
  const [closingReason, setClosingReason] = useState(false);
  const encerramentoNaoBaixou = useCallback(() => {
    setClosingReason(false);
    avisar('Não foi possível abrir o encerramento. Verifique a conexão e tente de novo.', { tom: 'erro' });
  }, [avisar]);
  const Encerramento = useSobDemanda(ENCERRAMENTO, closingReason, encerramentoNaoBaixou);
  // A sugestão que o atendente escolheu editar: { id, content } enquanto o texto
  // está no campo de digitação, ou null. Enquanto ela existir, o próximo envio de
  // texto simples é atribuído a essa sugestão (rota de IA) em vez do envio comum.
  const [editedSuggestion, setEditedSuggestion] = useState(null);
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const templateNaoBaixou = useCallback(() => {
    setSendingTemplate(false);
    avisar('Não foi possível abrir o envio de template. Verifique a conexão e tente de novo.', { tom: 'erro' });
  }, [avisar]);
  const EnvioDeTemplate = useSobDemanda(ENVIO_DE_TEMPLATE, sendingTemplate, templateNaoBaixou);
  const bottomRef = useRef(null);
  const linhaDoTempoRef = useRef(null);

  // A mesma análise que a triagem faz, pedida pelo atendente sobre a imagem que
  // ele escolheu. Só para quem está com a conversa: a rota também confere isso.
  function analisarComprovanteDaMensagem(messageId) {
    return analyzeReceipt(conversation.id, messageId, token);
  }

  useEffect(() => {
    setContactOverride(null);
    setEditingContact(false);
    setReplyingTo(null);
    // O SGP abre só pelo botão "Consultar SGP" — e cada abertura consulta de
    // novo. Trocar de conversa fecha o painel: nada da anterior fica na tela.
    setSgpPanelOpen(false);
    setDadosAbertos(false);
    setClosingReason(false);
    setEditedSuggestion(null);
    dispensarAviso();
    // ConversationView e MessageInput NÃO remontam ao trocar de conversa: sem
    // esta linha o relógio do cliente anterior continuaria valendo para o
    // próximo, e a janela dele seria julgada por um instante que não é o dele.
    setAgora(new Date());
  }, [conversation.id]);

  // O temporizador é recriado a cada conversa (mesmo motivo acima: nada aqui
  // remonta sozinho) e limpo ao desmontar — um setInterval esquecido continuaria
  // chamando setState de uma conversa que ninguém está mais vendo.
  useEffect(() => {
    const relogio = setInterval(() => setAgora(new Date()), RECALCULO_DA_JANELA_MS);
    return () => clearInterval(relogio);
  }, [conversation.id]);

  // Fim da conversa na abertura e em mensagem nova; posição de leitura segura
  // quando o "Carregar mensagens anteriores" põe mensagens por cima.
  const { memorizarPosicao } = useRolagemDaLinhaDoTempo({
    linhaDoTempoRef,
    fimRef: bottomRef,
    messages,
    conversationId: conversation.id,
    carregandoAnteriores,
  });

  const isUnassigned = conversation.status !== 'closed' && !conversation.assignedAgentId;
  // Envio pelo painel do SGP: as rotas aceitam só quem é o responsável pela
  // conversa (não olham o status). A tela reflete essa regra — não cria outra.
  const podeEnviarSgp = Boolean(conversation.assignedAgentId) && conversation.assignedAgentId === agent.id;
  const motivoSemEnvioSgp = podeEnviarSgp
    ? null
    : conversation.assignedAgentId
      ? 'Só o responsável pelo atendimento pode enviar ao cliente.'
      : 'Assuma o atendimento para enviar ao cliente.';
  const isAdmin = (agent.role === 'admin' || agent.role === 'manager') && conversation.status !== 'closed';
  // A conversa com o que o "Editar cliente" salvou nela — e só nela: a resposta
  // de outra conversa não bate o vínculo e é ignorada aqui.
  const conversaDoContato = comContatoSalvo(conversation, contactOverride);
  const displayName = conversaDoContato.contactDisplayName;
  // "Barão de Tromaí · Cândido Mendes" com localidade; só o município sem ela.
  const cityName = nomeDoLocal(conversaDoContato.contactLocalityName, conversaDoContato.contactCityName);
  const nameLabel = displayName || conversation.contactPhoneNumber || 'Conversa';
  const headerLabel = cityName ? `${nameLabel} - ${cityName}` : nameLabel;

  // Mensagem nova não era anunciada de forma nenhuma: a timeline é um <div> sem
  // papel, e nenhum estado da conversa tinha live region (medido: a consulta por
  // `[aria-live],[role=status],[role=alert],[role=log]` devolvia lista vazia).
  //
  // A timeline INTEIRA não pode virar `role="log"`: a cada troca de conversa o
  // leitor releria o histórico do começo. Então o anúncio é só da última
  // mensagem RECEBIDA, e só quando ela chega com a conversa JÁ aberta — abrir uma
  // conversa, ou trocar para outra, não é "mensagem nova".
  const [avisoDeMensagem, setAvisoDeMensagem] = useState('');
  const ultimaRecebidaRef = useRef(null);
  const conversaDoAvisoRef = useRef(null);

  useEffect(() => {
    const recebidas = messages.filter((mensagem) => mensagem.direction === 'inbound');
    const ultima = recebidas[recebidas.length - 1] || null;
    const mesmaConversa = conversaDoAvisoRef.current === conversation.id;
    conversaDoAvisoRef.current = conversation.id;
    const anterior = ultimaRecebidaRef.current;
    ultimaRecebidaRef.current = ultima ? ultima.id : null;
    if (!ultima || !mesmaConversa || anterior === null || anterior === ultima.id) {
      setAvisoDeMensagem('');
      return;
    }
    const resumo = ultima.content || (ultima.mediaType ? 'anexo' : 'mensagem');
    setAvisoDeMensagem(`Nova mensagem de ${headerLabel}: ${resumo}`);
  }, [messages, conversation.id, headerLabel]);

  // Só vale repetir o telefone embaixo quando o título é o nome do contato.
  const phoneLine = displayName && conversation.contactPhoneNumber ? conversation.contactPhoneNumber : null;
  const secondLine = channelLine(conversation) || phoneLine;
  // O telefone acompanha o status quando a 2ª linha ficou com o canal; se ele já
  // é a 2ª linha (conversa sem canal na carga), não repete.
  const statusPhone = phoneLine && secondLine !== phoneLine ? formatPhone(phoneLine) : null;
  const status = conversationStatus(conversation);

  async function handleSend(content, file, repliedToMessageId, isVoiceNote) {
    // Obrigatório, e não um detalhe: entre o render e o clique pode ter passado
    // tempo suficiente para a janela fechar. O aviso que o atendente vê ao
    // enviar tem que ser o de AGORA, nunca o `now` de quando a tela foi montada.
    // Continua sem bloquear nada — quem decide é o canal.
    setAgora(new Date());
    const pending = editedSuggestion;
    setEditedSuggestion(null);

    if (pending && file) {
      // Anexo ou áudio não passam pela rota de sugestão da IA (ela só aceita texto):
      // o rascunho foi abandonado em favor do arquivo, então descarta a sugestão
      // (melhor esforço — uma falha aqui não pode travar o envio do anexo) e segue
      // pelo caminho comum.
      try {
        await discardSuggestion(pending);
      } catch (err) {
        // ignorado de propósito: ver comentário acima
      }
    } else if (pending) {
      // Texto simples com uma sugestão pendente: marca 'edited' (ou 'sent', se o
      // atendente não mudou nada) no backend em vez de um envio comum.
      await sendSuggestion(pending, content);
      setReplyingTo(null);
      return;
    }

    await sendMessage(content, file, repliedToMessageId, isVoiceNote);
    setReplyingTo(null);
  }

  async function handleSendSgpPdf(contratoId, boletoLink) {
    const message = await sendSgpBoletoPdf(contratoId, conversation.id, boletoLink, token);
    appendMessage(message);
    return message;
  }

  async function handleSendSgpPix(contratoId, fatura) {
    const messages = await sendSgpPix(
      contratoId,
      conversation.id,
      { pixCode: fatura.pixCode, value: fatura.value, dueDate: fatura.dueDate, faturaId: fatura.id },
      token
    );
    messages.forEach((msg) => appendMessage(msg));
    return messages;
  }

  async function handleSendSgpPixQr(contratoId, fatura) {
    const messages = await sendSgpPixQr(
      contratoId,
      conversation.id,
      { pixCode: fatura.pixCode, value: fatura.value, dueDate: fatura.dueDate },
      token
    );
    messages.forEach((msg) => appendMessage(msg));
    return messages;
  }

  async function handleSendSgpBarcode(contratoId, fatura) {
    const messages = await sendSgpBarcode(
      contratoId,
      conversation.id,
      { barCode: fatura.barCode, value: fatura.value, dueDate: fatura.dueDate },
      token
    );
    messages.forEach((msg) => appendMessage(msg));
    return messages;
  }

  async function handleClaim() {
    try {
      await claimConversation(conversation.id, token);
    } catch (err) {
      avisar(descreverErro(err, 'Não foi possível assumir este atendimento.'), { tom: 'erro' });
    }
  }

  async function handleConfirmClose(reasonId) {
    await closeConversation(conversation.id, reasonId, token);
    setClosingReason(false);
  }

  async function handleSendSuggestion(item) {
    try {
      await sendSuggestion(item);
    } catch (err) {
      avisar(descreverErro(err, 'Não foi possível enviar a sugestão da IA.'), { tom: 'erro' });
    }
  }

  function handleEditSuggestion(item) {
    const text = editSuggestion(item);
    setEditedSuggestion({ id: item.id, content: text });
  }

  async function handleDiscardSuggestion(item) {
    try {
      await discardSuggestion(item);
    } catch (err) {
      avisar(descreverErro(err, 'Não foi possível descartar a sugestão da IA.'), { tom: 'erro' });
    }
  }

  const timeline = buildTimeline(messages);

  return (
    <div ref={raizRef} className={`conv-raiz ${workspace ? 'chat-workspace-conversation' : ''} ${painelAlternado ? 'is-painel-alternado' : ''} flex h-full`}>
      <div className="flex h-full min-w-0 flex-1 flex-col bg-transparent font-wa">
      {Cabecalho ? (
        <Cabecalho
          conversation={conversation}
          displayName={displayName}
          nameLabel={nameLabel}
          headerLabel={headerLabel}
          phoneLine={phoneLine}
          telefone={phoneLine ? formatPhone(phoneLine) : null}
          cityName={cityName}
          status={status}
          canal={channelLine(conversation)}
          podeAssumir={isUnassigned}
          podeAgir={isMine || isUnassigned || isAdmin}
          encerrarDiscreto={isUnassigned}
          onVoltar={onBack}
          onEditarContato={() => setEditingContact(true)}
          onAssumir={handleClaim}
          onTransferir={() => onTransferClick(conversation.id)}
          onEncerrar={() => setClosingReason(true)}
          onHistorico={() => setShowingHistory(true)}
          sgp={{ aberto: sgpPanelOpen, ref: gatilhoSgpRef, alternar: alternarSgp }}
          cliente={{ aberto: dadosVisiveis, ref: gatilhoClienteRef, alternar: alternarCliente }}
          painelNoLugar={painelAlternado}
          dadosAoLado={dadosPorPadrao}
        />
      ) : (
      <div className="chat-workspace-header @container z-10 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.07] px-2 py-2.5 md:px-5">
        {/* A base é 240px, não 0. Com `flex-1` puro (base 0%) o item nunca
            chega a transbordar a linha, então o `flex-wrap` do cabeçalho jamais
            disparava: a identidade era só clampada pelo `min-width` e o nome do
            cliente ficava com 63px de caixa para 70px de texto a 360px. Com
            base 240px, quando ela e as ações não cabem juntas, a identidade
            leva a primeira linha inteira e as ações descem — que é o que o
            `flex-wrap` estava ali para fazer. No desktop nada muda: 240 mais as
            ações cabem de sobra e o `flex-grow` continua distribuindo o resto. */}
        <div className="chat-workspace-header-identity flex min-w-[240px] flex-[1_1_240px] items-center gap-1.5">
        <button
          onClick={onBack}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] text-chat-icon hover:bg-white/10 md:hidden"
          aria-label="Voltar para a lista"
        >
          <IconArrowLeft size={22} />
        </button>
        <button
          onClick={() => setEditingContact(true)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-1 py-1 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"
          aria-label={`Editar cliente: ${headerLabel}`}
        >
          <ContactAvatar
            contactId={conversation.contactId}
            avatarPath={conversation.contactAvatarPath}
            displayName={displayName}
            phoneNumber={conversation.contactPhoneNumber}
            size={40}
            dark
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span title={phoneLine || nameLabel} className="truncate text-[16px] font-semibold leading-[21px] text-chat-text">{nameLabel}</span>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.065] px-2 py-0.5 text-[11px] font-medium text-chat-muted">
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                {status.label}
              </span>
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] leading-[16px] text-chat-muted">
              <span className="min-w-0 truncate">{secondLine || 'clique aqui para ver os dados do contato'}</span>
              {statusPhone && (
                <>
                  <span aria-hidden="true" className="text-chat-faint">·</span>
                  <span className="shrink-0 tabular-nums text-chat-muted">{statusPhone}</span>
                </>
              )}
            </span>
            {(conversation.protocolNumber || cityName || conversation.sectorName) && (
              <span className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden">
                {conversation.protocolNumber && (
                  <HeaderChip strong title={`Protocolo ${conversation.protocolNumber}`} className="hidden @min-[760px]:inline-flex">#{conversation.protocolNumber}</HeaderChip>
                )}
                {cityName && <HeaderChip className="hidden @min-[880px]:inline-flex">{cityName}</HeaderChip>}
                {conversation.sectorName && <HeaderChip className="hidden @min-[620px]:inline-flex">{conversation.sectorName}</HeaderChip>}
              </span>
            )}
          </span>
        </button>
        </div>
        <div className="chat-workspace-header-actions flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-[10px] border border-white/[0.09] bg-black/[0.10] p-0.5">
          <HeaderIconButton label="Ver atendimentos anteriores" onClick={() => setShowingHistory(true)}>
            <IconHistory size={20} />
          </HeaderIconButton>
          <HeaderIconButton label="Consultar SGP" expanded={sgpPanelOpen} controls="conv-painel-sgp" botaoRef={gatilhoSgpRef} onClick={alternarSgp}>
            <IconSearch size={20} />
          </HeaderIconButton>
          {/* Sem espaço ao lado (celular), os dados do cliente abrem daqui, no
              lugar da conversa. Com espaço, no popup, eles já estão à vista. */}
          {!dadosPorPadrao && (
            <HeaderIconButton label="Dados do cliente" expanded={dadosVisiveis} controls="conv-painel-cliente" botaoRef={gatilhoClienteRef} onClick={alternarCliente}>
              <IconeDadosCliente tamanho={20} />
            </HeaderIconButton>
          )}
          </div>
          <span aria-hidden="true" className="h-6 w-px bg-white/[0.12]" />
          {isUnassigned && (
            <button onClick={handleClaim} className={ACTION_PRIMARY}>
              <IconClaim size={18} />
              Assumir
            </button>
          )}
          {(isMine || isUnassigned || isAdmin) && (
            <>
              <button
                type="button"
                onClick={() => onTransferClick(conversation.id)}
                aria-label="Transferir atendimento"
                title="Transferir atendimento"
                className={`${ACTION_SECONDARY} w-8 @min-[400px]:w-auto @min-[400px]:px-3`}
              >
                <IconTransfer size={18} />
                <span className="hidden @min-[400px]:inline">Transferir</span>
              </button>
              <button
                type="button"
                onClick={() => setClosingReason(true)}
                aria-label="Encerrar atendimento"
                title="Encerrar atendimento"
                className={isUnassigned ? `${ACTION_SECONDARY} w-8` : ACTION_DANGER}
              >
                <IconCheckCircle size={18} />
                {!isUnassigned && 'Encerrar'}
              </button>
            </>
          )}
        </div>
      </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">{avisoDeMensagem}</p>
      <div ref={linhaDoTempoRef} className="chat-workspace-timeline chat-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-2 md:px-8">
        <div className="chat-workspace-system-note mx-auto mb-3 flex w-fit max-w-[90%] items-center gap-1.5 rounded-full bg-white/[0.13] px-4 py-2 text-center text-[13px] leading-[18px] text-chat-muted">
          <span className="shrink-0 text-chat-faint">
            <IconLock size={13} />
          </span>
          Este atendimento fica registrado no sistema da {companyName || 'empresa'}.
        </div>

        {/* Sem isto, histórico que falhou ao carregar era indistinguível de
            conversa sem mensagem nenhuma. */}
        {messagesStatus === 'error' && (
          <div
            role="alert"
            className="mx-auto mb-3 flex w-fit max-w-[90%] flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-[12px] border border-wa-error-text/30 bg-wa-error-bg px-4 py-2 text-center text-[13px] leading-[18px] text-wa-error-text"
          >
            <span>Não foi possível carregar as mensagens deste atendimento.</span>
            <button
              type="button"
              onClick={reloadMessages}
              className="rounded-[8px] border border-wa-error-text/40 px-2.5 py-1 text-[12.5px] font-medium transition hover:bg-wa-error-text/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Tentar de novo
            </button>
          </div>
        )}

        {messagesStatus === 'loading' && messages.length === 0 && (
          <p role="status" className="mb-3 text-center text-[13px] leading-[18px] text-chat-faint">
            Carregando mensagens…
          </p>
        )}

        {/* A conversa abre com as 50 mais novas; o resto vem quando pedirem.
            Botão, e não rolagem infinita: prepender enquanto a pessoa rola
            para cima exige recolocar a posição do scroll a cada lote, e errar
            isso faz a timeline pular na mão de quem está lendo. */}
        {temAnteriores && (
          <div className="mb-3 flex justify-center">
            <button
              type="button"
              onClick={() => {
                memorizarPosicao();
                carregarAnteriores();
              }}
              disabled={carregandoAnteriores}
              className="chat-carregar-anteriores rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 text-[12.5px] text-chat-muted transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              {carregandoAnteriores ? 'Carregando…' : 'Carregar mensagens anteriores'}
            </button>
          </div>
        )}

        {timeline.map((row) => {
          if (row.kind === 'day') {
            return (
              <div key={row.key} className="my-3 flex justify-center">
                <span className="chat-workspace-day rounded-full bg-white/[0.13] px-4 py-2 text-[13px] font-medium text-chat-muted">
                  {row.label}
                </span>
              </div>
            );
          }

          const message = row.message;
          const outbound = message.direction === 'outbound';
          // O código Pix vive em message.content, mas nunca pode aparecer como texto solto:
          // o cartão nativo (PixCardMessage) é quem mostra a prévia truncada dele.
          const hasText = message.messageType === 'pix' ? false : Boolean(message.content);
          const isSticker = message.messageType === 'sticker' && message.mediaPath;
          const metaMode = !hasText && OVERLAY_TYPES.includes(message.messageType) && message.mediaPath
            ? 'overlay'
            : !hasText && BLOCK_TYPES.includes(message.messageType)
              ? 'block'
              : 'float';
          const tight = metaMode === 'overlay' && !isSticker;
          const repliedToLabel = message.repliedToPreview
            ? message.repliedToPreview.direction === 'outbound'
              ? 'Você'
              : displayName || conversation.contactPhoneNumber || 'Conversa'
            : null;

          const meta = (
            <span
              className={`flex shrink-0 items-center gap-[3px] text-[12px] leading-[16px] ${
                metaMode === 'overlay' ? 'text-white' : 'text-chat-faint'
              }`}
            >
              {/* Selo permanente: o filete diz o autor pela borda, este selo
                  diz "IA" por escrito. Os dois no mesmo idioma cromático, para
                  não pedir análise de tonalidade. */}
              {outbound && message.sentBy === 'ai' && (
                <span className={`mr-1 rounded px-1 text-[10px] uppercase tracking-wide ${workspace ? 'bg-[var(--chat-ai-chip)] font-bold text-[var(--chat-ai-chip-ink)]' : 'bg-white/20'}`}>IA</span>
              )}
              {clockLabel(message.createdAt)}
              {outbound && <MessageStatusTicks status={message.status} />}
            </span>
          );

          return (
            <div
              key={row.key}
              data-mensagem-id={message.id}
              className={`flex ${outbound ? 'justify-end' : 'justify-start'} ${row.firstOfGroup ? 'chat-grupo-inicio mt-3' : 'mt-[6px]'}`}
            >
              <div
                className={`chat-workspace-bubble ${outbound ? 'is-outbound' : 'is-inbound'} ${isSticker ? 'is-sticker' : ''} ${outbound && message.sentBy === 'ai' ? 'is-ai' : ''} group relative max-w-[85%] md:max-w-[65%] ${
                  isSticker
                    ? ''
                    : `rounded-[16px] border border-white/[0.14] ${outbound ? 'bg-white/[0.12]' : 'bg-white/[0.14]'} ${
                        tight ? 'p-[3px]' : 'px-3 pb-2 pt-[8px]'
                      }`
                }`}
              >
                {workspace && outbound && !isSticker && row.firstOfGroup && (
                  <span className={`chat-message-author ${message.sentBy === 'ai' ? 'is-ai' : ''}`}>
                    {rotuloDoAutor(message)}
                  </span>
                )}
                {message.repliedToPreview && (
                  <div className="chat-citacao mb-1 flex overflow-hidden rounded-[10px] bg-black/20">
                    <span className="w-[4px] shrink-0 bg-chat-copper" />
                    <span className="min-w-0 flex-1 px-2 py-1">
                      <span className="block truncate text-[12.5px] font-medium leading-[18px] text-chat-copper">
                        {repliedToLabel}
                      </span>
                      <span className="block truncate text-[13px] leading-[18px] text-chat-muted">
                        {message.repliedToPreview.content || 'Mídia'}
                      </span>
                    </span>
                  </div>
                )}

                <MessageAttachment
                  message={message}
                  dark={!workspace}
                  onAnalyzeReceipt={isMine ? analisarComprovanteDaMensagem : undefined}
                  avatar={
                    !outbound ? (
                      <ContactAvatar
                        contactId={conversation.contactId}
                        avatarPath={conversation.contactAvatarPath}
                        displayName={displayName}
                        phoneNumber={conversation.contactPhoneNumber}
                        size={42}
                      />
                    ) : null
                  }
                />

                {hasText && (
                  <p className="chat-workspace-message-text whitespace-pre-wrap break-words text-[13px] leading-[21px] text-chat-text">
                    {message.content}
                    <span
                      aria-hidden="true"
                      className="inline-block h-[1px] align-bottom"
                      style={{ width: outbound ? 82 : 58 }}
                    />
                  </p>
                )}

                {outbound && message.status === 'failed' && (
                  <p className="mt-1 text-[12px] leading-[16px] text-red-400">
                    {message.metadata?.motivoFalha
                      ? `Não entregue: ${descreverFalha(message.metadata.motivoFalha)}`
                      : 'Não entregue'}
                  </p>
                )}

                {metaMode === 'float' && (
                  <span className="absolute bottom-[5px] right-[11px]">{meta}</span>
                )}
                {metaMode === 'overlay' && (
                  <span className="absolute bottom-[7px] right-[8px] rounded-full bg-black/35 px-1.5 py-[1px] backdrop-blur-[1px]">
                    {meta}
                  </span>
                )}
                {metaMode === 'block' && <span className="mt-1 flex justify-end">{meta}</span>}

                {isMine && hasText && (
                  <button
                    onClick={() => setReplyingTo(message)}
                    aria-label="Responder"
                    title="Responder"
                    className="absolute right-0 top-0 flex h-[22px] w-[26px] items-center justify-end rounded-tr-[18px] bg-[linear-gradient(to_left,rgba(255,255,255,0.14)_50%,rgba(255,255,255,0))] pr-[3px] text-chat-icon opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <IconeResponder size={19} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {!isMine && Rodape && <Rodape conversation={conversation} podeAssumir={isUnassigned} onAssumir={handleClaim} />}
      {isMine && (
        <>
          <AiSuggestionCard
            suggestion={suggestion}
            onSend={handleSendSuggestion}
            onEdit={handleEditSuggestion}
            onDiscard={handleDiscardSuggestion}
          />
          {/* Avisa, mas não bloqueia: o nosso relógio pode divergir do da Meta
              por alguns minutos, e impedir um envio que passaria seria pior do
              que deixar tentar. */}
          {janelaFechada && (
            <p className="chat-aviso mx-3 mb-1 flex items-start gap-2 rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-[13px] leading-[18px] text-chat-muted md:mx-5">
              <span aria-hidden="true" className="shrink-0 text-chat-copper">
                <IconeInfo size={16} />
              </span>
              <span>
                <strong className="font-semibold text-chat-text">Janela de 24h fechada.</strong> O WhatsApp só entrega
                texto livre até 24h depois da última mensagem do cliente — e template não reabre essa contagem, só a
                resposta dele. Enviar agora provavelmente vai falhar; use um template aprovado.
                <button
                  type="button"
                  onClick={() => setSendingTemplate(true)}
                  className="ml-1 font-semibold text-chat-orange underline underline-offset-2 hover:brightness-110"
                >
                  Enviar template
                </button>
              </span>
            </p>
          )}
          {/* Indeterminado: não bloqueia, não promete que está aberta e não
              anuncia fechada. Diz só o que se sabe — que não deu para conferir.
              O caminho do template aparece quando o canal já recusou por janela
              de 24 h: aí a dúvida acabou, e a recusa é dele, não nossa. */}
          {janelaIndeterminada && (
            <p className="chat-aviso mx-3 mb-1 flex items-start gap-2 rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-[13px] leading-[18px] text-chat-muted md:mx-5">
              <span aria-hidden="true" className="shrink-0 text-chat-copper">
                <IconeInfo size={16} />
              </span>
              <span>
                <strong className="font-semibold text-chat-text">Não foi possível conferir a janela de 24h.</strong> A
                hora da última mensagem do cliente veio ilegível, então não dá para dizer se a janela está aberta ou
                fechada. Você pode enviar normalmente — quem decide é o WhatsApp.
                {foiRecusadaPorJanela(messages) && (
                  <>
                    {' '}
                    Uma mensagem já foi recusada por estar fora da janela:
                    <button
                      type="button"
                      onClick={() => setSendingTemplate(true)}
                      className="ml-1 font-semibold text-chat-orange underline underline-offset-2 hover:brightness-110"
                    >
                      Enviar template
                    </button>
                  </>
                )}
              </span>
            </p>
          )}
          <MessageInput
            conversationId={conversation.id}
            onSend={handleSend}
            quickReplies={quickReplies}
            quickRepliesStatus={quickRepliesStatus}
            replyingTo={replyingTo}
            onCancelReply={() => setReplyingTo(null)}
            draftContent={editedSuggestion ? editedSuggestion.content : undefined}
            draftKey={editedSuggestion ? editedSuggestion.id : undefined}
            icones={icones}
          />
        </>
      )}
      {sendingTemplate && (EnvioDeTemplate ? (
        <EnvioDeTemplate
          conversationId={conversation.id}
          channelId={conversation.channelId}
          onClose={() => setSendingTemplate(false)}
          onSent={() => setSendingTemplate(false)}
        />
      ) : ABRINDO)}
      {showingHistory && (
        <Suspense fallback={ABRINDO}>
          <ConversationHistoryModal contactId={conversation.contactId} onClose={() => setShowingHistory(false)} />
        </Suspense>
      )}
      {editingContact && (
        <Suspense fallback={ABRINDO}>
        <EditContactModal
          // Reabrir depois de salvar parte do que foi salvo, nota inclusive:
          // com a nota da lista, salvar de novo devolvia a antiga ao servidor.
          conversation={conversaDoContato}
          onClose={() => setEditingContact(false)}
          // `conversation` aqui é a do render em que a edição foi salva: a
          // resposta que chegar depois de uma troca continua presa a ela.
          onSaved={(updated) => {
            const salvo = contatoSalvoDe(conversation, updated);
            // A lista (de quem montou a conversa) guarda o valor de qualquer
            // jeito; o estado desta só muda se a conversa ainda é a da tela —
            // senão a conversa aberta de outro contato redesenharia (A2).
            if (onContatoSalvo) onContatoSalvo(salvo);
            if (conversaNaTelaRef.current === salvo.conversationId) setContactOverride(salvo);
          }}
        />
        </Suspense>
      )}
      {closingReason && (Encerramento ? (
        <Encerramento
          onConfirm={handleConfirmClose}
          onClose={() => setClosingReason(false)}
          suggestedReasonId={conversation.suggestedReasonId}
        />
      ) : ABRINDO)}
      </div>
      {alertDialog}
      {sgpPanelOpen ? (
        <div className="conv-painel-slot is-sgp" id="conv-painel-sgp">
        {/* Um painel por conversa: sem a key ele só recebia um initialCpf novo
            e carregava para B o cliente, a fatura e o "enviado" de A. */}
        <Suspense fallback={<p role="status" className="sgp-carregando">Abrindo a verificação SGP…</p>}>
          <SgpLookupPanel
            key={conversation.id}
            onSendMessage={(content) => sendMessage(content)}
            onSendPdf={handleSendSgpPdf}
            onSendPix={handleSendSgpPix}
            onSendPixQr={handleSendSgpPixQr}
            onSendBarcode={handleSendSgpBarcode}
            onClose={painelAlternado ? fecharPaineisEDevolverFoco : fecharSgp}
            emTela={painelAlternado}
            initialCpf={conversation.contactSgpDocument || ''}
            podeEnviar={podeEnviarSgp}
            motivoSemEnvio={motivoSemEnvioSgp}
          />
        </Suspense>
        </div>
      ) : dadosVisiveis ? (
        // Fechado, o painel não existe: nada escondido no DOM. Ao lado da
        // conversa, 300 px (o mesmo encaixe do SGP); sem espaço, no lugar dela,
        // só com o voltar. Na mesa ele fecha; no popup com espaço, fica.
        <div className="conv-painel-slot is-cliente" id="conv-painel-cliente">
          <PainelDadosCliente
            key={conversation.id}
            conversation={conversaDoContato}
            estado={status}
            emTela={painelAlternado}
            onFechar={painelAlternado ? fecharPaineisEDevolverFoco : dadosPorPadrao ? undefined : fecharDados}
            voltarRef={voltarRef}
            onEditar={() => setEditingContact(true)}
            onHistorico={() => setShowingHistory(true)}
            trocaDeSetor={popup}
          />
        </div>
      ) : null}
    </div>
  );
}

export default ConversationView;
