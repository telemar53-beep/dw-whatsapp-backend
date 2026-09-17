import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { IconSearch, IconChats, IconSettings, IconMore, IconClock } from '../../../components/icons/WaIcons';
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
// Os nomes curtos da coluna Atendimento; o resumo continua sendo a fonte.
const CHIP_LABELS = { IA: 'IA ativa' };
const CHIP_TONES = {
  'IA ativa': 'border-wa-chip-text/30 bg-wa-chip text-wa-chip-text',
  'Triagem IA': 'border-sgp-blue/30 bg-sgp-blue/10 text-sgp-blue',
  Humano: 'border-wa-warn-text/30 bg-wa-warn-bg text-wa-warn-text',
};

// Escala de raio da seção: cartão 16 > controle 12 > botão de linha 10 > item de menu 8.
const CELL = 'px-3 py-3 align-middle';
const HEAD = 'px-3 py-2.5 text-left text-[12.5px] font-medium text-wa-muted';
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

export function ChannelIcon({ size = 36 }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-[#25d366] text-white"
    >
      <IconChats size={Math.round(size * 0.55)} />
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
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13.5px] text-wa-muted">
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
        <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13.5px] text-wa-text">
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
      <span className="inline-flex items-center gap-2 text-[13.5px] text-wa-text" title={motivo}>
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-wa-error-text" />
        <span className="max-w-[22ch] truncate">{motivo}</span>
      </span>
    );
  }
  const color =
    channel.status === 'connected' ? 'bg-wa-chip-text' : channel.status === 'awaiting_qr' ? 'bg-wa-warn-text' : 'bg-wa-error-text';
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13.5px] text-wa-text">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${color}`} />
      {STATUS_LABELS[channel.status] || channel.status}
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
          className="absolute right-0 top-[calc(100%+4px)] z-20 min-w-[180px] rounded-[12px] border border-wa-border bg-wa-panel p-1 shadow-[var(--wa-dialog-shadow)]"
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
    <tr
      aria-selected={selected}
      className={`border-t border-wa-border ${
        selected ? 'bg-chat-orange/[0.08] shadow-[inset_3px_0_0_var(--color-chat-orange)]' : ''
      } ${channel.hidden ? 'opacity-70' : ''}`}
    >
      <td className={CELL}>
        <div className="flex items-center gap-3">
          <ChannelIcon />
          <div className="min-w-0">
            <Link
              to={detailTo}
              className="block max-w-[220px] truncate text-[14px] font-medium text-wa-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green"
            >
              {channel.name}
            </Link>
            <p className="truncate text-[12.5px] text-wa-muted">
              {formatPhone(channel.phoneNumber)}
              {channel.hidden ? ' · oculto' : ''}
            </p>
          </div>
        </div>
      </td>
      <td className={`${CELL} whitespace-nowrap`}>
        <span className="inline-flex items-center rounded-[8px] border border-wa-border bg-white/[0.06] px-2 py-[2px] text-[12.5px] font-medium text-wa-text">
          {providerLabel(channel.type)}
        </span>
        <p className="mt-1 text-[12px] text-wa-muted">{official ? 'API oficial' : 'Não oficial'}</p>
      </td>
      <td className={`${CELL} whitespace-nowrap`}>
        <ConnectionStatus channel={channel} />
      </td>
      <td className={CELL}>
        <div className="flex flex-wrap gap-1.5">
          {labels.map((label) => (
            <span
              key={label}
              className={`inline-flex items-center whitespace-nowrap rounded-[8px] border px-2 py-[2px] text-[12px] font-medium ${
                CHIP_TONES[label] || 'border-wa-border bg-white/[0.06] text-wa-muted'
              }`}
            >
              {label}
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
      </td>
      <td className={`${CELL} whitespace-nowrap`}>
        <div className="flex items-center justify-end gap-2">
          <Link to={detailTo} className={SMALL_BTN}>
            <IconSettings size={15} />
            Configurar
          </Link>
          {actions && canManage && (
            <RowMenu label={`Mais ações para ${channel.name}`}>
              {channel.type === 'baileys' && (
                <button type="button" onClick={() => actions.reconnect(channel)} disabled={busy} className={MENU_ITEM}>
                  Reconectar
                </button>
              )}
              <button type="button" onClick={() => actions.toggleHidden(channel)} disabled={busy} className={MENU_ITEM}>
                {channel.hidden ? 'Reexibir' : 'Ocultar'}
              </button>
              <button type="button" onClick={() => actions.remove(channel)} disabled={busy} className={`${MENU_ITEM} text-wa-error-text`}>
                Excluir
              </button>
            </RowMenu>
          )}
        </div>
      </td>
    </tr>
  );
}

// Barra de busca/filtro + tabela. `extraControls` entra ao lado dos filtros
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
    <div className="space-y-4">
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

      <div className="overflow-clip rounded-[16px] border border-wa-surface-line bg-wa-surface backdrop-blur-xl">
        <div className="chat-scroll overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[13.5px]">
            <thead>
              <tr className="bg-black/[0.16]">
                <th scope="col" className={HEAD}>
                  Canal
                </th>
                <th scope="col" className={HEAD}>
                  Tipo de conexão
                </th>
                <th scope="col" className={HEAD}>
                  Conexão
                </th>
                <th scope="col" className={HEAD}>
                  Atendimento
                </th>
                <th scope="col" className={`${HEAD} text-right`}>
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr className="border-t border-wa-border">
                  <td colSpan={5} className="px-3 py-6 text-center text-[13.5px] text-wa-muted">
                    {channels.length === 0 ? emptyMessage || 'Nenhum canal cadastrado ainda.' : 'Nenhum canal com esse filtro.'}
                  </td>
                </tr>
              ) : (
                visible.map((channel) => (
                  <ChannelRow
                    key={channel.id}
                    channel={channel}
                    selected={channel.id === selectedId}
                    summaryContext={summaryContext}
                    actions={actions}
                    canManage={canManage}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default ChannelsTable;
