import { SettingsIcon } from '../SettingsVisuals';
import { ProviderMark, QrStatusIcon, VisibilityIcon } from './ChannelVisuals';
import './channels-polish.css';
import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { IconSearch, IconSettings, IconMore, IconClock, IconCheckCircle, IconWarning, IconUser, IconSpark, IconRefresh, IconTrash } from '../../../components/icons/WaIcons';
import { isOfficialChannelType } from '../../../utils/channelTypes';
import { formatPhone } from '../../../utils/phone';
import { STATUS_LABELS } from './channelStatus';
import { channelSummary } from './channelSummary';

const PROVIDER_LABELS = { baileys: 'Baileys', meta_cloud: 'Meta Cloud', '360dialog': '360dialog' };
const TYPE_OPTIONS = [
  ['all', 'Todos os tipos'],
  ['baileys', 'Baileys'],
  ['meta_cloud', 'Meta Cloud'],
  ['360dialog', '360dialog'],
];
// Os nomes curtos do resumo de atendimento; o resumo continua sendo a fonte.
const CHIP_LABELS = { IA: 'IA ativa' };
const CHIP_TONES = {
  'IA ativa': 'border-wa-chip-text/30 bg-wa-chip text-wa-chip-text',
  'Triagem IA': 'border-sgp-blue/30 bg-sgp-blue/10 text-sgp-blue',
  Humano: 'border-wa-warn-text/30 bg-wa-warn-bg text-wa-warn-text',
};

const CONTROL =
  'h-10 rounded-[12px] border border-wa-border bg-wa-field text-[13.5px] text-wa-text outline-none transition focus:border-wa-green/60 focus:ring-2 focus:ring-wa-green/25';
const SMALL_BTN =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-wa-border bg-wa-field px-3 text-[13px] font-medium text-wa-text transition hover:bg-wa-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green disabled:opacity-50';
const ICON_BTN =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-wa-border bg-wa-field text-wa-text transition hover:bg-wa-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green';
const MENU_ITEM =
  'flex w-full items-center rounded-[8px] px-3 py-2 text-left text-[13.5px] text-wa-text transition hover:bg-wa-hover disabled:opacity-50';

export function providerLabel(type) {
  return PROVIDER_LABELS[type] || type;
}

export function ChannelIcon({ size = 36, type }) {
  return (
    <span
      aria-hidden="true"
      data-provider={type}
      style={{ width: size, height: size }}
      className="settings-channel-symbol flex shrink-0 items-center justify-center rounded-lg bg-[#25d366]/10 text-[#85d9a4]"
    >
      {type ? <ProviderMark type={type} /> : <SettingsIcon name="canais" size={Math.round(size * 0.55)} />}
    </span>
  );
}

// A qualidade que a Meta atribui ao número: é o aviso que vem ANTES de ela
// limitar ou bloquear o envio. UNKNOWN (número novo, sem histórico) não vira
// chip — não há o que dizer.
const QUALITY_LABELS = { GREEN: 'Qualidade alta', YELLOW: 'Qualidade média', RED: 'Qualidade baixa' };
const QUALITY_TONES = {
  GREEN: 'border-wa-chip-text/30 bg-wa-chip text-wa-chip-text',
  YELLOW: 'border-wa-warn-text/30 bg-wa-warn-bg text-wa-warn-text',
  RED: 'border-wa-error-text/30 bg-wa-error-bg text-wa-error-text',
};

function NotVerified() {
  return (
    <span data-connection="unknown" className="channel-connection inline-flex items-center gap-1.5 whitespace-nowrap text-[13.5px] text-wa-muted">
      <IconClock size={15} />
      Não verificada
    </span>
  );
}

