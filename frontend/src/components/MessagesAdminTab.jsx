import { useState } from 'react';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useChannels } from '../hooks/useChannels';
import { useAuth } from '../contexts/AuthContext';
import { useCityNotices } from '../hooks/useCityNotices';
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { useAssignmentMessageConfig } from '../hooks/useAssignmentMessageConfig';
import {
  updateQuickReply,
  deleteQuickReply,
  setChannelWelcomeMessage,
  setCityNotice,
  deleteCityNotice,
  updateAssignmentMessageConfig,
} from '../services/api';
import CreateQuickReplyForm from './CreateQuickReplyForm';
import WaDialog, { waPrimaryButtonClass } from './WaDialog';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';

function QuickReplyRow({ quickReply, onSaved, onDeleted }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(quickReply.title);
  const [content, setContent] = useState(quickReply.content);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await updateQuickReply(quickReply.id, { title, content }, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  function handleEditClick() {
    setTitle(quickReply.title);
    setContent(quickReply.content);
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setTitle(quickReply.title);
    setContent(quickReply.content);
    setError(null);
    setEditing(false);
  }

  async function handleDelete() {
    if (!window.confirm(`Excluir a resposta rápida "${quickReply.title}"?`)) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteQuickReply(quickReply.id, token);
      onDeleted();
    } catch (err) {
      setDeleteError((err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="space-y-2 rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
          required
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className={inputClass}
          required
        />
        {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-teal-signal px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-ink-950/15 bg-white/50 px-3 py-1.5 text-sm font-medium text-ink-950/70 transition hover:bg-white/80 hover:text-ink-950"
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-ink-950">{quickReply.title}</p>
          <p className="text-sm text-ink-950/55">{quickReply.content}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleEditClick} className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline">
            Editar
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-sm font-medium text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
          >
            Excluir
          </button>
        </div>
      </div>
      {deleteError && (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{deleteError}</p>
      )}
    </div>
  );
}

function QuickRepliesModal({ quickReplies, onClose, onSaved, onDeleted }) {
  return (
    <WaDialog title="Respostas rápidas cadastradas" onClose={onClose} size="max-w-lg">
      <div className="wa-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {quickReplies.length === 0 ? (
          <p className="text-sm text-wa-muted">Nenhuma resposta rápida cadastrada ainda.</p>
        ) : (
          quickReplies.map((quickReply) => (
            <QuickReplyRow key={quickReply.id} quickReply={quickReply} onSaved={onSaved} onDeleted={onDeleted} />
          ))
        )}
      </div>
    </WaDialog>
  );
}

function ChannelWelcomeMessageRow({ channel, onSaved }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(channel.welcomeMessage || '');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  function handleEditClick() {
    setText(channel.welcomeMessage || '');
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setText(channel.welcomeMessage || '');
    setError(null);
    setEditing(false);
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await setChannelWelcomeMessage(channel.id, text, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Remover a boas-vindas do canal "${channel.name}"?`)) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await setChannelWelcomeMessage(channel.id, '', token);
      onSaved();
    } catch (err) {
      setDeleteError((err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="space-y-2 rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
      >
        <p className="font-medium text-ink-950">{channel.name}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
          required
        />
        {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-teal-signal px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-ink-950/15 bg-white/50 px-3 py-1.5 text-sm font-medium text-ink-950/70 transition hover:bg-white/80 hover:text-ink-950"
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  if (!channel.welcomeMessage) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
        <p className="font-medium text-ink-950">{channel.name}</p>
        <button onClick={handleEditClick} className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline">
          Criar boas-vindas
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-ink-950">{channel.name}</p>
          <p className="text-sm text-ink-950/55">{channel.welcomeMessage}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleEditClick} className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline">
            Editar
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-sm font-medium text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
          >
            Excluir
          </button>
        </div>
      </div>
      {deleteError && (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{deleteError}</p>
      )}
    </div>
  );
}

function CityStatusDot({ enabled }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-950/60">
      <span className={`h-2 w-2 rounded-full ${enabled ? 'bg-teal-signal' : 'bg-ink-950/25'}`} aria-hidden="true" />
      {enabled ? 'Ativo' : 'Inativo'}
    </span>
  );
}

function SectionHelp({ label, title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`O que é isso: ${label}`}
        className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline"
      >
        O que é isso?
      </button>
      {open && (
        <WaDialog title={title} onClose={() => setOpen(false)} size="max-w-md">
          <div className="px-6 py-4 text-[14.5px] leading-[20px] text-wa-text">{children}</div>
          <div className="flex shrink-0 justify-end px-4 py-3">
            <button type="button" onClick={() => setOpen(false)} className={waPrimaryButtonClass}>
              Entendi
            </button>
          </div>
        </WaDialog>
      )}
    </>
  );
}

function CityNoticeRow({ city, onSaved }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState((city.notice && city.notice.message) || '');
  const [enabled, setEnabled] = useState(Boolean(city.notice && city.notice.enabled));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  function handleEditClick() {
    setText((city.notice && city.notice.message) || '');
    setEnabled(Boolean(city.notice && city.notice.enabled));
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setText((city.notice && city.notice.message) || '');
    setEnabled(Boolean(city.notice && city.notice.enabled));
    setError(null);
    setEditing(false);
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await setCityNotice(city.id, text, enabled, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Remover o aviso da cidade "${city.name}"?`)) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteCityNotice(city.id, token);
      onSaved();
    } catch (err) {
      setDeleteError((err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="space-y-2 rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
      >
        <p className="font-medium text-ink-950">{city.name}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
          required
        />
        <label className="flex items-center gap-2 text-sm text-ink-950/70">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-teal-signal"
          />
          Ativo
        </label>
        {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-teal-signal px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-ink-950/15 bg-white/50 px-3 py-1.5 text-sm font-medium text-ink-950/70 transition hover:bg-white/80 hover:text-ink-950"
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  if (!city.notice) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
        <p className="font-medium text-ink-950">{city.name}</p>
        <button onClick={handleEditClick} className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline">
          Criar aviso
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-ink-950">{city.name}</p>
          <p className="text-sm text-ink-950/55">{city.notice.message}</p>
        </div>
        <div className="flex items-center gap-3">
          <CityStatusDot enabled={city.notice.enabled} />
          <button onClick={handleEditClick} className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline">
            Editar
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-sm font-medium text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
          >
            Excluir
          </button>
        </div>
      </div>
      {deleteError && (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{deleteError}</p>
      )}
    </div>
  );
}

function AssignmentMessageSection() {
  const { token } = useAuth();
  const { config, refresh } = useAssignmentMessageConfig();
  const { agents } = useAgentsAdmin(true);
  const { channels } = useChannels(true);
  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState(config.enabled);
  const [openingMessage, setOpeningMessage] = useState(config.openingMessage);
  const [closingMessage, setClosingMessage] = useState(config.closingMessage);
  const [agentIds, setAgentIds] = useState(config.agentIds);
  const [channelIds, setChannelIds] = useState(config.channelIds);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  function handleEditClick() {
    setEnabled(config.enabled);
    setOpeningMessage(config.openingMessage);
    setClosingMessage(config.closingMessage);
    setAgentIds(config.agentIds);
    setChannelIds(config.channelIds);
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setEnabled(config.enabled);
    setOpeningMessage(config.openingMessage);
    setClosingMessage(config.closingMessage);
    setAgentIds(config.agentIds);
    setChannelIds(config.channelIds);
    setError(null);
    setEditing(false);
  }

  function toggleAgent(agentId) {
    setAgentIds((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  }

  function toggleChannel(channelId) {
    setChannelIds((prev) => (prev.includes(channelId) ? prev.filter((id) => id !== channelId) : [...prev, channelId]));
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await updateAssignmentMessageConfig({ enabled, openingMessage, closingMessage, agentIds, channelIds }, token);
      setEditing(false);
      refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="space-y-3 rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
      >
        <label className="flex items-center gap-2 text-sm text-ink-950/70">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-teal-signal" />
          Ativo
        </label>
        <div className="space-y-1">
          <label htmlFor="assignment-opening-message" className="text-sm font-medium text-ink-950">
            Mensagem de abertura
          </label>
          <textarea
            id="assignment-opening-message"
            value={openingMessage}
            onChange={(e) => setOpeningMessage(e.target.value)}
            placeholder="@chat_saudacao_maiusculo, meu nome é @chat_atendente. Irei iniciar seu atendimento, como posso te ajudar? O protocolo do seu atendimento é @chat_protocolo"
            className={inputClass}
            required
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="assignment-closing-message" className="text-sm font-medium text-ink-950">
            Mensagem de encerramento
          </label>
          <textarea
            id="assignment-closing-message"
            value={closingMessage}
            onChange={(e) => setClosingMessage(e.target.value)}
            placeholder="Estou encerrando seu atendimento! Qualquer dúvida coloco-me prontamente à disposição."
            className={inputClass}
            required
          />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink-950">Atendentes</p>
          <div className="space-y-1">
            {agents.map((agent) => (
              <label key={agent.id} className="flex items-center gap-2 text-sm text-ink-950/70">
                <input
                  type="checkbox"
                  checked={agentIds.includes(agent.id)}
                  onChange={() => toggleAgent(agent.id)}
                  className="h-4 w-4 accent-teal-signal"
                />
                {agent.name}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink-950">Canais</p>
          <div className="space-y-1">
            {channels.map((channel) => (
              <label key={channel.id} className="flex items-center gap-2 text-sm text-ink-950/70">
                <input
                  type="checkbox"
                  checked={channelIds.includes(channel.id)}
                  onChange={() => toggleChannel(channel.id)}
                  className="h-4 w-4 accent-teal-signal"
                />
                {channel.name}
              </label>
            ))}
          </div>
        </div>
        {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-teal-signal px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-ink-950/15 bg-white/50 px-3 py-1.5 text-sm font-medium text-ink-950/70 transition hover:bg-white/80 hover:text-ink-950"
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  if (config.id === null) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
        <p className="text-sm text-ink-950/55">Nenhuma configuração criada ainda.</p>
        <button onClick={handleEditClick} className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline">
          Criar atribuição
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-950/70">
          {config.agentIds.length} atendentes, {config.channelIds.length} canais
        </p>
        <div className="flex items-center gap-3">
          <CityStatusDot enabled={config.enabled} />
          <button onClick={handleEditClick} className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline">
            Editar
          </button>
        </div>
      </div>
    </div>
  );
}

function MessagesAdminTab() {
  const { quickReplies, refresh } = useQuickReplies();
  const { channels, refresh: refreshChannels } = useChannels(true);
  const { cityNotices, refresh: refreshCityNotices } = useCityNotices();
  const [creatingQuickReply, setCreatingQuickReply] = useState(false);
  const [viewingQuickReplies, setViewingQuickReplies] = useState(false);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold text-ink-950">Boas-vindas por canal</h2>
          <SectionHelp label="Boas-vindas por canal" title="Boas-vindas por canal">
            <p>
              Enviada automaticamente para o cliente assim que ele manda a primeira mensagem em um
              canal — antes de qualquer outra automação.
            </p>
            <p className="mt-2 italic">
              Exemplo: "Olá! Bem-vindo à DW Telecom. Em instantes um atendente vai continuar o seu
              atendimento."
            </p>
          </SectionHelp>
        </div>
        {channels.map((channel) => (
          <ChannelWelcomeMessageRow key={channel.id} channel={channel} onSaved={refreshChannels} />
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold text-ink-950">Avisos por cidade</h2>
          <SectionHelp label="Avisos por cidade" title="Avisos por cidade">
            <p>
              Enviado automaticamente para clientes daquela cidade quando entram em contato, além
              da boas-vindas normal — use para avisos de instabilidade ou manutenção pontual.
            </p>
            <p className="mt-2 italic">
              Exemplo: "Nesse momento nossa rede está passando por uma instabilidade na sua
              região. Nossa equipe já está trabalhando na correção."
            </p>
          </SectionHelp>
        </div>
        {cityNotices.length === 0 && (
          <p className="rounded-lg border border-amber-300 bg-amber-50/80 px-3 py-2 text-sm text-amber-800">
            Nenhuma cidade cadastrada ainda. Cadastre cidades na aba Cidades para poder criar avisos.
          </p>
        )}
        {cityNotices.map((city) => (
          <CityNoticeRow key={city.id} city={city} onSaved={refreshCityNotices} />
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold text-ink-950">Atribuir um atendimento</h2>
          <SectionHelp label="Atribuir um atendimento" title="Atribuir um atendimento">
            <p>
              Enviada automaticamente para o cliente quando um atendente assume o
              atendimento, e uma segunda mensagem quando ele é encerrado. Escolha
              abaixo quais atendentes e quais canais disparam essas mensagens.
            </p>
            <p className="mt-2">Placeholders disponíveis:</p>
            <ul className="mt-1 list-disc pl-5">
              <li><code>@chat_saudacao_maiusculo</code> — Bom dia / Boa tarde / Boa noite, automático</li>
              <li><code>@chat_atendente</code> — primeiro nome de quem assumiu</li>
              <li><code>@chat_protocolo</code> — número do protocolo do atendimento</li>
            </ul>
            <p className="mt-2 italic">
              Exemplo: "Bom dia, meu nome é Geovanna. Irei iniciar seu atendimento,
              como posso te ajudar? O protocolo do seu atendimento é 1042"
            </p>
          </SectionHelp>
        </div>
        <AssignmentMessageSection />
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink-950">Respostas rápidas</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCreatingQuickReply(true)}
            className="rounded-lg border border-ink-950/15 bg-white/60 px-3 py-1.5 text-sm font-medium text-ink-950 transition hover:bg-white/90"
          >
            Criar resposta rápida
          </button>
          <button
            type="button"
            onClick={() => setViewingQuickReplies(true)}
            className="rounded-lg border border-ink-950/15 bg-white/60 px-3 py-1.5 text-sm font-medium text-ink-950 transition hover:bg-white/90"
          >
            Ver mensagens ({quickReplies.length})
          </button>
        </div>
        {creatingQuickReply && (
          <CreateQuickReplyForm
            onCreated={() => {
              refresh();
              setCreatingQuickReply(false);
            }}
            onCancel={() => setCreatingQuickReply(false)}
          />
        )}
        {viewingQuickReplies && (
          <QuickRepliesModal
            quickReplies={quickReplies}
            onClose={() => setViewingQuickReplies(false)}
            onSaved={refresh}
            onDeleted={refresh}
          />
        )}
      </div>
    </div>
  );
}

export default MessagesAdminTab;
