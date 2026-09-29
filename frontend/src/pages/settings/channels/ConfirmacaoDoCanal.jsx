import '../../../components/ui/dialogo-claro.css';
import './confirmacao-do-canal.css';
import { useEffect, useId, useRef } from 'react';
import { Dialog } from '../../../components/ui/Dialog';
import { formatPhone } from '../../../utils/phone';
import { EmblemaDoCanal } from './emblema';
import { providerLabel } from './ChannelsTable';

// Confirmação das ações de canal (Fatia S2, terceiro mockup): excluir,
// ocultar, reexibir e reconectar. Moldura clara do Bloco 1 (`claro`), com o
// canal identificado (emblema, nome, número e provedor), a consequência dita
// por extenso e a confirmação que espera a resposta:
//
// - ocupada, o botão diz o que acontece, Cancelar e Esc ficam presos e o
//   clique fora nunca fecha (é decisão, não leitura);
// - o foco começa na saída segura (Cancelar), nunca na destrutiva;
// - ocupada, a ação continua focável (aria-disabled, e não disabled): tirar o
//   foco dela no meio do envio o jogaria para fora do diálogo;
// - recusada a exclusão, a alternativa ("Ocultar em vez de excluir") recebe o
//   foco, porque o botão que o tinha sai da tela.
//
// O retorno do foco é o do ui/Dialog: volta para quem abriu (o "⋯" do cartão
// ou o botão do detalhe).
function textos(tipo, canal) {
  const baileys = canal.type === 'baileys';
  if (tipo === 'excluir') {
    return {
      titulo: 'Excluir este canal?',
      descricao: 'Esta ação remove o canal da lista e não pode ser desfeita.',
      aviso: 'Só é possível excluir um canal que nunca teve atendimentos nem integração SGP. Depois disso, este número deixa de receber mensagens.',
      acao: 'Excluir canal',
      perigo: true,
    };
  }
  if (tipo === 'ocultar') {
    return {
      titulo: 'Ocultar este canal?',
      descricao: 'O canal sai da lista de números conectados. Nada é apagado.',
      aviso: baileys ? 'A sessão do WhatsApp deste número é encerrada. Para voltar a usar, reexiba o canal e leia um novo QR code.' : null,
      acao: 'Ocultar canal',
    };
  }
  if (tipo === 'reexibir') {
    return {
      titulo: 'Reexibir este canal?',
      descricao: 'O canal volta para a lista de números conectados.',
      aviso: baileys ? 'A sessão foi encerrada quando o canal foi ocultado: depois de reexibir, use Reconectar e leia um novo QR code.' : null,
      acao: 'Reexibir canal',
    };
  }
  return {
    titulo: 'Reconectar este canal?',
    descricao: 'A sessão atual é encerrada e um QR code novo é gerado.',
    aviso: 'Enquanto o código não for lido, este número não recebe mensagens.',
    acao: 'Reconectar',
  };
}

const EM_ANDAMENTO = {
  excluir: { titulo: 'Excluindo canal…', botao: 'Excluindo…' },
  ocultar: { titulo: 'Ocultando canal…', botao: 'Ocultando…' },
  reexibir: { titulo: 'Reexibindo canal…', botao: 'Reexibindo…' },
  reconectar: { titulo: 'Reconectando canal…', botao: 'Reconectando…' },
};

export function ConfirmacaoDoCanal({ tipo, canal, ocupado, emAndamento, erro, recusada, onConfirmar, onOcultarEmVez, onCancelar }) {
  const id = useId();
  const alternativaRef = useRef(null);
  const t = textos(tipo, canal);
  const andamento = EM_ANDAMENTO[emAndamento || tipo];
  const titulo = ocupado ? andamento.titulo : t.titulo;
  const descricao = ocupado ? 'Aguarde a resposta. Esta janela não pode ser fechada durante a operação.' : t.descricao;

  useEffect(() => {
    if (recusada && !ocupado && alternativaRef.current) alternativaRef.current.focus();
  }, [recusada, ocupado]);

  const ocupadoNaAlternativa = ocupado && emAndamento === 'ocultar' && tipo === 'excluir';

  return (
    <Dialog
      claro
      role="alertdialog"
      variant="confirmar-canal"
      size=""
      labelledBy={`${id}-titulo`}
      describedBy={`${id}-descricao`}
      onClose={onCancelar}
      dismissible={false}
      closeOnEsc={!ocupado}
      closeOnBackdrop={false}
      className="cfg-dlg-canal cfg-dlg-confirmar"
    >
      <div className="cfg-conf-cab" aria-busy={ocupado ? 'true' : undefined}>
        <h2 id={`${id}-titulo`}>{titulo}</h2>
        <p id={`${id}-descricao`}>{descricao}</p>
      </div>
      <div className="mc-corpo">
        <div className="cfg-dlg-canal-resumo">
          <EmblemaDoCanal type={canal.type} />
          <div>
            <strong>{canal.name}</strong>
            <span>{formatPhone(canal.phoneNumber)} · {providerLabel(canal.type)}</span>
          </div>
        </div>
        {t.aviso && !recusada && <p className="cfg-conf-aviso">{t.aviso}</p>}
      </div>
      {erro && <p role="alert" className="mc-erro">{erro}</p>}
      <div className={`mc-rodape cfg-dlg-rodape${recusada ? ' is-com-alternativa' : ''}`}>
        {recusada && (
          <button
            type="button"
            ref={alternativaRef}
            className="cfg-conf-alternativa"
            onClick={onOcultarEmVez}
            aria-disabled={ocupado ? 'true' : undefined}
          >
            {ocupadoNaAlternativa ? 'Ocultando…' : 'Ocultar em vez de excluir'}
          </button>
        )}
        <div className="mc-acoes">
          <button type="button" data-autofocus="" className="mc-botao" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </button>
          {!recusada && (
            <button
              type="button"
              className={`mc-botao ${t.perigo ? 'is-perigo' : 'is-principal'}`}
              data-danger={t.perigo ? '' : undefined}
              onClick={ocupado ? undefined : onConfirmar}
              aria-disabled={ocupado ? 'true' : undefined}
            >
              {ocupado ? andamento.botao : erro ? 'Tentar novamente' : t.acao}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
