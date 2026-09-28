import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Dialog } from './ui/Dialog';
import { useReasons } from '../hooks/useReasons';
import { IconeEncerrar, IconeRecolher } from './icones';
import { IconeDoMotivo, chaveDoMotivo } from './icones/motivos';
import { descreverErro } from '../utils/errorMessages';
import './dialogo-encerrar.css';

// "Encerrar atendimento", o mesmo diálogo na mesa e na Supervisão. Claro e
// sólido (folha própria, dialogo-encerrar.css): motivos em duas colunas no
// desktop e uma no celular, o escolhido em vermelho muito suave e o vermelho
// cheio só na ação destrutiva. Chega sob demanda, e com ele — só com ele — o
// módulo dos desenhos dos motivos (icones/motivos.jsx).

// As legendas de sempre (eram do catálogo antigo), pela categoria que o módulo
// dá ao nome cadastrado. Categoria sem legenda aqui mostra só o nome: nenhum
// texto é inventado para copiar o mockup, e "Mudança de plano" não herda mais
// a legenda de endereço.
const LEGENDAS = {
  cancelamento: 'Solicitação de cancelamento',
  financeiro: 'Boletos, pagamentos, faturas',
  instalacao: 'Nova instalação',
  mudancaDeEndereco: 'Alteração de endereço',
  reativacao: 'Reativar serviço',
  resolvidoPelaIa: 'Atendimento finalizado pela IA',
  semResposta: 'Cliente não respondeu',
  suporteTecnico: 'Dúvidas, problemas técnicos',
  trocaDeSenha: 'Alteração de senha do cliente',
};

// O mesmo corte de celular do popup da Supervisão (ConversaDaSupervisao.jsx) e
// do Transferir: a saída é uma só (seta ou "Fechar"), decidida aqui.
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

function ReasonCard({ reason, checked, onSelect, groupName }) {
  const id = useId();
  const legenda = LEGENDAS[chaveDoMotivo(reason.name)] || null;
  // Espaço já escolhe no rádio nativo; Enter também, sem enviar nada.
  function aoTeclar(evento) {
    if (evento.key !== 'Enter') return;
    evento.preventDefault();
    onSelect();
  }
  return (
    <label htmlFor={id} className={`en-cartao${checked ? ' is-escolhido' : ''}`}>
      <span className="en-icone" aria-hidden="true">
        <IconeDoMotivo nome={reason.name} tamanho={20} />
      </span>
      <span className="en-texto">
        <span id={`${id}-nome`} className="en-nome">{reason.name}</span>
        {legenda && <span id={`${id}-dica`} className="en-dica">{legenda}</span>}
      </span>
      <input
        id={id}
        type="radio"
        name={groupName}
        value={reason.id}
        checked={checked}
        onChange={onSelect}
        onKeyDown={aoTeclar}
        aria-labelledby={`${id}-nome`}
        aria-describedby={legenda ? `${id}-dica` : undefined}
        className="en-radio"
      />
    </label>
  );
}

// Enquanto os motivos chegam: a forma da grade, parada, e o aviso para quem ouve.
function Carregando() {
  return (
    <div role="status" className="en-carregando">
      <span className="en-carregando-texto">Carregando os motivos…</span>
      <span className="en-grade" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <span key={i} className="en-carregando-cartao"><i /><b /></span>)}
      </span>
    </div>
  );
}

