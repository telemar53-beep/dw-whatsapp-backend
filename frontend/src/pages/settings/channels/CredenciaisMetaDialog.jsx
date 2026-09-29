import './formulario-do-canal.css';
import { useEffect, useRef, useState } from 'react';
import { DialogoClaro } from '../../../components/ui/DialogoClaro';
import { formatPhone } from '../../../utils/phone';
import { EmblemaDoCanal } from './emblema';
import { CampoSecreto } from './CampoSecreto';
import { providerLabel } from './ChannelsTable';

// Credenciais da Meta no detalhe do canal (Fatia S2), carregado só ao abrir.
//
// Dois usos, o mesmo endpoint de antes (meta-cloud-credentials):
// - "migrar": leva um canal Baileys ou 360dialog para a Meta Cloud. Não
//   executa mais no clique: este diálogo É a confirmação — identifica o
//   canal, diz a consequência e só chama a API em "Continuar migração";
// - "atualizar": troca o Access Token de um canal que já é Meta Cloud.
// Durante o envio o diálogo fica aberto e preso (sem Fechar, Cancelar, Esc
// nem segundo envio) e diz "Migrando…". Na falha, o motivo que a Meta deu
// aparece aqui dentro e os campos ficam como estavam.
const TEXTOS = {
  migrar: {
    titulo: 'Migrar para Meta Cloud?',
    texto: 'O número continuará sendo o mesmo, mas o provedor da conexão será alterado. O histórico de atendimentos será preservado.',
    nota: 'Antes de continuar: o número precisa estar na Cloud API da Meta e o app inscrito no webhook da conta. As credenciais são conferidas com a Meta antes da troca, e o canal pode ficar temporariamente desconectado durante a troca.',
    acao: 'Continuar migração',
    andamento: 'Migrando…',
  },
  atualizar: {
    titulo: 'Atualizar credenciais da Meta',
    texto: 'Use quando o Access Token for rotacionado ou revogado. As credenciais são conferidas com a Meta antes de salvar, e o histórico deste canal não é afetado.',
    nota: null,
    acao: 'Salvar credenciais',
    andamento: 'Salvando…',
  },
};

function CredenciaisMetaDialog({ modo, canal, onClose, onSalvar, onConcluido }) {
  const t = TEXTOS[modo] || TEXTOS.atualizar;
  const [dados, setDados] = useState({ phoneNumberId: '', accessToken: '', wabaId: '' });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const vivo = useRef(true);
  const enviarRef = useRef(null);
  useEffect(() => () => { vivo.current = false; }, []);

  function mudar(campo) {
    return (evento) => setDados((atual) => ({ ...atual, [campo]: evento.target.value }));
  }

  async function enviar(evento) {
    evento.preventDefault();
    if (enviando) return;
    // O foco fica no botão de envio (aria-disabled) até a resposta: campos e
    // Cancelar desativados jogariam o foco no <body>.
    if (enviarRef.current) enviarRef.current.focus();
    setEnviando(true);
    setErro(null);
    try {
      await onSalvar({ phoneNumberId: dados.phoneNumberId, accessToken: dados.accessToken, wabaId: dados.wabaId });
      if (vivo.current) onConcluido();
    } catch (falha) {
      if (!vivo.current) return;
      setErro(falha.message);
      setEnviando(false);
    }
  }

  function fechar() {
    if (!enviando) onClose();
  }

  return (
    <DialogoClaro
      variant="credenciais-meta"
      titulo={t.titulo}
      descricao={canal.name}
      onClose={fechar}
      saidaDesabilitada={enviando}
      className="cfg-dlg-canal cfg-dlg-credenciais"
    >
      <div className="mc-corpo">
        <form id="cfg-form-credenciais" onSubmit={enviar} autoComplete="off">
          <div className="cfg-dlg-canal-resumo">
            <EmblemaDoCanal type={canal.type} />
            <div>
              <strong>{canal.name}</strong>
              <span>{formatPhone(canal.phoneNumber)} · {providerLabel(canal.type)}</span>
            </div>
          </div>
          <p className="cfg-dlg-texto">{t.texto}</p>
          {t.nota && <p className="cfg-dlg-nota">{t.nota}</p>}
          <div className="cfg-campos">
            <div className="mc-campo cfg-campo">
              <label htmlFor="meta-phone-number-id" className="mc-rotulo">Phone Number ID</label>
              <input id="meta-phone-number-id" className="mc-entrada" value={dados.phoneNumberId} onChange={mudar('phoneNumberId')} disabled={enviando} inputMode="numeric" autoComplete="off" required />
            </div>
            <div className="mc-campo cfg-campo">
              <label htmlFor="meta-waba" className="mc-rotulo">WABA ID</label>
              <input id="meta-waba" className="mc-entrada" value={dados.wabaId} onChange={mudar('wabaId')} disabled={enviando} inputMode="numeric" autoComplete="off" required />
            </div>
            <CampoSecreto id="meta-token" rotulo="Access Token" nota="fica mascarado" valor={dados.accessToken} onChange={mudar('accessToken')} disabled={enviando} />
          </div>
        </form>
      </div>
      {erro && <p role="alert" className="mc-erro">{erro}</p>}
      <div className="mc-rodape cfg-dlg-rodape">
        <div className="mc-acoes">
          <button type="button" className="mc-botao" onClick={fechar} disabled={enviando}>Cancelar</button>
          <button type="submit" form="cfg-form-credenciais" ref={enviarRef} className="mc-botao is-principal" aria-disabled={enviando ? 'true' : undefined}>
            {enviando ? t.andamento : t.acao}
          </button>
        </div>
      </div>
    </DialogoClaro>
  );
}

export default CredenciaisMetaDialog;