// Conexão: o Baileys tem handshake próprio e o status vem do banco. O oficial
// não tem — quem sabe é a Meta, e o backend pergunta a ela ao montar a lista
// (só meta_cloud; o 360dialog continua sem verificação). Sem resposta dela, o
// selo volta a ser o "Não verificada" de sempre, que é honesto: não sabemos.
export function ConnectionStatus({ channel }) {
  if (isOfficialChannelType(channel.type)) {
    const { connection } = channel;
    if (!connection || connection.state === 'unknown') {
      return <NotVerified />;
    }
    if (connection.state === 'connected') {
      const quality = QUALITY_LABELS[connection.quality];
      return (
        <span data-connection="connected" className="channel-connection inline-flex items-center gap-2 whitespace-nowrap text-[13.5px] text-wa-text">
          <span className="channel-status-icon" aria-hidden="true"><IconCheckCircle size={13} /></span>
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-wa-chip-text" />
          Conectado
          {quality && (
            <span className={`rounded-full border px-2 py-0.5 text-[12px] font-medium ${QUALITY_TONES[connection.quality]}`}>
              {quality}
            </span>
          )}
        </span>
      );
    }
    const motivo = connection.state === 'disconnected' ? 'Desconectado' : connection.motivo;
    return (
      <span data-connection="error" className="channel-connection inline-flex items-center gap-2 text-[13.5px] text-wa-text" title={motivo}>
        <span className="channel-status-icon" aria-hidden="true"><IconWarning size={13} /></span>
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-wa-error-text" />
        <span className="max-w-[22ch] truncate">{motivo}</span>
      </span>
    );
  }
  const color =
    channel.status === 'connected' ? 'bg-wa-chip-text' : channel.status === 'awaiting_qr' ? 'bg-wa-warn-text' : 'bg-wa-error-text';
  return (
    <span data-connection={channel.status} className="channel-connection inline-flex max-w-full items-center gap-2 text-[13.5px] text-wa-text">
      <span className="channel-status-icon" aria-hidden="true">{channel.status === 'connected' ? <IconCheckCircle size={13} /> : channel.status === 'awaiting_qr' ? <QrStatusIcon /> : <IconWarning size={13} />}</span>
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
      <span className="min-w-0 leading-[18px]">{STATUS_LABELS[channel.status] || channel.status}</span>
    </span>
  );
}

// Botão de reticências com um pop-up de ações; fecha ao clicar fora, no Esc ou ao escolher.
function RowMenu({ label, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={ICON_BTN}
      >
        <IconMore size={18} />
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="channel-row-menu absolute right-0 top-[calc(100%+4px)] z-20 min-w-[180px] rounded-[12px] border border-wa-border bg-wa-panel p-1 shadow-[var(--wa-dialog-shadow)]"
        >
          {children}
        </div>
      )}
    </div>
  );
}

