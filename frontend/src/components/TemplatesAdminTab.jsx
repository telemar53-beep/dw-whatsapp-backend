import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTemplates } from '../hooks/useTemplates';
import { useChannels } from '../hooks/useChannels';
import { createTemplateAdmin, deleteTemplateAdmin, syncTemplatesAdmin, registerExistingTemplateAdmin } from '../services/api';
import { isOfficialChannelType } from '../utils/channelTypes';
import WaDialog from './WaDialog';

function TemplateRow({ template, onDeleted }) {
  const { token } = useAuth();
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Excluir o template ${template.name}?`)) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteTemplateAdmin(template.id, token);
      onDeleted();
    } catch (err) {
      setDeleteError((err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-wa-surface-line bg-wa-surface p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-wa-text">{template.name}</p>
          <p className="text-sm text-wa-muted">
            <span>{template.language}</span> · <span>{template.category}</span> · <span>{template.status}</span>
          </p>
          {template.rejectionReason && <p className="text-sm text-wa-error-text">{template.rejectionReason}</p>}
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-sm font-medium text-wa-error-text hover:text-wa-error-text hover:underline disabled:opacity-50"
        >
          Excluir
        </button>
      </div>
      {deleteError && (
        <p className="mt-2 rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{deleteError}</p>
      )}
    </div>
  );
}

function TemplatesModal({ templates, onClose, onDeleted }) {
  return (
    <WaDialog title="Templates cadastrados" onClose={onClose} size="max-w-lg">
      <div className="wa-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {templates.length === 0 ? (
          <p className="text-sm text-wa-muted">Nenhum template cadastrado ainda.</p>
        ) : (
          templates.map((template) => <TemplateRow key={template.id} template={template} onDeleted={onDeleted} />)
        )}
      </div>
    </WaDialog>
  );
}

function RegisterExistingTemplateForm({ onRegistered, onCancel }) {
  const { token } = useAuth();
  const { channels } = useChannels();
  const officialChannels = channels.filter((channel) => isOfficialChannelType(channel.type));

  const [channelId, setChannelId] = useState('');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('');
  const [headerType, setHeaderType] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await registerExistingTemplateAdmin({ channelId, name, language, headerType: headerType || null }, token);
      setName('');
      setLanguage('');
      setHeaderType('');
      onRegistered();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao registrar template');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Registrar template existente"
      className="space-y-3 rounded-2xl border border-wa-surface-line bg-wa-surface p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
    >
      <h3 className="font-display text-base font-semibold text-wa-text">Registrar template existente</h3>
      <p className="text-sm text-wa-muted">
        Para um template já aprovado pela Meta fora deste sistema — busca o corpo e a quantidade de variáveis automaticamente pelo nome.
      </p>
      <div>
        <label htmlFor="existing-template-channel" className="mb-1.5 block text-sm font-medium text-wa-muted">Canal</label>
        <select
          id="existing-template-channel"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          className="w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25"
          required
        >
          <option value="">Selecione um canal</option>
          {officialChannels.map((channel) => (
            <option key={channel.id} value={channel.id}>{channel.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="existing-template-name" className="mb-1.5 block text-sm font-medium text-wa-muted">Nome exato na Meta</label>
        <input
          id="existing-template-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25"
          required
        />
      </div>
      <div>
        <label htmlFor="existing-template-language" className="mb-1.5 block text-sm font-medium text-wa-muted">Idioma</label>
        <input
          id="existing-template-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25"
          required
        />
      </div>
      <div>
        <label htmlFor="existing-template-header" className="mb-1.5 block text-sm font-medium text-wa-muted">Cabeçalho</label>
        <select
          id="existing-template-header"
          value={headerType}
          onChange={(e) => setHeaderType(e.target.value)}
          className="w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25"
        >
          <option value="">Nenhum</option>
          <option value="document">Documento</option>
          <option value="image">Imagem</option>
          <option value="video">Vídeo</option>
        </select>
      </div>
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-[12px] bg-wa-green px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green disabled:cursor-not-allowed disabled:opacity-50"
        >
          Registrar
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-wa-border bg-wa-surface px-3 py-1.5 text-sm font-medium text-wa-muted transition hover:bg-wa-panel hover:text-wa-text"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

function TemplatesAdminTab() {
  const { token } = useAuth();
  const { templates, refresh } = useTemplates();
  const { channels } = useChannels();
  const officialChannels = channels.filter((channel) => isOfficialChannelType(channel.type));

  const [viewingTemplates, setViewingTemplates] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [registeringTemplate, setRegisteringTemplate] = useState(false);
  const [channelId, setChannelId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('UTILITY');
  const [language, setLanguage] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [syncError, setSyncError] = useState(null);

  const wabaIds = [...new Set(officialChannels.map((channel) => channel.wabaId).filter(Boolean))];

  const firstOfficialChannelId = officialChannels[0]?.id;

  useEffect(() => {
    if (!channelId && firstOfficialChannelId) {
      setChannelId(firstOfficialChannelId);
    }
  }, [firstOfficialChannelId, channelId]);

  async function handleCreate(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createTemplateAdmin({ channelId, name, category, language, bodyText }, token);
      setName('');
      setBodyText('');
      setCreatingTemplate(false);
      refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao criar template');
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancelCreate() {
    setName('');
    setBodyText('');
    setError(null);
    setCreatingTemplate(false);
  }

  async function handleSync(wabaId) {
    setSyncError(null);
    try {
      await syncTemplatesAdmin(wabaId, token);
      refresh();
    } catch (err) {
      setSyncError((err.body && err.body.error) || 'Falha ao sincronizar');
    }
  }

  return (
    <div className="space-y-6">
      {wabaIds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {wabaIds.map((wabaId) => (
            <button
              key={wabaId}
              onClick={() => handleSync(wabaId)}
              className="rounded-[10px] border border-wa-border bg-wa-surface px-3 py-1.5 text-[13.5px] font-medium text-wa-text transition hover:bg-wa-hover"
            >
              Sincronizar agora ({wabaId})
            </button>
          ))}
        </div>
      )}
      {syncError && (
        <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{syncError}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setViewingTemplates(true)}
          className="rounded-lg border border-wa-border bg-wa-field px-3 py-1.5 text-sm font-medium text-wa-text transition hover:bg-wa-panel"
        >
          Ver templates ({templates.length})
        </button>
        {!creatingTemplate && (
          <button
            type="button"
            onClick={() => setCreatingTemplate(true)}
            className="rounded-lg border border-wa-border bg-wa-field px-3 py-1.5 text-sm font-medium text-wa-text transition hover:bg-wa-panel"
          >
            Cadastrar novo template
          </button>
        )}
        {!registeringTemplate && (
          <button
            type="button"
            onClick={() => setRegisteringTemplate(true)}
            className="rounded-lg border border-wa-border bg-wa-field px-3 py-1.5 text-sm font-medium text-wa-text transition hover:bg-wa-panel"
          >
            Registrar template existente
          </button>
        )}
      </div>

      {viewingTemplates && (
        <TemplatesModal templates={templates} onClose={() => setViewingTemplates(false)} onDeleted={refresh} />
      )}

      {creatingTemplate && (
      <form
        onSubmit={handleCreate}
        aria-label="Cadastrar novo template"
        className="space-y-3 rounded-2xl border border-wa-surface-line bg-wa-surface p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
      >
        <h3 className="font-display text-base font-semibold text-wa-text">Cadastrar novo template</h3>
        <div>
          <label htmlFor="template-channel" className="mb-1.5 block text-sm font-medium text-wa-muted">
            Canal
          </label>
          <select
            id="template-channel"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className="w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25"
            required
          >
            {officialChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="template-name" className="mb-1.5 block text-sm font-medium text-wa-muted">
            Nome
          </label>
          <input
            id="template-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="fatura_vencida"
            className="w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25"
            required
          />
        </div>
        <div>
          <label htmlFor="template-category" className="mb-1.5 block text-sm font-medium text-wa-muted">
            Categoria
          </label>
          <select
            id="template-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25"
          >
            <option value="UTILITY">Utilidade</option>
            <option value="MARKETING">Marketing</option>
          </select>
        </div>
        <div>
          <label htmlFor="template-language" className="mb-1.5 block text-sm font-medium text-wa-muted">
            Idioma
          </label>
          <input
            id="template-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25"
            required
          />
        </div>
        <div>
          <label htmlFor="template-body" className="mb-1.5 block text-sm font-medium text-wa-muted">
            Corpo da mensagem
          </label>
          <textarea
            id="template-body"
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder="Olá {{1}}, sua fatura de {{2}} venceu."
            className="w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25"
            required
          />
        </div>
        {error && (
          <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-[12px] bg-wa-green px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cadastrar
          </button>
          <button
            type="button"
            onClick={handleCancelCreate}
            className="rounded-lg border border-wa-border bg-wa-surface px-3 py-1.5 text-sm font-medium text-wa-muted transition hover:bg-wa-panel hover:text-wa-text"
          >
            Cancelar
          </button>
        </div>
      </form>
      )}

      {registeringTemplate && (
        <RegisterExistingTemplateForm
          onRegistered={() => {
            refresh();
            setRegisteringTemplate(false);
          }}
          onCancel={() => setRegisteringTemplate(false)}
        />
      )}
    </div>
  );
}

export default TemplatesAdminTab;
