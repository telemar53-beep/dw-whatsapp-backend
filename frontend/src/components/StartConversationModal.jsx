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

function StartConversationModal({ onClose, onCreated }) {
  const { token } = useAuth();
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('55');
  const [content, setContent] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [templateVariableValues, setTemplateVariableValues] = useState([]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

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

  useEffect(() => {
    if (!isOfficialChannel || !channelId) {
      setTemplates([]);
      setTemplateId('');
      return;
    }
    listTemplatesForChannel(channelId, token).then((data) => {
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
    <WaDialog title="Iniciar conversa" onClose={onClose} size="max-w-sm">
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="wa-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-3">
          <div>
            <label htmlFor="start-conversation-channel" className={waLabelClass}>
              Canal
            </label>
            {loading ? (
              <p className="text-[14px] text-wa-muted">Carregando canais...</p>
            ) : loadError ? (
              <p className="text-[14px] text-[#b3261e]">Não foi possível carregar os canais. Feche e tente novamente.</p>
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
            <label htmlFor="start-conversation-phone" className={waLabelClass}>
              Telefone
            </label>
            <input
              id="start-conversation-phone"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className={waInputClass}
              required
            />
          </div>
          {isOfficialChannel ? (
            <>
              <p className="rounded-[6px] bg-[#ffeecd] px-3 py-2 text-[13.5px] leading-[19px] text-[#54656f]">
                Este canal requer o uso de template para iniciar o atendimento!
              </p>
              <div>
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
              {templateVariableValues.map((value, index) => (
                <div key={index}>
                  <label htmlFor={`start-conversation-variable-${index}`} className={waLabelClass}>
                    Variável {index + 1}
                  </label>
                  <input
                    id={`start-conversation-variable-${index}`}
                    value={value}
                    onChange={(e) => handleVariableChange(index, e.target.value)}
                    className={waInputClass}
                    required
                  />
                </div>
              ))}
            </>
          ) : (
            <div>
              <label htmlFor="start-conversation-message" className={waLabelClass}>
                Mensagem
              </label>
              <textarea
                id="start-conversation-message"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className={waInputClass}
                required
              />
            </div>
          )}
          {error && <p className={waErrorClass}>{error}</p>}
        </div>
        <div className="flex shrink-0 justify-end gap-2 px-4 py-3">
          <button type="button" onClick={onClose} className={waGhostButtonClass}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting || loading || loadError || channels.length === 0 || (isOfficialChannel && templates.length === 0)}
            className={waPrimaryButtonClass}
          >
            Iniciar
          </button>
        </div>
      </form>
    </WaDialog>
  );
}

export default StartConversationModal;
