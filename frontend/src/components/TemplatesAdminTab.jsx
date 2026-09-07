import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTemplates } from '../hooks/useTemplates';
import { useChannels } from '../hooks/useChannels';
import { createTemplateAdmin, deleteTemplateAdmin, syncTemplatesAdmin } from '../services/api';

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
    <div className="rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-gray-800">{template.name}</p>
          <p className="text-sm text-gray-500">
            <span>{template.language}</span> · <span>{template.category}</span> · <span>{template.status}</span>
          </p>
          {template.rejectionReason && <p className="text-sm text-red-600">{template.rejectionReason}</p>}
        </div>
        <button onClick={handleDelete} disabled={deleting} className="text-sm text-red-600 underline disabled:opacity-50">
          Excluir
        </button>
      </div>
      {deleteError && <p className="mt-1 text-sm text-red-600">{deleteError}</p>}
    </div>
  );
}

function TemplatesAdminTab() {
  const { token } = useAuth();
  const { templates, refresh } = useTemplates();
  const { channels } = useChannels();
  const metaCloudChannels = channels.filter((channel) => channel.type === 'meta_cloud');

  const [channelId, setChannelId] = useState(metaCloudChannels[0]?.id || '');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('UTILITY');
  const [language, setLanguage] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [syncError, setSyncError] = useState(null);

  const wabaIds = [...new Set(metaCloudChannels.map((channel) => channel.wabaId).filter(Boolean))];

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
      {wabaIds.map((wabaId) => (
        <button
          key={wabaId}
          onClick={() => handleSync(wabaId)}
          className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700"
        >
          Sincronizar agora ({wabaId})
        </button>
      ))}
      {syncError && <p className="text-sm text-red-600">{syncError}</p>}
      <div className="space-y-3">
        {templates.map((template) => (
          <TemplateRow key={template.id} template={template} onDeleted={refresh} />
        ))}
      </div>
      <form onSubmit={handleCreate} className="space-y-3 rounded border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-800">Cadastrar novo template</h3>
        <div>
          <label htmlFor="template-channel" className="mb-1 block text-sm text-gray-600">
            Canal
          </label>
          <select
            id="template-channel"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2"
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
          <label htmlFor="template-name" className="mb-1 block text-sm text-gray-600">
            Nome
          </label>
          <input
            id="template-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="fatura_vencida"
            className="w-full rounded border border-gray-300 px-3 py-2"
            required
          />
        </div>
        <div>
          <label htmlFor="template-category" className="mb-1 block text-sm text-gray-600">
            Categoria
          </label>
          <select
            id="template-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2"
          >
            <option value="UTILITY">Utilidade</option>
            <option value="MARKETING">Marketing</option>
          </select>
        </div>
        <div>
          <label htmlFor="template-language" className="mb-1 block text-sm text-gray-600">
            Idioma
          </label>
          <input
            id="template-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2"
            required
          />
        </div>
        <div>
          <label htmlFor="template-body" className="mb-1 block text-sm text-gray-600">
            Corpo da mensagem
          </label>
          <textarea
            id="template-body"
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder="Olá {{1}}, sua fatura de {{2}} venceu."
            className="w-full rounded border border-gray-300 px-3 py-2"
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
          Cadastrar
        </button>
      </form>
    </div>
  );
}

export default TemplatesAdminTab;
