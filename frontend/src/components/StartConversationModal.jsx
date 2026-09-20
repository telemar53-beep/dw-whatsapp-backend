import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listChannelsForAgent, startConversation, listTemplatesForChannel } from '../services/api';
import { isOfficialChannelType } from '../utils/channelTypes';
import WaDialog, {
  waInputClass,
  waLabelClass,
  waPrimaryButtonClass,
  waGhostButtonClass,
  waErrorClass,
} from './WaDialog';

const COUNTRY_CODES = [
  { code: '55', label: 'Brasil (+55)' },
  { code: '351', label: 'Portugal (+351)' },
  { code: '1', label: 'EUA/Canadá (+1)' },
  { code: '54', label: 'Argentina (+54)' },
  { code: '595', label: 'Paraguai (+595)' },
  { code: '598', label: 'Uruguai (+598)' },
  { code: '34', label: 'Espanha (+34)' },
];

function StartConversationModal({ onClose, onCreated }) {
  const { token } = useAuth();
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState('');
  const [ddi, setDdi] = useState('55');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState(null);
  const [content, setContent] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [templateVariableValues, setTemplateVariableValues] = useState([]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const phoneDigits = phone.replace(/\D/g, '');

  useEffect(() => {
    listChannelsForAgent(token)
      .then((data) => {
        const eligible = data.filter(
          (channel) => (channel.type === 'baileys' && channel.status === 'connected') || isOfficialChannelType(channel.type)
        );
        setChannels(eligible);
        if (eligible.length > 0) {
          setChannelId(eligible[0].id);
        }
      })
      .catch(() => {
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const selectedChannel = channels.find((channel) => channel.id === channelId);
  const isOfficialChannel = selectedChannel && isOfficialChannelType(selectedChannel.type);
  const selectedTemplate = templates.find((tpl) => tpl.id === templateId);
  const startDisabled = submitting || loading || loadError || channels.length === 0 || (isOfficialChannel && templates.length === 0);
  const disabledReason = submitting
    ? 'Iniciando conversa...'
    : loading
      ? 'Aguarde a lista de canais.'
      : loadError
        ? 'Falha no carregamento impede iniciar.'
        : channels.length === 0
          ? 'Nenhum canal disponível para iniciar.'
          : isOfficialChannel && templates.length === 0
            ? 'Este canal precisa de um template aprovado para iniciar.'
            : null;

  useEffect(() => {
    if (!isOfficialChannel || !channelId) {
      setTemplates([]);
      setTemplateId('');
      return;
    }
    listTemplatesForChannel(channelId, token, 'atendimento').then((data) => {
      setTemplates(data);
      setTemplateId(data[0]?.id || '');
    });
  }, [isOfficialChannel, channelId, token]);

  useEffect(() => {
    setTemplateVariableValues(selectedTemplate ? Array(selectedTemplate.variableCount).fill('') : []);
  }, [selectedTemplate]);

  function handleVariableChange(index, value) {
    setTemplateVariableValues((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setPhoneError(null);
    if (phoneDigits.length < 8) {
      setPhoneError('Informe o telefone com DDD.');
      return;
    }
    const phoneNumber = `${ddi}${phoneDigits}`;
    setSubmitting(true);
    try {
      const conversation = isOfficialChannel
        ? await startConversation({ channelId, phoneNumber, templateId, templateVariables: templateVariableValues }, token)
        : await startConversation({ channelId, phoneNumber, content }, token);
      onCreated(conversation);
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao iniciar conversa');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <WaDialog variant="start-conversation" title="Iniciar conversa" onClose={onClose} size="max-w-3xl">
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="wa-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5 pt-3 sm:px-6">
          <div className="grid gap-4 border-b border-wa-border pb-5 sm:grid-cols-[minmax(180px,0.8fr)_minmax(0,1.6fr)]">
            <div>
            <label htmlFor="start-conversation-channel" className={waLabelClass}>
              Canal
            </label>
            {loading ? (
              <p className="text-[14px] text-wa-muted">Carregando canais...</p>
            ) : loadError ? (
              <p className="text-[14px] text-wa-error-text">Não foi possível carregar os canais. Feche e tente novamente.</p>
            ) : channels.length === 0 ? (
              <p className="text-[14px] text-wa-muted">Nenhum canal conectado no momento.</p>
            ) : (
              <select
                id="start-conversation-channel"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className={waInputClass}
              >
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            )}
            </div>
            <div>
              <div className="grid grid-cols-[minmax(120px,0.8fr)_minmax(0,1.5fr)] gap-3">
                <div>
                  <label htmlFor="start-conversation-ddi" className={waLabelClass}>País</label>
                  <select id="start-conversation-ddi" value={ddi} onChange={(e) => setDdi(e.target.value)} className={waInputClass}>
                    {COUNTRY_CODES.map((country) => <option key={country.code} value={country.code}>{country.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="start-conversation-phone" className={waLabelClass}>Telefone</label>
                  <input
                    id="start-conversation-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="98 98500-4187"
                    inputMode="tel"
                    className={waInputClass}
                    aria-invalid={phoneError ? 'true' : 'false'}
                    aria-describedby={phoneError ? 'start-conversation-phone-error' : undefined}
                  />
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 text-[12px] leading-[17px] text-wa-muted">
                <span>Digite com DDD. Com ou sem o 9, o sistema confere no WhatsApp qual forma existe.</span>
                {phoneDigits.length > 0 && <span className="shrink-0 tabular-nums">Número completo: {ddi}{phoneDigits}</span>}
              </div>
              {phoneError && <p id="start-conversation-phone-error" className={`mt-2 ${waErrorClass}`}>{phoneError}</p>}
            </div>
          </div>
          <section>
          {isOfficialChannel ? (
            <>
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-[14px] font-semibold text-wa-text">Template de abertura</h3>
                <p className="border-l-2 border-wa-warn-text pl-2 text-[12.5px] text-wa-warn-text">Este canal requer o uso de template para iniciar o atendimento!</p>
              </div>
              <div className="max-w-[420px]">
                <label htmlFor="start-conversation-template" className={waLabelClass}>
                  Template
                </label>
                {templates.length === 0 ? (
                  <p className="text-[14px] text-wa-muted">Nenhum template aprovado para este canal.</p>
                ) : (
                  <select
                    id="start-conversation-template"
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    className={waInputClass}
                  >
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {/* Template não abre a janela de 24h — só a resposta do cliente
                  abre. Botão é o caminho de um toque para ele responder; sem
                  botão, a conversa fica esperando ele escrever por conta. */}
              {selectedTemplate && (
                <div className="mt-3">
                  {(selectedTemplate.buttons || []).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {(selectedTemplate.buttons || []).map((texto) => (
                        <div key={texto} className="rounded-[8px] border border-wa-border bg-wa-field px-3 py-1.5 text-[12.5px] font-medium text-[#53bdeb]">{texto}</div>
                      ))}
                    </div>
                  )}
                  <p className="mt-1.5 text-[12.5px] leading-[17px] text-wa-muted">
                    {(selectedTemplate.buttons || []).length > 0
                      ? 'O cliente responde com um toque no botão — e é essa resposta que abre a conversa para você escrever.'
                      : 'Este template não tem botões: a conversa só continua depois que o cliente responder.'}
                  </p>
                </div>
              )}
              {templateVariableValues.length > 0 && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {templateVariableValues.map((value, index) => (
                    <div key={index}>
                      <label htmlFor={`start-conversation-variable-${index}`} className={waLabelClass}>Variável {index + 1}</label>
                      <input id={`start-conversation-variable-${index}`} value={value} onChange={(e) => handleVariableChange(index, e.target.value)} className={waInputClass} required />
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div>
              <h3 className="mb-2 text-[14px] font-semibold text-wa-text">Mensagem inicial</h3>
              <label htmlFor="start-conversation-message" className={waLabelClass}>Mensagem</label>
              <textarea
                id="start-conversation-message"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                className={`${waInputClass} resize-y`}
                required
              />
            </div>
          )}
          </section>
          {error && <p className={waErrorClass}>{error}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-wa-border bg-wa-panel-header px-5 py-3 sm:px-6">
          <p role="status" className="min-w-0 flex-1 text-[12.5px] text-wa-warn-text">{startDisabled ? disabledReason : ''}</p>
          <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={waGhostButtonClass}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={startDisabled}
            className={waPrimaryButtonClass}
          >
            Iniciar conversa
          </button>
          </div>
        </div>
      </form>
    </WaDialog>
  );
}

export default StartConversationModal;
