import { useState, useEffect, useLayoutEffect, useRef, useCallback, useId } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getConversationHistory, getMessages } from '../services/api';
import MessageAttachment from './MessageAttachment';
import WaDialog from './WaDialog';
import { IconArrowLeft, IconChevronDown } from './icons/WaIcons';
import { rotuloDoAutor } from '../utils/messageAuthor';
import './historico.css';

// Tamanho de cada página de mensagens pedida à rota: 50 de cada vez, das
// mais recentes para trás. Antes a conversa vinha inteira; 600 mensagens
// montadas de uma vez passavam de 2.400 elementos.
export const BLOCO_DE_MENSAGENS = 50;
// Largura do próprio modal abaixo da qual lista e detalhe não cabem lado a
// lado: viram duas telas, uma de cada vez.
const LARGURA_MESTRE_DETALHE = 640;
// Antes da primeira medida: a janela menos o respiro do fundo (16 px de cada
// lado), limitada à largura do modal.
const LARGURA_DO_MODAL = 900;
const RESPIRO_DO_FUNDO = 32;

function dataValida(valor) {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}
const hora = (data) => data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
const mesCurto = (data) => data.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');

// Quem estava com o atendimento; sem ninguém atribuído, quem encerrou — dito
// como tal, para não parecer que atendeu.
function responsavel(atendimento) {
  if (atendimento.assignedAgentName) return atendimento.assignedAgentName;
  return atendimento.closedByAgentName ? `Encerrado por ${atendimento.closedByAgentName}` : null;
}

function textoDaContagem(total) {
  if (total === 1) return '1 atendimento anterior';
  // A rota devolve no máximo 50: com 50, pode haver mais antigos.
  if (total >= 50) return `${total} atendimentos mais recentes`;
  return `${total} atendimentos anteriores`;
}

// A lista, com a requisição identificada: uma resposta que chega depois de
// "Tentar novamente" — ou depois de fechar — não vale mais.
function useAtendimentosAnteriores(contactId, token) {
  const [estado, setEstado] = useState({ status: 'carregando', itens: [] });
  const pedidoRef = useRef(0);
  const carregar = useCallback(() => {
    const pedido = ++pedidoRef.current;
    setEstado({ status: 'carregando', itens: [] });
    getConversationHistory(contactId, token).then(
      (itens) => {
        if (pedidoRef.current === pedido) setEstado({ status: 'pronto', itens: Array.isArray(itens) ? itens : [] });
      },
      (erro) => {
        if (pedidoRef.current === pedido) setEstado({ status: erro && erro.status === 403 ? 'sem-permissao' : 'erro', itens: [] });
      },
    );
  }, [contactId, token]);
  useEffect(() => {
    carregar();
    return () => {
      pedidoRef.current += 1;
    };
  }, [carregar]);
  return { ...estado, tentarDeNovo: carregar };
}