function ChannelRow({ channel, selected, summaryContext, actions, canManage }) {
  const { chips, warnings } = channelSummary(channel, summaryContext);
  const labels = chips.length > 0 ? chips.map((chip) => CHIP_LABELS[chip] || chip) : ['Humano'];
  const official = isOfficialChannelType(channel.type);
  const busy = actions && actions.busyChannelId === channel.id;
  const detailTo = `/configuracoes/canais/${channel.id}/conexao`;

  return (
    <li
      aria-selected={selected}
      className={`settings-channel-record grid gap-3 border-t border-wa-border px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(190px,1.2fr)_minmax(135px,0.7fr)_minmax(215px,1.2fr)_auto] lg:items-center ${
        selected ? 'bg-chat-orange/[0.08] shadow-[inset_3px_0_0_var(--color-chat-orange)]' : ''
      } ${channel.hidden ? 'opacity-70' : ''}`}
    >
      <div className="flex min-w-0 items-center gap-3">
          <ChannelIcon size={38} type={channel.type} />
          <div className="min-w-0">
            <Link
              to={detailTo}
              className="block truncate text-[14px] font-semibold text-wa-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green"
            >
              {channel.name}
            </Link>
            <p className="truncate text-[12.5px] text-wa-muted">
              {formatPhone(channel.phoneNumber)}
              {channel.hidden ? ' · oculto' : ''}
            </p>
            <p className="mt-0.5 text-[11.5px] text-wa-muted">{providerLabel(channel.type)} · {official ? 'API oficial' : 'Não oficial'}</p>
          </div>
      </div>
      <div className="min-w-0 sm:pl-[50px] lg:pl-0">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-wa-muted">Conexão</p>
        <ConnectionStatus channel={channel} />
      </div>
      <div className="min-w-0 sm:col-span-2 lg:col-span-1">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-wa-muted">Atendimento</p>
        <div className="flex flex-wrap gap-1.5">
          {labels.map((label) => (
            <span
              key={label}
              data-attendance={label}
              className={`inline-flex items-center whitespace-nowrap rounded-[8px] border px-2 py-[2px] text-[12px] font-medium ${
                CHIP_TONES[label] || 'border-wa-border bg-white/[0.06] text-wa-muted'
              }`}
            >
              <span className="channel-attendance-icon" aria-hidden="true">{label === 'Humano' ? <IconUser size={13} /> : <IconSpark size={13} />}</span>{label}
            </span>
          ))}
        </div>
        {warnings.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {warnings.map((warning) => (
              <p key={warning} className="text-[12px] leading-[16px] text-wa-warn-text">
                {warning}
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="sm:col-start-2 sm:row-start-1 lg:col-start-auto lg:row-start-auto">
        <div className="flex items-center justify-start gap-2 sm:justify-end">
          <Link to={detailTo} className={SMALL_BTN}>
            <IconSettings size={15} />
            Configurar
          </Link>
          {actions && canManage && (
            <RowMenu label={`Mais ações para ${channel.name}`}>
              {channel.type === 'baileys' && (
                <button type="button" onClick={() => actions.reconnect(channel)} disabled={busy} className={MENU_ITEM}>
                  <IconRefresh size={14} /> Reconectar
                </button>
              )}
              <button type="button" onClick={() => actions.toggleHidden(channel)} disabled={busy} className={MENU_ITEM}>
                <VisibilityIcon />
                {channel.hidden ? 'Reexibir' : 'Ocultar'}
              </button>
              <button type="button" onClick={() => actions.remove(channel)} disabled={busy} className={`${MENU_ITEM} text-wa-error-text`}>
                <IconTrash size={14} /> Excluir
              </button>
            </RowMenu>
          )}
        </div>
      </div>
    </li>
  );
}

// Barra de busca/filtro + lista operacional. `extraControls` entra ao lado dos filtros
// (a lista usa para "Mostrar ocultos"). `actions` liga o menu "⋯" da linha.
export function ChannelsTable({ channels, selectedId = null, summaryContext, actions = null, canManage = false, extraControls = null, emptyMessage }) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const term = search.trim().toLowerCase();

  const visible = useMemo(
    () =>
      channels.filter((channel) => {
        if (type !== 'all' && channel.type !== type) return false;
        if (!term) return true;
        return [channel.name, channel.phoneNumber].some((field) => String(field || '').toLowerCase().includes(term));
      }),
    [channels, type, term]
  );

  return (
    <div className="settings-channel-center space-y-3">
      <div className="settings-channel-overview" aria-label="Resumo dos canais">
        <span><strong>{channels.length}</strong>Números</span>
        <span><strong>{channels.filter(c => isOfficialChannelType(c.type)).length}</strong>API oficial</span>
        <span><strong>{channels.filter(c => c.type === 'baileys').length}</strong>Baileys</span>
        <span><strong>{visible.length}</strong>Neste filtro</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label
          className={`${CONTROL} flex min-w-[220px] flex-1 items-center gap-2.5 px-3.5 focus-within:border-wa-green/60 focus-within:ring-2 focus-within:ring-wa-green/25`}
        >
          <span className="shrink-0 text-wa-muted">
            <IconSearch size={17} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome ou número"
            aria-label="Buscar por nome ou número"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-wa-muted"
          />
        </label>
        <select aria-label="Tipo de conexão" value={type} onChange={(event) => setType(event.target.value)} className={`${CONTROL} px-3 pr-8`}>
          {TYPE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {extraControls}
      </div>

      <div className="overflow-visible rounded-[16px] border border-wa-surface-line bg-wa-surface">
        <div className="flex items-center justify-between border-b border-wa-border px-4 py-2.5 text-[12.5px] text-wa-muted">
          <span>{visible.length} {visible.length === 1 ? 'canal' : 'canais'} {visible.length !== channels.length ? `de ${channels.length}` : ''}</span>
          <span>Conexão e atendimento por canal</span>
        </div>
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13.5px] text-wa-muted">
            {channels.length === 0 ? emptyMessage || 'Nenhum canal cadastrado ainda.' : 'Nenhum canal com esse filtro.'}
          </p>
        ) : (
          <ul>
            {visible.map((channel) => (
                  <ChannelRow
                    key={channel.id}
                    channel={channel}
                    selected={channel.id === selectedId}
                    summaryContext={summaryContext}
                    actions={actions}
                    canManage={canManage}
                  />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ChannelsTable;
