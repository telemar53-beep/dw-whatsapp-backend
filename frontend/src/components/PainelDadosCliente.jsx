import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSectors } from '../hooks/useSectors';
import { setConversationSector } from '../services/api';
import { formatPhone } from '../utils/phone';
import { nomeDoLocal } from '../utils/place';
import { descreverErro } from '../utils/errorMessages';
import { IconeDadosCliente, IconeHistorico, IconeRecolher } from './icones/conversa';
import './painel-dados-cliente.css';

// Painel "Dados do cliente" — o mesmo na mesa, na Supervisão e nos
// Encerrados (substitui o CustomerPanel da mesa e o ConversationInfoPanel do
// popup). Mostra o que a conversa NÃO mostra: a nota interna e a triagem vêm
// primeiro; o que já está na faixa da conversa (setor, responsável,
// protocolo) fica recolhido em "Dados do atendimento".
//
// A conversa chega pronta da ConversationView: com o que o "Editar cliente"
// salvou (utils/contatoSalvo.js) e com o estado canônico dela. Nada aqui
// consulta o servidor ao abrir; só os setores, e só quando uma seção aberta
// precisa deles.

const IDENTIFICACAO = { memory: 'memória', phone: 'telefone', cpf: 'CPF', none: 'não identificado' };
const PARA_A_ESQUERDA = { transform: 'rotate(90deg)' };

function percentual(valor) {
  return valor == null ? null : `${Math.round(valor * 100)}%`;
}

function encerradoEm(valor) {
  return valor ? new Date(valor).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null;
}

// Mostra/esconde com o conteúdo montado só quando aberto: fechado, não há DOM
// nem consulta por trás dele.
function Recolhivel({ rotulo, variante, titulo: Titulo = null, children }) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  const botao = (
    <button type="button" className={`dc-recolhivel is-${variante}`} aria-expanded={aberto} aria-controls={aberto ? id : undefined} onClick={() => setAberto((a) => !a)}>
      <span>{rotulo}</span>
      <IconeRecolher tamanho={18} className="dc-seta" />
    </button>
  );
  return (
    <>
      {Titulo ? <Titulo className="dc-secao-titulo">{botao}</Titulo> : botao}
      {aberto && <div id={id} className="dc-recolhivel-corpo">{children}</div>}
    </>
  );
}