// As mensagens do atendimento escolhido, em páginas de 50 pedidas à rota
// (`limit` e `before`, ADR-010): a primeira traz as mais recentes; cada
// "Carregar mensagens anteriores" pede as anteriores à mais antiga mostrada.
//
// Cada pedido leva UMA A MAIS que a página (limit=51): a mais antiga dessas é
// só a sentinela — veio, há mais para trás; não veio, acabou. Assim um
// múltiplo exato de 50 não deixa o botão para um clique que volta vazio. A
// sentinela não é mostrada e não se perde: o cursor da página seguinte é a
// mais antiga mostrada, então ela volta como a mais recente da próxima.
//
// O que fica guardado leva o id de quem pediu, e cada geração de pedidos é
// numerada:
//  - trocar de atendimento some com as mensagens do anterior no mesmo render,
//    antes mesmo do pedido novo sair;
//  - uma resposta atrasada de A — a primeira página ou uma anterior —,
//    chegando com B aberto, é descartada;
//  - fechar invalida o que estiver no caminho.
const SEM_MENSAGENS = { status: 'carregando', mensagens: [], temMais: false, anteriores: 'ocioso' };
const PEDIDO_POR_PAGINA = BLOCO_DE_MENSAGENS + 1;
function separarSentinela(lista) {
  const recebidas = Array.isArray(lista) ? lista : [];
  const temMais = recebidas.length >= PEDIDO_POR_PAGINA;
  return { pagina: recebidas.length > BLOCO_DE_MENSAGENS ? recebidas.slice(recebidas.length - BLOCO_DE_MENSAGENS) : recebidas, temMais };
}
function useConversaDoAtendimento(id, token) {
  const [estado, setEstado] = useState({ id: null, ...SEM_MENSAGENS });
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  const pedidoRef = useRef(0);
  const paginaNoCaminhoRef = useRef(false);

  const carregar = useCallback(() => {
    if (!id) return;
    const pedido = ++pedidoRef.current;
    paginaNoCaminhoRef.current = false;
    setEstado((atual) => (atual.id === id ? { id, ...SEM_MENSAGENS } : atual));
    getMessages(id, token, { limit: PEDIDO_POR_PAGINA }).then(
      (lista) => {
        if (pedidoRef.current !== pedido) return;
        const { pagina, temMais } = separarSentinela(lista);
        setEstado({ id, status: 'pronto', mensagens: pagina, temMais, anteriores: 'ocioso' });
      },
      (erro) => {
        if (pedidoRef.current === pedido) setEstado({ id, ...SEM_MENSAGENS, status: erro && erro.status === 403 ? 'sem-permissao' : 'erro' });
      },
    );
  }, [id, token]);

  useEffect(() => {
    carregar();
    return () => {
      pedidoRef.current += 1;
      paginaNoCaminhoRef.current = false;
    };
  }, [carregar]);

  const carregarAnteriores = useCallback(() => {
    const atual = estadoRef.current;
    // Uma página por vez: com uma no caminho, o segundo clique não sai.
    if (paginaNoCaminhoRef.current || atual.id !== id || atual.status !== 'pronto' || !atual.temMais || atual.mensagens.length === 0) return;
    paginaNoCaminhoRef.current = true;
    const pedido = pedidoRef.current;
    const antesDe = atual.mensagens[0].id;
    setEstado((e) => ({ ...e, anteriores: 'carregando' }));
    getMessages(id, token, { limit: PEDIDO_POR_PAGINA, before: antesDe }).then(
      (lista) => {
        if (pedidoRef.current !== pedido) return;
        paginaNoCaminhoRef.current = false;
        const { pagina, temMais } = separarSentinela(lista);
        setEstado((e) => {
          // A fronteira pode vir repetida: o que já está na tela não entra de novo.
          const conhecidas = new Set(e.mensagens.map((m) => m.id));
          const novas = pagina.filter((m) => !conhecidas.has(m.id));
          return { ...e, mensagens: [...novas, ...e.mensagens], temMais, anteriores: 'ocioso' };
        });
      },
      () => {
        if (pedidoRef.current !== pedido) return;
        paginaNoCaminhoRef.current = false;
        // Só a página anterior falhou: as mensagens da tela ficam.
        setEstado((e) => ({ ...e, anteriores: 'erro' }));
      },
    );
  }, [id, token]);

  if (estado.id !== id) return { ...SEM_MENSAGENS, tentarDeNovo: carregar, carregarAnteriores };
  return { ...estado, tentarDeNovo: carregar, carregarAnteriores };
}

