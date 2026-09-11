import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listChannelsForAgent, listTemplatesForChannel, createCampaign } from '../services/api';
import { isOfficialChannelType } from '../utils/channelTypes';
import WaDialog, {
  waInputClass,
  waLabelClass,
  waPrimaryButtonClass,
  waGhostButtonClass,
  waErrorClass,
} from './WaDialog';

function CreateCampaignModal({ onClose, onCreated }) {
  const { token } = useAuth();
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState('');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [recipients, setRecipients] = useState('');
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
      .catch(() => setLoadError(true))
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
      const campaign = isOfficialChannel
        ? await createCampaign({ channelId, name, templateId, templateVariables: templateVariableValues, recipients }, token)
        : await createCampaign({ channelId, name, content, recipients }, token);
      onCreated(campaign);
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao criar campanha');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <WaDialog title="Nova campanha" onClose={onClose} size="max-w-sm">
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="wa-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-3">
          <div>
            <label htmlFor="campaign-name" className={waLabelClass}>
              Nome (opcional)
            </label>
            <input id="campaign-name" value={name} onChange={(e) => setName(e.target.value)} className={waInputClass} />
          </div>
          <div>
            <label htmlFor="campaign-channel" className={waLabelClass}>
              Canal
            </label>
            {loading ? (
              <p className="text-[14px] text-wa-muted">Carregando canais...</p>
            ) : loadError ? (
              <p className="text-[14px] text-wa-error-text">Não foi possível carregar os canais. Feche e tente novamente.</p>
            ) : channels.length === 0 ? (
              <p className="text-[14px] text-wa-muted">Nenhum canal conectado no momento.</p>
            ) : (
              <select id="campaign-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} className={waInputClass}>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {isOfficialChannel ? (
            <>
              <p className="rounded-[10px] bg-wa-warn-bg px-3 py-2 text-[13.5px] leading-[19px] text-wa-warn-text">
                Este canal requer o uso de template para a campanha!
              </p>
              <div>
                <label htmlFor="campaign-template" className={waLabelClass}>
                  Template
                </label>
                {templates.length === 0 ? (
                  <p className="text-[14px] text-wa-muted">Nenhum template aprovado para este canal.</p>
                ) : (
                  <select id="campaign-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={waInputClass}>
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
                  <label htmlFor={`campaign-variable-${index}`} className={waLabelClass}>
                    Variável {index + 1}
                  </label>
                  <input
                    id={`campaign-variable-${index}`}
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
              <label htmlFor="campaign-message" className={waLabelClass}>
                Mensagem
              </label>
              <textarea id="campaign-message" value={content} onChange={(e) => setContent(e.target.value)} className={waInputClass} required />
            </div>
          )}
          <div>
            <label htmlFor="campaign-recipients" className={waLabelClass}>
              Destinatários (um por linha: telefone ou telefone,nome)
            </label>
            <textarea
              id="campaign-recipients"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              className={`${waInputClass} min-h-[120px]`}
              required
            />
          </div>
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
            Disparar
          </button>
        </div>
      </form>
    </WaDialog>
  );
}

export default CreateCampaignModal;
