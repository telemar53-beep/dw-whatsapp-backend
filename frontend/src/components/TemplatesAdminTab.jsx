import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTemplates } from '../hooks/useTemplates';
import { useChannels } from '../hooks/useChannels';
import { createTemplateAdmin, deleteTemplateAdmin, syncTemplatesAdmin, registerExistingTemplateAdmin } from '../services/api';

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
    <div className="rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-ink-950">{template.name}</p>
          <p className="text-sm text-ink-950/55">
            <span>{template.language}</span> · <span>{template.category}</span> · <span>{template.status}</span>
          </p>
          {template.rejectionReason && <p className="text-sm text-red-600">{template.rejectionReason}</p>}
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-sm font-medium text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
        >
          Excluir
        </button>
      </div>
      {deleteError && (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{deleteError}</p>
      )}
    </div>
  );
}

function RegisterExistingTemplateForm({ onRegistered }) {
  const { token } = useAuth();
  const { channels } = useChannels();
  const metaCloudChannels = channels.filter((channel) => channel.type === 'meta_cloud');

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
      className="space-y-3 rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
    >
      <h3 className="font-display text-base font-semibold text-ink-950">Registrar template existente</h3>
      <p className="text-sm text-ink-950/55">
        Para um template já aprovado pela Meta fora deste sistema — busca o corpo e a quantidade de variáveis automaticamente pelo nome.
      </p>
      <div>
        <label htmlFor="existing-template-channel" className="mb-1.5 block text-sm font-medium text-ink-950/70">Canal</label>
        <select
          id="existing-template-channel"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
          required
        >
          <option value="">Selecione um canal</option>
          {metaCloudChannels.map((channel) => (
            <option key={channel.id} value={channel.id}>{channel.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="existing-template-name" className="mb-1.5 block text-sm font-medium text-ink-950/70">Nome exato na Meta</label>
        <input
          id="existing-template-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
          required
        />
      </div>
      <div>
        <label htmlFor="existing-template-language" className="mb-1.5 block text-sm font-medium text-ink-950/70">Idioma</label>
        <input
          id="existing-template-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
          required
        />
      </div>
      <div>
        <label htmlFor="existing-template-header" className="mb-1.5 block text-sm font-medium text-ink-950/70">Cabeçalho</label>
        <select
          id="existing-template-header"
          value={headerType}
          onChange={(e) => setHeaderType(e.target.value)}
          className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
        >
          <option value="">Nenhum</option>
          <option value="document">Documento</option>
          <option value="image">Imagem</option>
          <option value="video">Vídeo</option>
        </select>
      </div>
      {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Registrar
      </button>
    </form>
  );
}

function TemplatesAdminTab() {
  const { token } = useAuth();
  const { templates, refresh } = useTemplates();
  const { channels } = useChannels();
  const metaCloudChannels = channels.filter((channel) => channel.type === 'meta_cloud');

  const [channelId, setChannelId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('UTILITY');
  const [language, setLanguage] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [syncError, setSyncError] = useState(null);

  const wabaIds = [...new Set(metaCloudChannels.map((channel) => channel.wabaId).filter(Boolean))];

  const firstMetaCloudChannelId = metaCloudChannels[0]?.id;

  useEffect(() => {
    if (!channelId && firstMetaCloudChannelId) {
      setChannelId(firstMetaCloudChannelId);
    }
  }, [firstMetaCloudChannelId, channelId]);

  async function handleCreate(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createTemplateAdmin({ channelId, name, category, language, bodyText }, token);
      setName('');
      setBodyText('');
      refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao criar template');
    } finally {
      setSubmitting(false);
    }
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
              className="rounded-lg border border-teal-signal/30 bg-teal-signal/10 px-3 py-1.5 text-sm font-medium text-teal-signal transition hover:bg-teal-signal/15"
            >
              Sincronizar agora ({wabaId})
            </button>
          ))}
        </div>
      )}
      {syncError && (
        <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{syncError}</p>
      )}
      <div className="space-y-3">
        {templates.map((template) => (
          <TemplateRow key={template.id} template={template} onDeleted={refresh} />
        ))}
      </div>
      <form
        onSubmit={handleCreate}
        aria-label="Cadastrar novo template"
        className="space-y-3 rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
      >
        <h3 className="font-display text-base font-semibold text-ink-950">Cadastrar novo template</h3>
        <div>
          <label htmlFor="template-channel" className="mb-1.5 block text-sm font-medium text-ink-950/70">
            Canal
          </label>
          <select
            id="template-channel"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
            required
          >
            {metaCloudChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="template-name" className="mb-1.5 block text-sm font-medium text-ink-950/70">
            Nome
          </label>
          <input
            id="template-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="fatura_vencida"
            className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
            required
          />
        </div>
        <div>
          <label htmlFor="template-category" className="mb-1.5 block text-sm font-medium text-ink-950/70">
            Categoria
          </label>
          <select
            id="template-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
          >
            <option value="UTILITY">Utilidade</option>
            <option value="MARKETING">Marketing</option>
          </select>
        </div>
        <div>
          <label htmlFor="template-language" className="mb-1.5 block text-sm font-medium text-ink-950/70">
            Idioma
          </label>
          <input
            id="template-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
            required
          />
        </div>
        <div>
          <label htmlFor="template-body" className="mb-1.5 block text-sm font-medium text-ink-950/70">
            Corpo da mensagem
          </label>
          <textarea
            id="template-body"
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder="Olá {{1}}, sua fatura de {{2}} venceu."
            className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
            required
          />
        </div>
        {error && (
          <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cadastrar
        </button>
      </form>
      <RegisterExistingTemplateForm onRegistered={refresh} />
    </div>
  );
}

export default TemplatesAdminTab;
