import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../hooks/useConfirm';
import { useTemplates } from '../hooks/useTemplates';
import { useChannels } from '../hooks/useChannels';
import { createTemplateAdmin, deleteTemplateAdmin, syncTemplatesAdmin, registerExistingTemplateAdmin, setTemplatePurpose } from '../services/api';
import { isOfficialChannelType } from '../utils/channelTypes';
import { contarVariaveis } from '../utils/templatePreview';
import WaDialog, { waErrorClass, WaError } from './WaDialog';
import { AsyncState, Button, CABECALHO, CELULA, DataTable, ITEM_DE_MENU, RowMenu, inputClass } from './ui';
import { IconSearch, IconRefresh, IconNewChat, IconMore, IconInfo, IconFile } from './icons/WaIcons';
import { descreverErro } from '../utils/errorMessages';

const STATUS_META = {
  APPROVED: { label: 'Aprovado', chip: 'border-wa-chip-text/30 bg-wa-chip text-wa-chip-text' },
  PENDING: { label: 'Em análise', chip: 'border-wa-warn-text/30 bg-wa-warn-bg text-wa-warn-text' },
  REJECTED: { label: 'Rejeitado', chip: 'border-wa-error-text/30 bg-wa-error-bg text-wa-error-text' },
  PAUSED: { label: 'Pausado', chip: 'border-wa-warn-text/30 bg-wa-warn-bg text-wa-warn-text' },
  DISABLED: { label: 'Desativado', chip: 'border-wa-border bg-white/[0.06] text-wa-muted' },
};
const STATUS_OPTIONS = [
  ['all', 'Todos os status'],
  ['APPROVED', 'Aprovado'],
  ['PENDING', 'Em análise'],
  ['REJECTED', 'Rejeitado'],
];
const CATEGORY_LABELS = { UTILITY: 'Utilidade', MARKETING: 'Marketing', AUTHENTICATION: 'Autenticação' };
const LANGUAGE_LABELS = { pt_BR: 'Português (Brasil)', en_US: 'Inglês (EUA)', es: 'Espanhol' };

function statusMeta(status) {
  return STATUS_META[status] || { label: status || '—', chip: 'border-wa-border bg-white/[0.06] text-wa-muted' };
}
// A finalidade separa o que o atendente vê ao iniciar uma conversa do que é
// usado nos disparos (campanha e SGP). Tudo nasceu como 'atendimento' na
// migração, então trocar depois é o caminho normal, não uma exceção.
const PURPOSE_LABELS = { atendimento: 'Atendimento', disparo: 'Disparo' };

