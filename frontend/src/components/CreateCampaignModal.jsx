import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listChannelsForAgent, listTemplatesForChannel, createCampaign } from '../services/api';
import { isOfficialChannelType, channelTypeLabel } from '../utils/channelTypes';
import { parseRecipients } from '../utils/parseRecipients';
import WaDialog, {
  waInputClass,
  waLabelClass,
  waPrimaryButtonClass,
  waGhostButtonClass,
  waErrorClass,
} from './WaDialog';

const RECIPIENT_LIMIT = 2000;

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
  const [step, setStep] = useState('form');
  const [fieldErrors, setFieldErrors] = useState({});

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
    listTemplatesForChannel(channelId, token, 'disparo').then((data) => {
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

  function validate() {
    const errors = {};
    if (!channelId) errors.channelId = 'Selecione um canal para a campanha.';
    if (isOfficialChannel) {
      if (!templateId) errors.templateId = 'Selecione um template aprovado.';
      templateVariableValues.forEach((value, index) => {
        if (!value || !value.trim()) errors[`variable-${index}`] = `Preencha a variável ${index + 1}.`;
      });
    } else if (!content.trim()) {
      errors.content = 'Escreva a mensagem que será enviada.';
    }
    if (!recipients.trim()) errors.recipients = 'Informe ao menos um destinatário.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleReview(event) {
    event.preventDefault();
    if (!validate()) return;
    setStep('review');
  }

  const summary = parseRecipients(recipients);

  async function handleSubmit(event) {
    if (event) event.preventDefault();
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

  if (step === 'review') {
    return (
      <WaDialog title="Nova campanha" onClose={onClose} size="max-w-sm">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="wa-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-3">
            <h3 className="text-[16px] font-medium text-wa-text">Revisar campanha</h3>
            <dl className="space-y-2 text-[14px]">
              <div>
                <dt className={waLabelClass}>Canal</dt>
                <dd className="text-wa-text">
                  {selectedChannel.name} · {channelTypeLabel(selectedChannel.type)}
                </dd>
              </div>
              <div>
                <dt className={waLabelClass}>Destinatários</dt>
                <dd className="space-y-0.5 text-wa-text">
                  <p>{summary.valid.length} {summary.valid.length === 1 ? 'destinatário válido' : 'destinatários válidos'}</p>
                  {summary.duplicates > 0 && (
                    <p className="text-wa-muted">
                      {summary.duplicates} {summary.duplicates === 1 ? 'duplicado ignorado' : 'duplicados ignorados'}
                    </p>
                  )}
                  {summary.invalid > 0 && (
                    <p className="text-wa-warn-text">
                      <span>{summary.invalid} {summary.invalid === 1 ? 'linha inválida' : 'linhas inválidas'}</span>{' '}
                      (vão aparecer como "falhou")
                    </p>
                  )}
                  {summary.valid.length + summary.invalid > RECIPIENT_LIMIT && (
                    <p className={waErrorClass}>O limite é de {RECIPIENT_LIMIT} destinatários por campanha.</p>
                  )}
                </dd>
              </div>
              <div>
                <dt className={waLabelClass}>Conteúdo</dt>
                <dd className="whitespace-pre-wrap rounded-[10px] bg-wa-panel-header px-3 py-2 text-wa-text">
                  {isOfficialChannel ? (
                    <>
                      <p>Template: {selectedTemplate?.name}</p>
                      {templateVariableValues.map((v, i) => (
                        <p key={i}>Variável {i + 1}: {v}</p>
                      ))}
                    </>
                  ) : (
                    content
                  )}
                </dd>
              </div>
            </dl>
            {error && <p className={waErrorClass}>{error}</p>}
          </div>
          <div className="flex shrink-0 justify-end gap-2 px-4 py-3">
            <button type="button" onClick={() => setStep('form')} className={waGhostButtonClass}>
              Voltar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || summary.valid.length + summary.invalid > RECIPIENT_LIMIT}
              className={waPrimaryButtonClass}
            >
              Confirmar e disparar
            </button>
          </div>
        </div>
      </WaDialog>
    );
  }

  return (
    <WaDialog title="Nova campanha" onClose={onClose} size="max-w-sm">
      <form onSubmit={handleReview} className="flex min-h-0 flex-1 flex-col">
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
              <select
                id="campaign-channel"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className={waInputClass}
                aria-invalid={Boolean(fieldErrors.channelId)}
                aria-describedby={fieldErrors.channelId ? 'campaign-channel-error' : undefined}
              >
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            )}
            {fieldErrors.channelId && (
              <p className={waErrorClass} id="campaign-channel-error">
                {fieldErrors.channelId}
              </p>
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
                  <select
                    id="campaign-template"
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    className={waInputClass}
                    aria-invalid={Boolean(fieldErrors.templateId)}
                    aria-describedby={fieldErrors.templateId ? 'campaign-template-error' : undefined}
                  >
                    <option value="">Selecione um template</option>
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>
                )}
                {fieldErrors.templateId && (
                  <p className={waErrorClass} id="campaign-template-error">
                    {fieldErrors.templateId}
                  </p>
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
                    aria-invalid={Boolean(fieldErrors[`variable-${index}`])}
                    aria-describedby={fieldErrors[`variable-${index}`] ? `campaign-variable-${index}-error` : undefined}
                  />
                  {fieldErrors[`variable-${index}`] && (
                    <p className={waErrorClass} id={`campaign-variable-${index}-error`}>
                      {fieldErrors[`variable-${index}`]}
                    </p>
                  )}
                </div>
              ))}
            </>
          ) : (
            <div>
              <label htmlFor="campaign-message" className={waLabelClass}>
                Mensagem
              </label>
              <textarea
                id="campaign-message"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className={waInputClass}
                aria-invalid={Boolean(fieldErrors.content)}
                aria-describedby={fieldErrors.content ? 'campaign-message-error' : undefined}
              />
              {fieldErrors.content && (
                <p className={waErrorClass} id="campaign-message-error">
                  {fieldErrors.content}
                </p>
              )}
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
              aria-invalid={Boolean(fieldErrors.recipients)}
              aria-describedby={fieldErrors.recipients ? 'campaign-recipients-error' : undefined}
            />
            {fieldErrors.recipients && (
              <p className={waErrorClass} id="campaign-recipients-error">
                {fieldErrors.recipients}
              </p>
            )}
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
            Revisar
          </button>
        </div>
      </form>
    </WaDialog>
  );
}

export default CreateCampaignModal;