function CloseReasonModal({ onConfirm, onClose, suggestedReasonId }) {
  const { reasons, status, error: erroDosMotivos, refresh } = useReasons();
  const celular = useCelular();
  const idBase = useId();
  const tituloId = `${idBase}-titulo`;
  const descricaoId = `${idBase}-descricao`;
  const grupo = `${idBase}-motivo`;
  // Pré-seleciona o motivo que a IA classificou, mas o atendente pode trocar:
  // a escolha final continua sendo dele. O diálogo é montado do zero a cada
  // "Encerrar", então o valor inicial já nasce certo, sem precisar de efeito.
  const [reasonId, setReasonId] = useState(suggestedReasonId || null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const enviandoRef = useRef(false);
  const grupoRef = useRef(null);
  const prontos = status === 'ready' && reasons.length > 0;

  // Os motivos chegam do servidor depois de o diálogo abrir: o foco da abertura
  // ficou no diálogo (não havia rádio). Quando eles chegam, o foco passa ao
  // motivo sugerido ou ao primeiro — a não ser que a pessoa já o tenha levado a
  // outro lugar.
  useEffect(() => {
    const grupo = grupoRef.current;
    if (!prontos || !grupo || document.activeElement !== grupo.closest('[role=dialog]')) return;
    const alvo = grupo.querySelector('input[type=radio]:checked') || grupo.querySelector('input[type=radio]');
    if (alvo) alvo.focus();
  }, [prontos]);

  async function handleConfirm() {
    // O ref barra o segundo clique antes mesmo de o botão desabilitar.
    if (!reasonId || enviandoRef.current) return;
    enviandoRef.current = true;
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(reasonId);
    } catch (err) {
      setError(descreverErro(err, 'Não foi possível encerrar este atendimento.'));
      enviandoRef.current = false;
      setSubmitting(false);
    }
  }

  let corpo;
  if (status === 'loading') {
    corpo = <Carregando />;
  } else if (status === 'forbidden') {
    corpo = <p className="en-aviso">Você não tem permissão para ver esta lista.</p>;
  } else if (status === 'error') {
    corpo = (
      <div role="alert" className="en-falha">
        <span>{erroDosMotivos || 'Não foi possível carregar os motivos.'}</span>
        <button type="button" className="en-botao" onClick={refresh}>Tentar de novo</button>
      </div>
    );
  } else if (reasons.length === 0) {
    corpo = (
      <p className="en-aviso">
        Nenhum motivo de contato cadastrado ainda. Peça a um administrador para cadastrar ao menos um motivo em Configurações → Motivos antes de encerrar este atendimento.
      </p>
    );
  } else {
    corpo = (
      <div ref={grupoRef} role="radiogroup" aria-label="Motivo do contato" className="en-grade">
        {reasons.map((reason) => (
          <ReasonCard
            key={reason.id}
            reason={reason}
            groupName={grupo}
            checked={reasonId === reason.id}
            onSelect={() => setReasonId(reason.id)}
          />
        ))}
      </div>
    );
  }

  return (
    <Dialog
      variant="close-reason"
      size=""
      labelledBy={tituloId}
      describedBy={descricaoId}
      onClose={onClose}
      dismissible={false}
      className={`en-dialogo${celular ? ' is-celular' : ''}`}
    >
      <div className="en-cab">
        {celular ? (
          <button type="button" className="en-voltar" aria-label="Voltar" onClick={onClose}>
            <IconeRecolher tamanho={22} style={PARA_A_ESQUERDA} />
          </button>
        ) : (
          <span className="en-cab-icone" aria-hidden="true"><IconeEncerrar tamanho={22} /></span>
        )}
        <div className="en-cab-texto">
          <h2 id={tituloId}>Encerrar atendimento</h2>
          <p id={descricaoId}>Selecione o motivo principal deste atendimento.</p>
        </div>
        {!celular && <button type="button" className="en-fechar" onClick={onClose}>Fechar</button>}
      </div>

      <div className="en-corpo">{corpo}</div>

      {error && <p role="alert" className="en-erro">{error}</p>}
      {submitting && <p role="status" className="sr-only">Encerrando o atendimento…</p>}

      <div className="en-rodape">
        <p className="en-nota">O cliente recebe a mensagem de encerramento e o motivo alimenta o Relatório.</p>
        <div className="en-acoes">
          <button type="button" className="en-botao" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="en-botao is-perigo"
            data-danger=""
            onClick={handleConfirm}
            disabled={!reasonId || submitting}
          >
            {submitting ? 'Encerrando…' : 'Encerrar atendimento'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export default CloseReasonModal;