// Estreito = lista e detalhe em telas separadas. Mede o próprio modal, como a
// conversa mede a si mesma; antes da medida, o palpite pela janela evita que o
// celular mostre as duas colunas por um instante.
function useModoEstreito(ref) {
  const [estreito, setEstreito] = useState(() =>
    typeof window !== 'undefined' && Math.min(LARGURA_DO_MODAL, window.innerWidth - RESPIRO_DO_FUNDO) < LARGURA_MESTRE_DETALHE,
  );
  useLayoutEffect(() => {
    const no = ref.current;
    if (!no || typeof ResizeObserver === 'undefined') return undefined;
    const observador = new ResizeObserver(([entrada]) => {
      const largura = entrada.contentRect.width;
      if (largura > 0) setEstreito(largura < LARGURA_MESTRE_DETALHE);
    });
    observador.observe(no);
    return () => observador.disconnect();
  }, [ref]);
  return estreito;
}

function ItemDaLista({ atendimento, escolhido, onEscolher, registrar }) {
  const inicio = dataValida(atendimento.createdAt);
  const esteAno = new Date().getFullYear();
  const apoio = [inicio && hora(inicio), responsavel(atendimento), atendimento.channelName].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      ref={registrar}
      onClick={onEscolher}
      aria-current={escolhido ? 'true' : undefined}
      className="hi-item"
    >
      {/* O bloco da data é a única data do item; a completa vai só para o
          leitor de tela, no começo do nome. */}
      <span className="hi-data" aria-hidden="true">
        <b>{inicio ? inicio.getDate() : '–'}</b>
        {inicio && <small>{mesCurto(inicio)}{inicio.getFullYear() !== esteAno ? ` ${inicio.getFullYear()}` : ''}</small>}
      </span>
      <span className="hi-item-texto">
        <span className="sr-only">{inicio ? inicio.toLocaleDateString('pt-BR') : 'Início não informado'} </span>
        <span className="hi-motivo">{atendimento.closeReasonName || 'Sem motivo registrado'}</span>
        {apoio && <span className="hi-apoio">{apoio}</span>}
      </span>
      <IconChevronDown size={20} className="hi-seta" />
    </button>
  );
}

// A autoria vem só da origem gravada na mensagem: "Cliente" para o que
// chegou; para o que saiu, o mesmo rótulo da conversa (Atendente, Assistente
// IA, Campanha…). Nenhum nome de pessoa é deduzido.
const autorDe = (mensagem) => (mensagem.direction === 'outbound' ? rotuloDoAutor(mensagem) : 'Cliente');
const chaveDoDia = (data) => `${data.getFullYear()}-${data.getMonth()}-${data.getDate()}`;
const diaPorExtenso = (data) => data.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

// A conversa carregada, da mais antiga para a mais recente, com um separador
// quando o dia muda. Os separadores saem das próprias mensagens, a cada
// render: juntar uma página não tem como repetir um dia.
function linhasDaConversa(mensagens) {
  const linhas = [];
  let diaAnterior = null;
  let autorAnterior = null;
  for (const mensagem of mensagens) {
    const quando = dataValida(mensagem.createdAt);
    const dia = quando ? chaveDoDia(quando) : null;
    if (dia && dia !== diaAnterior) {
      linhas.push({ chave: `dia-${dia}`, dia: diaPorExtenso(quando) });
      diaAnterior = dia;
      autorAnterior = null;
    }
    const autor = autorDe(mensagem);
    linhas.push({ chave: mensagem.id, mensagem, inicioDoGrupo: autor !== autorAnterior });
    autorAnterior = autor;
  }
  return linhas;
}

function Bolha({ mensagem, inicioDoGrupo }) {
  const saida = mensagem.direction === 'outbound';
  const quando = dataValida(mensagem.createdAt);
  return (
    <li className={`hi-msg ${saida ? 'is-saida' : 'is-entrada'}${mensagem.sentBy === 'ai' ? ' is-ia' : ''}${inicioDoGrupo ? ' is-inicio' : ''}`}>
      {inicioDoGrupo && <span className="hi-autor">{autorDe(mensagem)}</span>}
      {mensagem.content && <p className="hi-texto">{mensagem.content}</p>}
      <MessageAttachment message={mensagem} sobDemanda />
      {quando && <time dateTime={mensagem.createdAt} className="hi-hora">{hora(quando)}</time>}
    </li>
  );
}