function Linha({ rotulo, children, inteira = false }) {
  return (
    <div className={inteira ? 'dc-linha is-inteira' : 'dc-linha'}>
      <dt>{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// O nome de um setor pelo id, buscando a lista só quando montado.
function NomeDoSetor({ id }) {
  const { sectors, status } = useSectors();
  if (status === 'loading') return <span className="dc-carregando">Carregando…</span>;
  if (status === 'error' || status === 'forbidden') return <span className="dc-erro-texto">Não foi possível carregar.</span>;
  return (sectors.find((s) => s.id === id) || {}).name || 'Não definido';
}

// Troca de setor: a mesma de antes (ConversationInfoPanel) — "Salvando…",
// erro que volta ao setor anterior, resposta atrasada ignorada —, com a lista
// de setores buscada só quando este seletor aparece.
function SeletorDeSetor({ conversation, onSalvo }) {
  const { token } = useAuth();
  const { sectors, status, refresh } = useSectors();
  const [sectorId, setSectorId] = useState(conversation.sectorId || '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const conversaAtual = useRef(conversation.id);
  conversaAtual.current = conversation.id;

  useEffect(() => {
    setSectorId(conversation.sectorId || '');
    setErro(null);
    setSalvando(false);
  }, [conversation.id, conversation.sectorId]);

  async function trocar(evento) {
    const valor = evento.target.value || null;
    const anterior = sectorId;
    const conversaDoPedido = conversation.id;
    setSectorId(valor || '');
    setErro(null);
    setSalvando(true);
    try {
      await setConversationSector(conversaDoPedido, valor, token);
      // Resposta que chega depois da troca de conversa não vale para a nova.
      if (conversaDoPedido !== conversaAtual.current) return;
      onSalvo(valor ? (sectors.find((s) => s.id === valor) || {}).name || null : '');
    } catch (err) {
      if (conversaDoPedido !== conversaAtual.current) return;
      setSectorId(anterior);
      setErro(descreverErro(err, 'Não foi possível alterar o setor. Tente de novo.'));
    } finally {
      if (conversaDoPedido === conversaAtual.current) setSalvando(false);
    }
  }

  if (status === 'error' || status === 'forbidden') {
    return (
      <div className="dc-setor-erro" role="alert">
        <span>Não foi possível carregar os setores.</span>
        <button type="button" className="dc-link" onClick={refresh}>Tentar de novo</button>
      </div>
    );
  }
  const carregando = status === 'loading';
  return (
    <div className="dc-seletor">
      {/* Rótulo à vista: sem ele, o setor aparecia duas vezes seguidas (na
          linha acima e no seletor), sem dizer o que o segundo faz. */}
      <span className="dc-rotulo" aria-hidden="true">Alterar setor</span>
      <select aria-label="Alterar setor" value={sectorId} onChange={trocar} disabled={carregando || salvando}>
        {carregando ? (
          <option value={sectorId}>Carregando setores…</option>
        ) : (
          <>
            <option value="">Selecione um setor</option>
            {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </>
        )}
      </select>
      {salvando && <span className="dc-carregando">Salvando…</span>}
      {erro && <span role="alert" className="dc-erro-texto">{erro}</span>}
    </div>
  );
}

function DadosDoAtendimento({ conversation, trocaDeSetor }) {
  const { agent } = useAuth();
  const [nomeDoSetorSalvo, setNomeDoSetorSalvo] = useState(null);
  useEffect(() => setNomeDoSetorSalvo(null), [conversation.id, conversation.sectorId]);
  // Mesma regra de antes: admin, gerente ou o responsável pela conversa. A
  // troca existe só no popup (Supervisão e Encerrados), como antes.
  const podeTrocar = trocaDeSetor && Boolean(agent)
    && (agent.role === 'admin' || agent.role === 'manager' || conversation.assignedAgentId === agent.id);
  const setor = (nomeDoSetorSalvo !== null ? nomeDoSetorSalvo : conversation.sectorName) || 'Não definido';
  const encerrado = encerradoEm(conversation.closedAt);
  return (
    <>
      <dl className="dc-lista">
        <Linha rotulo="Setor">{setor}</Linha>
      </dl>
      {podeTrocar && <SeletorDeSetor conversation={conversation} onSalvo={setNomeDoSetorSalvo} />}
      <dl className="dc-lista">
        <Linha rotulo="Responsável">{conversation.assignedAgentName || 'Não atribuído'}</Linha>
        {conversation.protocolNumber && <Linha rotulo="Protocolo">{conversation.protocolNumber}</Linha>}
        {encerrado && <Linha rotulo="Encerrado em">{encerrado}</Linha>}
      </dl>
    </>
  );
}

function Triagem({ conversation }) {
  const idTitulo = useId();
  const confianca = percentual(conversation.aiTriageConfidence);
  const baixa = Boolean(conversation.aiTriageLowConfidence);
  const resolvido = Boolean(conversation.aiTriageResolvedByAi);
  const setorDaIa = conversation.aiTriageSectorId;
  return (
    <section className="dc-secao" aria-labelledby={idTitulo}>
      <h3 id={idTitulo} className="dc-secao-titulo">Triagem por IA</h3>
      <p className="dc-rotulo">Motivo</p>
      <p className="dc-motivo">{conversation.aiTriageReasonName || 'Não definido'}</p>
      {conversation.aiTriageSummary && <p className="dc-resumo">{conversation.aiTriageSummary}</p>}
      {(baixa || resolvido) && (
        <p className="dc-indicadores">
          {baixa && <span className="dc-chip is-atencao">{confianca ? `Confiança baixa (${confianca})` : 'Confiança baixa'}</span>}
          {resolvido && <span className="dc-chip is-positivo">Resolvido pela IA</span>}
        </p>
      )}
      <Recolhivel rotulo="Detalhes da triagem" variante="caixa">
        <dl className="dc-lista is-grade">
          <Linha rotulo="Identificado por">{IDENTIFICACAO[conversation.aiTriageIdentifiedBy] || 'não identificado'}</Linha>
          <Linha rotulo="Confiança">{confianca || '—'}</Linha>
          <Linha rotulo="Setor da IA" inteira>
            {!setorDaIa
              ? 'Não definido'
              // O setor da IA quase sempre é o da conversa: o nome já veio.
              : setorDaIa === conversation.sectorId && conversation.sectorName
                ? conversation.sectorName
                : <NomeDoSetor id={setorDaIa} />}
          </Linha>
        </dl>
      </Recolhivel>
    </section>
  );
}

function PainelDadosCliente({ conversation, estado, emTela = false, onFechar, onEditar, onHistorico, trocaDeSetor = false, voltarRef }) {
  const telefone = conversation.contactPhoneNumber ? formatPhone(conversation.contactPhoneNumber) : null;
  const titulo = conversation.contactDisplayName || telefone || 'Conversa';
  const local = nomeDoLocal(conversation.contactLocalityName, conversation.contactCityName);
  const nota = conversation.contactInternalNote;
  const idNota = useId();
  const idCadastro = useId();

  return (
    <aside aria-label="Dados do cliente" className={`dados-cliente conv-painel ${emTela ? 'is-em-tela' : ''}`}>
      <header className="dc-topo">
        {emTela ? (
          <button ref={voltarRef} type="button" className="dc-voltar" aria-label="Voltar à conversa" title="Voltar à conversa" onClick={onFechar}>
            <IconeRecolher tamanho={22} style={PARA_A_ESQUERDA} />
          </button>
        ) : (
          <span className="dc-topo-icone" aria-hidden="true">
            <IconeDadosCliente />
          </span>
        )}
        <h2 className="dc-titulo">Dados do cliente</h2>
        {!emTela && onFechar && (
          <button type="button" className="dc-fechar" aria-label="Fechar dados do cliente" onClick={onFechar}>
            Fechar
          </button>
        )}
      </header>

      <div className="dc-corpo">
        <section className="dc-identidade" aria-label="Identificação">
          <h3 className="dc-nome">{titulo}</h3>
          {telefone && telefone !== titulo && <p className="dc-telefone">{telefone}</p>}
          <span className="dc-estado" data-estado={estado.tipo}>{estado.label}</span>
          <div className="dc-acoes">
            <button type="button" className="dc-acao" onClick={onEditar}>Editar cliente</button>
            <button type="button" className="dc-acao" onClick={onHistorico}>
              <IconeHistorico tamanho={18} />
              Histórico
            </button>
          </div>
        </section>

        <section className="dc-secao" aria-labelledby={idNota}>
          <h3 id={idNota} className="dc-secao-titulo">Nota interna</h3>
          {nota ? (
            <p className="dc-nota">{nota}</p>
          ) : (
            <p className="dc-vazio">
              <span>Nenhuma nota interna.</span> <span>Para adicionar, use Editar cliente.</span>
            </p>
          )}
        </section>

        {conversation.aiTriageCompletedAt && <Triagem conversation={conversation} />}

        <section className="dc-secao" aria-labelledby={idCadastro}>
          <h3 id={idCadastro} className="dc-secao-titulo">Cadastro</h3>
          <dl className="dc-lista">
            <Linha rotulo="Cidade">{local || 'Não informada'}</Linha>
          </dl>
        </section>

        <section className="dc-secao is-ultima">
          <Recolhivel rotulo="Dados do atendimento" variante="secao" titulo="h3">
            <DadosDoAtendimento conversation={conversation} trocaDeSetor={trocaDeSetor} />
          </Recolhivel>
        </section>
      </div>
    </aside>
  );
}

export default PainelDadosCliente;
