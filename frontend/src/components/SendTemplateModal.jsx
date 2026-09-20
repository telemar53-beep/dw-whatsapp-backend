import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listTemplatesForChannel, sendConversationTemplate } from '../services/api';
import { substituirVariaveis } from '../utils/templatePreview';
import { Dialog, DialogBody, DialogFooter } from './ui/Dialog';

// Com a janela de 24h fechada, template aprovado é a única coisa que o WhatsApp
// entrega. Isto não contorna a regra: o texto continua sendo o pré-aprovado,
// com variáveis. O que muda é o atendente conseguir fazer, pela tela, a única
// coisa permitida naquele momento.
//
// A lista pede só os de 'atendimento': template de disparo é do SGP e da
// campanha, e não tem por que aparecer numa conversa individual.
function SendTemplateModal({ conversationId, channelId, onClose, onSent }) {
  const { token } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [status, setStatus] = useState('loading');
  const [selected, setSelected] = useState(null);
  const [variables, setVariables] = useState([]);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!channelId) return;
    listTemplatesForChannel(channelId, token, 'atendimento')
      .then((data) => {
        setTemplates(data);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, [channelId, token]);

  function escolher(template) {
    setSelected(template);
    setVariables(Array.from({ length: template.variableCount }, () => ''));
    setError(null);
  }

  async function enviar() {
    setSending(true);
    setError(null);
    try {
      await sendConversationTemplate(conversationId, selected.id, variables, token);
      onSent();
    } catch (err) {
      setError((err.body && err.body.error) || 'Não foi possível enviar o template.');
    } finally {
      setSending(false);
    }
  }

  const pronto = selected && variables.every((v) => v.trim());

  return (
    <Dialog
      variant="send-template"
      size="max-w-[54rem]"
      title="Enviar template"
      description="A janela de 24h está fechada. Só template aprovado é entregue até o cliente responder."
      onClose={onClose}
      // Ha variavel digitada aqui dentro: nao fecha por clique no fundo.
      closeOnBackdrop={false}
    >
      <DialogBody className="dialog-send-template">

        {status === 'loading' && <p className="mt-4 text-[13.5px] text-chat-muted">Carregando templates…</p>}
        {status === 'error' && <p className="mt-4 text-[13.5px] text-wa-error-text">Não foi possível carregar os templates.</p>}
        {status === 'ready' && templates.length === 0 && (
          <p className="mt-4 text-[13.5px] text-chat-muted">
            Nenhum template de atendimento aprovado neste canal. Cadastre um em Configurações → Templates.
          </p>
        )}

        {status === 'ready' && templates.length > 0 && (
          <ul className="mt-4 space-y-2">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => escolher(t)}
                  className={`w-full rounded-[12px] border px-3 py-2 text-left transition ${
                    selected && selected.id === t.id
                      ? 'border-chat-orange/60 bg-chat-orange/10'
                      : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
                  }`}
                >
                  <span className="block text-[14px] font-medium text-chat-text">{t.name}</span>
                  <span className="mt-0.5 block text-[12.5px] text-chat-muted">{t.bodyText}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="dialog-template-compose">
        {selected && selected.variableCount > 0 && (
          <div className="mt-4 space-y-3">
            {variables.map((valor, i) => (
              <div key={i}>
                <label htmlFor={`template-var-${i}`} className="mb-1 block text-[13px] font-medium text-chat-muted">
                  Variável {i + 1}
                </label>
                <input
                  id={`template-var-${i}`}
                  value={valor}
                  onChange={(e) => setVariables(variables.map((v, j) => (j === i ? e.target.value : v)))}
                  className="w-full rounded-[10px] border border-white/10 bg-white/[0.06] px-3 py-2 text-[14px] text-chat-text outline-none focus:border-white/30"
                />
              </div>
            ))}
          </div>
        )}

        {/* A prévia existe porque template não dá para corrigir depois: uma
            variável no lugar errado chega assim ao cliente. */}
        {selected && (
          <div role="group" aria-label="Prévia da mensagem" className="mt-4">
            <p className="whitespace-pre-wrap rounded-[12px] bg-white/[0.06] px-3 py-2 text-[13.5px] text-chat-text">
              {substituirVariaveis(selected.bodyText, variables)}
            </p>
            {/* Um template com botão não é só uma mensagem: é a única saída de
                um toque para o cliente responder e reabrir a conversa. Mostrar
                os botões é o que diz ao atendente se dá para continuar. */}
            {(selected.buttons || []).map((texto) => (
              <div
                key={texto}
                className="mt-[3px] rounded-[10px] bg-white/[0.06] px-3 py-2 text-center text-[13.5px] font-medium text-[#53bdeb]"
              >
                {texto}
              </div>
            ))}
            {(selected.buttons || []).length > 0 && (
              <p className="mt-2 text-[12.5px] text-chat-muted">
                Se o cliente tocar num botão, a resposta chega no chat e reabre a janela de 24h.
              </p>
            )}
          </div>
        )}

        </div>
        {error && <p className="dialog-send-template-error mt-3 text-[13px] text-wa-error-text">{error}</p>}
      </DialogBody>
      <DialogFooter>
        <button
          type="button"
          onClick={onClose}
          className="rounded-[10px] border border-white/10 bg-white/[0.06] px-3.5 py-2 text-[13.5px] text-chat-text transition hover:bg-white/[0.12]"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={enviar}
          disabled={!pronto || sending}
          className="rounded-[10px] bg-chat-orange px-3.5 py-2 text-[13.5px] font-medium text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? 'Enviando…' : 'Enviar'}
        </button>
      </DialogFooter>
    </Dialog>
  );
}

export default SendTemplateModal;