// A conversa carregada. Cada página antiga entra por cima sem tirar do lugar o
// que estava à vista.
function MensagensDoAtendimento({ mensagens, temMais, anteriores, onCarregarAnteriores }) {
  const rolagemRef = useRef(null);
  const primeiraId = mensagens.length ? mensagens[0].id : null;
  const primeiraRenderizadaRef = useRef(primeiraId);
  const antesRef = useRef(null);
  // Mensagens antigas entrando por cima: este render ainda enxerga o DOM do
  // commit anterior, e é a hora de medir (o getSnapshotBeforeUpdate das
  // classes). Medir no clique não serve: a página chega depois, e até lá a
  // conversa pode ter rolado ou uma foto ter crescido.
  if (primeiraId !== primeiraRenderizadaRef.current && rolagemRef.current && !antesRef.current) {
    antesRef.current = { altura: rolagemRef.current.scrollHeight, topo: rolagemRef.current.scrollTop };
  }
  useLayoutEffect(() => {
    primeiraRenderizadaRef.current = primeiraId;
    const antes = antesRef.current;
    const no = rolagemRef.current;
    antesRef.current = null;
    if (antes && no) no.scrollTop = antes.topo + (no.scrollHeight - antes.altura);
  }, [primeiraId]);

  // Abre no fim, como a conversa: o mais recente à vista.
  useLayoutEffect(() => {
    const no = rolagemRef.current;
    if (no) no.scrollTop = no.scrollHeight;
  }, []);

  // Uma foto que termina de carregar depois empurraria o fim para baixo da
  // dobra. Até o atendente mexer na rolagem, o fim continua à vista. O `load`
  // não sobe pela árvore, mas passa pela captura: um ouvinte só, no próprio
  // contêiner.
  const mexeuRef = useRef(false);
  useEffect(() => {
    const no = rolagemRef.current;
    if (!no) return undefined;
    const aoCarregar = () => {
      if (!mexeuRef.current) no.scrollTop = no.scrollHeight;
    };
    no.addEventListener('load', aoCarregar, true);
    return () => no.removeEventListener('load', aoCarregar, true);
  }, []);
  const soltar = () => {
    mexeuRef.current = true;
  };

  // Última página: o botão sai junto, e o foco não pode cair no <body>.
  const focarConversaRef = useRef(false);
  useLayoutEffect(() => {
    if (temMais || !focarConversaRef.current) return;
    focarConversaRef.current = false;
    if (rolagemRef.current) rolagemRef.current.focus();
  }, [temMais]);

  function carregarAnteriores() {
    soltar();
    focarConversaRef.current = true;
    onCarregarAnteriores();
  }

  const carregando = anteriores === 'carregando';
  return (
    <div ref={rolagemRef} className="hi-mensagens" tabIndex={-1} onWheel={soltar} onTouchStart={soltar} onKeyDown={soltar}>
      {(temMais || anteriores === 'erro') && (
        <div className="hi-anteriores">
          {anteriores === 'erro' && <p role="alert" className="hi-anteriores-erro">Não foi possível carregar as mensagens anteriores.</p>}
          {/* Indisponível sem `disabled`: o foco fica no botão enquanto a
              página chega. O segundo pedido quem barra é o hook. */}
          <button type="button" onClick={carregarAnteriores} aria-disabled={carregando || undefined} className="hi-anteriores-acao">
            {carregando ? 'Carregando mensagens anteriores…' : anteriores === 'erro' ? 'Tentar novamente' : 'Carregar mensagens anteriores'}
          </button>
        </div>
      )}
      <ol className="hi-conversa" aria-label="Mensagens">
        {linhasDaConversa(mensagens).map((linha) =>
          linha.dia ? (
            <li key={linha.chave} role="separator" className="hi-dia">
              {linha.dia}
            </li>
          ) : (
            <Bolha key={linha.chave} mensagem={linha.mensagem} inicioDoGrupo={linha.inicioDoGrupo} />
          ),
        )}
      </ol>
    </div>
  );
}