function PurposeChip({ purpose }) {
  const disparo = purpose === 'disparo';
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium ${
        disparo ? 'border-sgp-blue/30 bg-sgp-blue/10 text-sgp-blue' : 'border-wa-chip-text/30 bg-wa-chip text-wa-chip-text'
      }`}
    >
      {PURPOSE_LABELS[purpose] || PURPOSE_LABELS.atendimento}
    </span>
  );
}

function categoryLabel(category) {
  return CATEGORY_LABELS[category] || category || '—';
}
function languageLabel(language) {
  return LANGUAGE_LABELS[language] || language || '—';
}

// Escala de raio da seção: cartão 16 > controle 12 > botão de linha 10 > item de menu 8.
const CARD = 'overflow-clip rounded-[16px] border border-white/[0.09] bg-ui-surface-card/95';
const CONTROL =
  'h-10 rounded-[12px] border border-wa-border bg-wa-field text-[13.5px] text-wa-text outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-focus-ring/40';
const LABEL = 'mb-1.5 block text-[13px] font-medium text-wa-muted';

function StatusChip({ status }) {
  const meta = statusMeta(status);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[12.5px] font-medium ${meta.chip}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}

// Botão de reticências com um pop-up de ações; fecha ao clicar fora, no Esc ou ao escolher.
function TemplateRow({ template, selected, onSelect, onDeleted }) {
  const { token } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [switching, setSwitching] = useState(false);

  async function handleDelete() {
    const question = 'Excluir o template "' + template.name + '"?';
    if (!(await confirm(question, { danger: true, confirmLabel: 'Excluir' }))) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteTemplateAdmin(template.id, token);
      onDeleted();
    } catch (err) {
      setDeleteError(descreverErro(err, 'Falha ao excluir'));
      setDeleting(false);
    }
  }

  async function handleTogglePurpose() {
    setSwitching(true);
    setDeleteError(null);
    try {
      await setTemplatePurpose(template.id, template.purpose === 'disparo' ? 'atendimento' : 'disparo', token);
      onDeleted();
    } catch (err) {
      setDeleteError(descreverErro(err, 'Falha ao trocar a finalidade'));
    } finally {
      setSwitching(false);
    }
  }

  return (
    <tr
      onClick={onSelect}
      aria-selected={selected}
      className={`cursor-pointer border-t border-wa-border transition-colors ${
        selected ? 'bg-chat-orange/[0.08] shadow-[inset_3px_0_0_var(--color-chat-orange)]' : 'hover:bg-wa-hover'
      }`}
    >
      <td className={CELULA}>
        <button
          type="button"
          onClick={onSelect}
          className="block max-w-[260px] truncate text-left text-[14px] font-medium text-wa-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          title={template.name}
        >
          {template.name}
        </button>
        {template.rejectionReason && <p className="mt-0.5 text-[12px] text-wa-error-text">{template.rejectionReason}</p>}
        {deleteError && <WaError className="mt-2">{deleteError}</WaError>}
      </td>
      <td className={`${CELULA} whitespace-nowrap text-wa-text`}>{categoryLabel(template.category)}</td>
      <td className={`${CELULA} whitespace-nowrap`}>
        <PurposeChip purpose={template.purpose} />
      </td>
      <td className={`${CELULA} whitespace-nowrap`}>
        <StatusChip status={template.status} />
      </td>
      <td className={`${CELULA} whitespace-nowrap`}>
        <div className="flex items-center justify-end">
          <RowMenu label={`Mais ações para ${template.name}`}>
            <button type="button" onClick={handleTogglePurpose} disabled={switching} className={ITEM_DE_MENU}>
              {template.purpose === 'disparo' ? 'Usar para atendimento' : 'Usar para disparo'}
            </button>
            <button type="button" onClick={handleDelete} disabled={deleting} className={`${ITEM_DE_MENU} text-wa-error-text`}>
              Excluir
            </button>
          </RowMenu>
        </div>
        {confirmDialog}
      </td>
    </tr>
  );
}

function ChannelSelect({ id, value, onChange, channels, placeholder }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} required>
      {placeholder && <option value="">{placeholder}</option>}
      {channels.map((channel) => (
        <option key={channel.id} value={channel.id}>
          {channel.name}
        </option>
      ))}
    </select>
  );
}

const BUTTON_PLACEHOLDERS = ['Ex.: Sim, pode agendar', 'Ex.: Prefiro outro dia', 'Ex.: Falar com atendente'];

function CreateTemplateForm({ officialChannels, initialChannelId, onCreated, onCancel }) {
  const { token } = useAuth();
  const [channelId, setChannelId] = useState(initialChannelId || '');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('UTILITY');
  const [purpose, setPurpose] = useState('atendimento');
  const [language, setLanguage] = useState('pt_BR');
  const [bodyText, setBodyText] = useState('');
  const [buttons, setButtons] = useState(['', '', '']);
  const [examples, setExamples] = useState([]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const firstOfficialChannelId = officialChannels[0]?.id;
  const botoesPreenchidos = buttons.map((b) => b.trim()).filter(Boolean);
  // Derivado do corpo, nunca guardado em estado próprio: editar o texto e
  // acrescentar um {{5}} tem de fazer aparecer o quinto campo na hora.
  const quantidadeDeVariaveis = contarVariaveis(bodyText);
  const exemplosPreenchidos = Array.from({ length: quantidadeDeVariaveis }, (_, i) => (examples[i] || '').trim());

  // Os canais podem chegar depois do formulário abrir: preenche o primeiro
  // oficial assim que existir, sem obrigar o admin a mexer no select.
  useEffect(() => {
    if (!channelId && firstOfficialChannelId) {
      setChannelId(firstOfficialChannelId);
    }
  }, [firstOfficialChannelId, channelId]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Corpo sem variável não manda `examples` — nem lista vazia. Mesma regra do
      // service: chave ausente deixa o payload idêntico ao de antes, e quem já
      // criava template sem variável não vê diferença nenhuma.
      await createTemplateAdmin(
        {
          channelId, name, category, language, bodyText, purpose, buttons: botoesPreenchidos,
          ...(quantidadeDeVariaveis > 0 ? { examples: exemplosPreenchidos } : {}),
        },
        token
      );
      onCreated();
    } catch (err) {
      setError(descreverErro(err, 'Falha ao criar template'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Cadastrar novo template" className="space-y-3">
      <div>
        <label htmlFor="template-channel" className={LABEL}>
          Canal
        </label>
        <ChannelSelect id="template-channel" value={channelId} onChange={setChannelId} channels={officialChannels} />
      </div>
      <div>
        <label htmlFor="template-purpose" className={LABEL}>
          Finalidade
        </label>
        <select
          id="template-purpose"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          className={inputClass}
        >
          <option value="atendimento">Atendimento — o atendente escolhe ao iniciar uma conversa</option>
          <option value="disparo">Disparo — campanha e envios automáticos do SGP</option>
        </select>
      </div>
      <div>
        <label htmlFor="template-name" className={LABEL}>
          Nome
        </label>
        <input
          id="template-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="saudacao_inicial"
          className={inputClass}
          required
        />
        <p className="mt-1 text-xs text-wa-muted">Só letras minúsculas, números e _ (ex.: saudacao_inicial)</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="template-category" className={LABEL}>
            Categoria
          </label>
          <select id="template-category" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            <option value="UTILITY">Utilidade</option>
            <option value="MARKETING">Marketing</option>
          </select>
        </div>
        <div>
          <label htmlFor="template-language" className={LABEL}>
            Idioma
          </label>
          <select id="template-language" value={language} onChange={(e) => setLanguage(e.target.value)} className={inputClass} required>
            <option value="pt_BR">Português (BR)</option>
            <option value="en_US">Inglês (EUA)</option>
            <option value="es">Espanhol</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="template-body" className={LABEL}>
          Corpo da mensagem
        </label>
        <textarea
          id="template-body"
          rows={4}
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          placeholder="Olá {{1}}, sua fatura de {{2}} venceu."
          className={inputClass}
          required
        />
      </div>

      {/* A Meta aceita a criação e reprova na revisão (INVALID_FORMAT) quando o
          corpo tem variável e nenhum valor de exemplo acompanha. Os exemplos não
          são enviados a ninguém: servem só para o revisor entender o que cada
          {{n}} recebe. Por isso valem valores de verdade — "R$ 129,90" diz o que
          "texto 2" não diz. */}
      {quantidadeDeVariaveis > 0 && (
        <fieldset className="space-y-2">
          <legend className={LABEL}>Exemplos das variáveis</legend>
          <p className="text-[12.5px] leading-[17px] text-wa-muted">
            A Meta exige um exemplo por variável para aprovar o template. Use valores parecidos com os reais. Eles não
            são enviados ao cliente.
          </p>
          {Array.from({ length: quantidadeDeVariaveis }, (_, i) => (
            <div key={i}>
              <label htmlFor={`template-example-${i}`} className="mb-1 block text-[12.5px] text-wa-muted">
                {`Exemplo para {{${i + 1}}}`}
              </label>
              <input
                id={`template-example-${i}`}
                value={examples[i] || ''}
                onChange={(e) => setExamples(Object.assign([...examples], { [i]: e.target.value }))}
                className={inputClass}
                required
              />
            </div>
          ))}
        </fieldset>
      )}

      {/* Template não abre a janela de 24h: só a resposta do cliente abre. O
          botão é o caminho de um toque para ele responder — sem isso, iniciar
          uma conversa entrega a mensagem e para ali, sem como continuar. */}
      <fieldset className="space-y-2">
        <legend className={LABEL}>Botões de resposta rápida (opcional)</legend>
        <p className="text-[12.5px] leading-[17px] text-wa-muted">
          Quando o cliente toca num botão, a resposta chega no chat e reabre a janela de 24h — aí o atendente pode
          conversar normalmente. Até 3 botões, de 25 caracteres cada.
        </p>
        {buttons.map((valor, i) => (
          <div key={i}>
            <label htmlFor={`template-button-${i}`} className="sr-only">{`Botão ${i + 1}`}</label>
            <input
              id={`template-button-${i}`}
              value={valor}
              maxLength={25}
              onChange={(e) => setButtons(buttons.map((b, j) => (j === i ? e.target.value : b)))}
              placeholder={BUTTON_PLACEHOLDERS[i]}
              className={inputClass}
            />
          </div>
        ))}
        {botoesPreenchidos.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {botoesPreenchidos.map((texto) => (
              <span
                key={texto}
                className="rounded-[8px] border border-[#1d9bf0]/30 bg-white/[0.06] px-2.5 py-1 text-[12.5px] text-[#53bdeb]"
              >
                {texto}
              </span>
            ))}
          </div>
        )}
      </fieldset>

      {error && <WaError>{error}</WaError>}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={submitting}>
          Cadastrar
        </Button>
      </div>
    </form>
  );
}

function RegisterExistingTemplateForm({ officialChannels, initialChannelId, onRegistered, onCancel }) {
  const { token } = useAuth();
  const [channelId, setChannelId] = useState(initialChannelId || '');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('pt_BR');
  const [headerType, setHeaderType] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await registerExistingTemplateAdmin({ channelId, name, language, headerType: headerType || null }, token);
      onRegistered();
    } catch (err) {
      setError(descreverErro(err, 'Falha ao registrar template'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Registrar template existente" className="space-y-3">
      <p className="text-[13.5px] leading-[19px] text-wa-muted">
        Para um template já aprovado pela Meta fora deste sistema — o corpo e a quantidade de variáveis são buscados pelo nome.
      </p>
      <div>
        <label htmlFor="existing-template-channel" className={LABEL}>
          Canal
        </label>
        <ChannelSelect
          id="existing-template-channel"
          value={channelId}
          onChange={setChannelId}
          channels={officialChannels}
          placeholder="Selecione um canal"
        />
      </div>
      <div>
        <label htmlFor="existing-template-name" className={LABEL}>
          Nome exato na Meta
        </label>
        <input id="existing-template-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="existing-template-language" className={LABEL}>
            Idioma
          </label>
          <select
            id="existing-template-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className={inputClass}
            required
          >
            <option value="pt_BR">Português (BR)</option>
            <option value="en_US">Inglês (EUA)</option>
            <option value="es">Espanhol</option>
          </select>
        </div>
        <div>
          <label htmlFor="existing-template-header" className={LABEL}>
            Cabeçalho
          </label>
          <select id="existing-template-header" value={headerType} onChange={(e) => setHeaderType(e.target.value)} className={inputClass}>
            <option value="">Nenhum</option>
            <option value="document">Documento</option>
            <option value="image">Imagem</option>
            <option value="video">Vídeo</option>
          </select>
        </div>
      </div>
      {error && <WaError>{error}</WaError>}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={submitting}>
          Registrar
        </Button>
      </div>
    </form>
  );
}

function iniciais(nome) {
  const palavras = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return '?';
  const primeira = palavras[0];
  if (primeira.length <= 2 && primeira === primeira.toUpperCase()) return primeira;
  return palavras.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

// Prévia ilustrativa: o corpo do template numa conversa parecida com o WhatsApp
// do cliente, com o canal como remetente. Nada é enviado.
function TemplatePreview({ template, channel }) {
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return (
    <section aria-labelledby="template-preview-title" className={`${CARD} flex flex-col`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-3 pt-5 sm:px-5">
        <div className="min-w-0">
          <h2 id="template-preview-title" className="font-display text-[17px] font-semibold leading-[22px] text-wa-text">
            Prévia da mensagem
          </h2>
          <p className="mt-0.5 truncate text-[13px] text-wa-muted">{template ? template.name : 'Nenhum template selecionado'}</p>
        </div>
        {template && (
          <span className="inline-flex shrink-0 items-center rounded-full border border-wa-border bg-white/[0.05] px-2.5 py-[3px] text-[12px] font-medium text-wa-muted">
            {languageLabel(template.language)}
          </span>
        )}
      </div>

      <div className="px-4 sm:px-5">
        <div className="overflow-hidden rounded-[14px] border border-white/[0.06] bg-[#0b141a]">
          <div className="flex items-center gap-3 border-b border-white/[0.06] bg-[#1f2c34] px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-chat-orange text-[13px] font-semibold text-on-accent">
              {iniciais(channel?.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-[#e9edef]">{channel?.name || 'Canal'}</span>
              <span className="block text-[12px] text-[#8696a0]">Conta comercial</span>
            </span>
            <span aria-hidden="true" className="text-[#8696a0]">
              <IconMore size={18} className="rotate-90" />
            </span>
          </div>
          <div className="min-h-[150px] bg-[#0e1a20] px-4 py-5">
            {template ? (
              <div className="max-w-[88%]">
                <div
                  className={`relative rounded-[10px] rounded-tl-none bg-[#f4f1ed] px-3 pb-5 pt-2 text-[14px] leading-[20px] text-[#111b21] shadow-sm ${
                    (template.buttons || []).length > 0 ? 'rounded-b-none' : ''
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{template.bodyText || 'Corpo do template não informado.'}</p>
                  <span className="absolute bottom-1 right-2 text-[11px] text-[#667781]">{hora}</span>
                </div>
                {/* Os botões ficam colados embaixo do balão, como no WhatsApp:
                    é a resposta a um toque que reabre a janela de 24h. */}
                {(template.buttons || []).map((texto) => (
                  <div
                    key={texto}
                    className="mt-[2px] rounded-[10px] bg-[#f4f1ed] px-3 py-2 text-center text-[14px] font-medium text-[#0b8bd6]"
                  >
                    {texto}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-[13px] text-[#8696a0]">Selecione um template na lista para ver a prévia.</p>
            )}
          </div>
        </div>
      </div>

      {template && (
        <dl className="mx-4 mt-4 grid grid-cols-3 divide-x divide-wa-border border-t border-wa-border pt-4 sm:mx-5">
          <div className="pr-3">
            <dt className="text-[12px] text-wa-muted">Categoria</dt>
            <dd className="mt-1 text-[13.5px] text-wa-text">{categoryLabel(template.category)}</dd>
          </div>
          <div className="px-3">
            <dt className="text-[12px] text-wa-muted">Status</dt>
            <dd className="mt-1 text-[13.5px] text-wa-text">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${statusMeta(template.status).chip.split(' ').pop()} bg-current`} />
                {statusMeta(template.status).label}
              </span>
            </dd>
          </div>
          <div className="pl-3">
            <dt className="text-[12px] text-wa-muted">Canal</dt>
            <dd className="mt-1 truncate text-[13.5px] text-wa-text">{channel?.name || '—'}</dd>
          </div>
        </dl>
      )}

      <p className="mt-auto flex items-center gap-1.5 px-4 py-3 text-[12px] text-wa-muted sm:px-5">
        <IconInfo size={14} />
        Prévia ilustrativa. Nenhuma mensagem será enviada.
      </p>
    </section>
  );
}

function TemplatesAdminTab() {
  const { token } = useAuth();
  const { templates, status, refresh } = useTemplates();
  const { channels } = useChannels();
  const officialChannels = useMemo(() => channels.filter((channel) => isOfficialChannelType(channel.type)), [channels]);

  const [channelId, setChannelId] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);

  const firstOfficialChannelId = officialChannels[0]?.id;
  useEffect(() => {
    if (!channelId && firstOfficialChannelId) setChannelId(firstOfficialChannelId);
  }, [firstOfficialChannelId, channelId]);

  const channel = officialChannels.find((c) => c.id === channelId) || null;
  const term = search.trim().toLowerCase();

  // Template sem WABA (registro antigo) aparece em qualquer canal; os demais só
  // no canal cuja conta (WABA) é a mesma.
  const visible = useMemo(
    () =>
      templates.filter((template) => {
        if (channel && template.wabaId && channel.wabaId && template.wabaId !== channel.wabaId) return false;
        if (statusFilter !== 'all' && template.status !== statusFilter) return false;
        if (term && !String(template.name || '').toLowerCase().includes(term)) return false;
        return true;
      }),
    [templates, channel, statusFilter, term]
  );
  const selected = visible.find((template) => template.id === selectedId) || visible[0] || null;

  async function handleSync() {
    if (!channel?.wabaId) return;
    setSyncError(null);
    setSyncing(true);
    try {
      await syncTemplatesAdmin(channel.wabaId, token);
      refresh();
    } catch (err) {
      setSyncError(descreverErro(err, 'Falha ao sincronizar'));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-white/[0.09] bg-ui-surface-card/95 p-3 sm:p-4">
        <label
          className={`${CONTROL} flex min-w-[200px] flex-1 items-center gap-2.5 px-3.5 focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/25`}
        >
          <span className="shrink-0 text-wa-muted">
            <IconSearch size={17} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar template"
            aria-label="Buscar template"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-wa-muted"
          />
        </label>
        <select
          aria-label="Canal"
          value={channelId}
          onChange={(event) => {
            setChannelId(event.target.value);
            setSelectedId(null);
          }}
          className={`${CONTROL} max-w-[240px] px-3 pr-8`}
        >
          {officialChannels.length === 0 && <option value="">Nenhum canal oficial</option>}
          {officialChannels.map((c) => (
            <option key={c.id} value={c.id}>
              Canal: {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className={`${CONTROL} px-3 pr-8`}
        >
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleSync}
            loading={syncing}
            disabled={!channel?.wabaId}
            title={channel?.wabaId ? `Buscar na Meta os templates da conta ${channel.wabaId}` : 'O canal selecionado não tem WABA ID'}
            className="!py-2"
          >
            <IconRefresh size={17} />
            Sincronizar
          </Button>
          <Button onClick={() => setCreating(true)} className="!py-2">
            <IconNewChat size={18} />
            Novo template
          </Button>
        </div>
      </div>
      {syncError && <WaError>{syncError}</WaError>}

      <div className="settings-template-library grid items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div>
          <section aria-labelledby="templates-card-title" className={CARD}>
            <div className="settings-register-head flex items-center gap-2.5 px-4 pb-3 pt-5 sm:px-5">
              <h2 id="templates-card-title" className="font-display text-[17px] font-semibold leading-[22px] text-wa-text">
                Templates do canal
              </h2>
              <span className="inline-flex h-[20px] min-w-[22px] items-center justify-center rounded-[6px] bg-white/[0.10] px-1.5 text-[12px] font-semibold text-wa-text">
                {visible.length}
              </span>
            </div>
            <div className="px-4 pb-1 sm:px-5">
              <AsyncState status={status} onRetry={refresh} isEmpty={templates.length === 0} emptyMessage="Nenhum template cadastrado ainda.">
                <DataTable label="Templates" className="min-w-[480px]">
                    <thead>
                      <tr className="bg-black/[0.16]">
                        <th scope="col" className={CABECALHO}>
                          Nome
                        </th>
                        <th scope="col" className={CABECALHO}>
                          Categoria
                        </th>
                        <th scope="col" className={CABECALHO}>
                          Finalidade
                        </th>
                        <th scope="col" className={CABECALHO}>
                          Status
                        </th>
                        <th scope="col" className={`${CABECALHO} text-right`}>
                          Ações
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.length === 0 ? (
                        <tr className="border-t border-wa-border">
                          <td colSpan={5} className="px-3 py-6 text-center text-[13.5px] text-wa-muted">
                            Nenhum template neste canal com esse filtro.
                          </td>
                        </tr>
                      ) : (
                        visible.map((template) => (
                          <TemplateRow
                            key={template.id}
                            template={template}
                            selected={selected?.id === template.id}
                            onSelect={() => setSelectedId(template.id)}
                            onDeleted={refresh}
                          />
                        ))
                      )}
                    </tbody>
                  </DataTable>
              </AsyncState>
            </div>
            <p className="flex items-center gap-1.5 border-t border-wa-border px-4 py-3 text-[12px] text-wa-muted sm:px-5">
              <IconInfo size={14} />
              Status de aprovação informado pela Meta.
            </p>
            <div className="flex flex-wrap items-center gap-4 border-t border-white/[0.08] bg-black/[0.08] px-4 py-4 sm:px-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.06] text-wa-muted"><IconFile size={19} /></span>
            <div className="min-w-0 flex-1 basis-[14rem]">
              <p className="text-[14.5px] font-medium text-wa-text">Já tem um template cadastrado?</p>
              <p className="mt-0.5 text-[13px] text-wa-muted">Vincule um modelo existente ao canal selecionado.</p>
            </div>
            <Button variant="secondary" onClick={() => setRegistering(true)} aria-label="Registrar template existente" className="!py-2">
              Registrar existente
            </Button>
            </div>
          </section>
        </div>

        <TemplatePreview template={selected} channel={channel} />
      </div>

      {creating && (
        <WaDialog variant="templates" title="Novo template" onClose={() => setCreating(false)} size="max-w-4xl">
          <div className="wa-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-5 pt-2">
            <CreateTemplateForm
              officialChannels={officialChannels}
              initialChannelId={channelId}
              onCreated={() => {
                setCreating(false);
                refresh();
              }}
              onCancel={() => setCreating(false)}
            />
          </div>
        </WaDialog>
      )}
      {registering && (
        <WaDialog variant="templates" title="Registrar template existente" onClose={() => setRegistering(false)} size="max-w-4xl">
          <div className="wa-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-5 pt-2">
            <RegisterExistingTemplateForm
              officialChannels={officialChannels}
              initialChannelId={channelId}
              onRegistered={() => {
                setRegistering(false);
                refresh();
              }}
              onCancel={() => setRegistering(false)}
            />
          </div>
        </WaDialog>
      )}
    </>
  );
}

export default TemplatesAdminTab;