function ConversationHistoryModal({ contactId, onClose }) {
  const { token } = useAuth();
  const lista = useAtendimentosAnteriores(contactId, token);
  const [escolhidoId, setEscolhidoId] = useState(null);
  const escolhido = lista.itens.find((atendimento) => atendimento.id === escolhidoId) || null;
  const conversa = useConversaDoAtendimento(escolhido ? escolhido.id : null, token);

  const raizRef = useRef(null);
  const estreito = useModoEstreito(raizRef);
  const tituloId = useId();
  const contagemId = useId();
  const detalheTituloId = useId();

  // Foco: no celular, abrir um atendimento leva ao retorno; voltar devolve ao
  // item que o abriu. Aplicado depois do render que troca a tela.
  const itensRef = useRef(new Map());
  const voltarRef = useRef(null);
  const listaCorpoRef = useRef(null);
  const detalheCorpoRef = useRef(null);
  const focoPendenteRef = useRef(null);
  useEffect(() => {
    const alvo = focoPendenteRef.current;
    if (!alvo) return;
    focoPendenteRef.current = null;
    const no = alvo === 'voltar' ? voltarRef.current : itensRef.current.get(alvo);
    if (no) no.focus();
  }, [escolhidoId]);

  function escolher(atendimento) {
    if (estreito) focoPendenteRef.current = 'voltar';
    setEscolhidoId(atendimento.id);
  }
  function voltar() {
    focoPendenteRef.current = escolhidoId;
    setEscolhidoId(null);
  }
  // Escape (e o fundo): no celular, o detalhe volta primeiro para a lista.
  function pedirFechar() {
    if (estreito && escolhidoId) voltar();
    else onClose();
  }
  // "Tentar novamente" some com o aviso: o foco fica na área que recarrega.
  function tentarDeNovo(areaRef, tentar) {
    if (areaRef.current) areaRef.current.focus();
    tentar();
  }

  const temItens = lista.status === 'pronto' && lista.itens.length > 0;
  // Vazio, erro ou sem permissão: uma frase só, sem a altura da conversa.
  const compacto = lista.status !== 'carregando' && !temItens;
  const contagem = temItens ? textoDaContagem(lista.itens.length) : null;
  const noDetalhe = estreito && Boolean(escolhido);
  const inicio = escolhido ? dataValida(escolhido.createdAt) : null;
  const meta = escolhido
    ? [inicio ? `${inicio.getDate()} ${mesCurto(inicio)} ${inicio.getFullYear()}, ${hora(inicio)}` : 'Início não informado', escolhido.assignedAgentName, escolhido.channelName]
      .filter(Boolean)
      .join(' · ')
    : '';
  const encerradoPorOutro = escolhido && escolhido.closedByAgentName && escolhido.closedByAgentName !== escolhido.assignedAgentName;

  return (
    <WaDialog
      variant="history"
      labelledBy={tituloId}
      describedBy={contagem ? contagemId : undefined}
      onClose={pedirFechar}
      closeOnBackdrop
      dismissible={false}
      size="max-w-[900px]"
    >
      <div ref={raizRef} className={`hi-raiz ${estreito ? 'is-estreito' : 'is-largo'} ${temItens ? 'tem-itens' : 'sem-itens'}${compacto ? ' is-compacto' : ''}`}>
        <section className="hi-lista" hidden={noDetalhe} aria-labelledby={tituloId}>
          <header className="hi-cabeca">
            <h2 id={tituloId} className="hi-titulo">Histórico de atendimentos</h2>
            {contagem && <p id={contagemId} className="hi-contagem">{contagem}</p>}
          </header>
          <div ref={listaCorpoRef} className="hi-lista-corpo" tabIndex={-1}>
            {lista.status === 'carregando' && <p role="status" className="hi-estado">Carregando atendimentos…</p>}
            {lista.status === 'erro' && (
              <div role="alert" className="hi-aviso">
                <span>Não foi possível carregar os atendimentos.</span>
                <button type="button" onClick={() => tentarDeNovo(listaCorpoRef, lista.tentarDeNovo)} className="hi-aviso-acao">
                  Tentar novamente
                </button>
              </div>
            )}
            {lista.status === 'sem-permissao' && (
              <p role="alert" className="hi-aviso">Você não tem permissão para ver os atendimentos anteriores deste cliente.</p>
            )}
            {lista.status === 'pronto' && lista.itens.length === 0 && <p className="hi-estado">Nenhum atendimento anterior encontrado.</p>}
            {temItens && (
              <ul className="hi-itens" aria-label="Atendimentos anteriores">
                {lista.itens.map((atendimento) => (
                  <li key={atendimento.id}>
                    <ItemDaLista
                      atendimento={atendimento}
                      escolhido={escolhidoId === atendimento.id}
                      onEscolher={() => escolher(atendimento)}
                      registrar={(no) => {
                        if (no) itensRef.current.set(atendimento.id, no);
                        else itensRef.current.delete(atendimento.id);
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {temItens && !(estreito && !escolhido) && (
          <section className="hi-detalhe" aria-labelledby={escolhido ? detalheTituloId : undefined} aria-label={escolhido ? undefined : 'Atendimento selecionado'}>
            {escolhido ? (
              <>
                <header className="hi-detalhe-cabeca">
                  {estreito && (
                    <button ref={voltarRef} type="button" onClick={voltar} className="hi-voltar">
                      <IconArrowLeft size={20} />
                      Atendimentos anteriores
                    </button>
                  )}
                  <h3 id={detalheTituloId} className="hi-detalhe-titulo">{escolhido.closeReasonName || 'Sem motivo registrado'}</h3>
                  <p className="hi-detalhe-meta">{meta}</p>
                  {encerradoPorOutro && <p className="hi-detalhe-meta">Encerrado por {escolhido.closedByAgentName}</p>}
                </header>
                <div ref={detalheCorpoRef} className="hi-detalhe-corpo" tabIndex={-1}>
                  {conversa.status === 'carregando' && <p role="status" className="hi-estado">Carregando conversa…</p>}
                  {conversa.status === 'erro' && (
                    <div role="alert" className="hi-aviso">
                      <span>Não foi possível carregar a conversa.</span>
                      <button type="button" onClick={() => tentarDeNovo(detalheCorpoRef, conversa.tentarDeNovo)} className="hi-aviso-acao">
                        Tentar novamente
                      </button>
                    </div>
                  )}
                  {conversa.status === 'sem-permissao' && <p role="alert" className="hi-aviso">Você não tem permissão para ver esta conversa.</p>}
                  {conversa.status === 'pronto' && conversa.mensagens.length === 0 && (
                    <p className="hi-estado">Nenhuma mensagem neste atendimento.</p>
                  )}
                  {conversa.status === 'pronto' && conversa.mensagens.length > 0 && (
                    <MensagensDoAtendimento
                      key={escolhido.id}
                      mensagens={conversa.mensagens}
                      temMais={conversa.temMais}
                      anteriores={conversa.anteriores}
                      onCarregarAnteriores={conversa.carregarAnteriores}
                    />
                  )}
                </div>
              </>
            ) : (
              <p className="hi-orientacao">Selecione um atendimento para ver a conversa.</p>
            )}
          </section>
        )}
      </div>

      <div className="hi-rodape">
        <span className="hi-nota">Somente leitura</span>
        {!noDetalhe && (
          <button type="button" onClick={onClose} className="hi-fechar">
            Fechar
          </button>
        )}
      </div>
    </WaDialog>
  );
}

export default ConversationHistoryModal;
