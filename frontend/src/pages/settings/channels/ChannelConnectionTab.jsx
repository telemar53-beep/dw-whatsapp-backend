import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button, DangerZone, Field, inputClass } from '../../../components/ui';
import QrCodeView from '../../../components/QrCodeView';
import { isOfficialChannelType } from '../../../utils/channelTypes';

// Movidos de AdminChannelsPage.jsx (Tasks 1-16), sem mudança de lógica:
// canal oficial (meta_cloud/360dialog) não tem conexão para cair — quem
// responde é a API da Meta/BSP — então o selo mostra o que ele é em vez de
// um "Conectado/Desconectado" que ninguém atualiza.
export const STATUS_LABELS = {
  connected: 'Conectado',
  awaiting_qr: 'Aguardando QR code',
  disconnected: 'Desconectado',
};

export function StatusDot({ status, type }) {
  const official = isOfficialChannelType(type);
  const color =
    official || status === 'connected'
      ? 'bg-wa-chip-text'
      : status === 'awaiting_qr'
        ? 'bg-wa-warn-text'
        : 'bg-wa-border-strong';
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-wa-border bg-wa-surface-soft px-2.5 py-[3px] text-[12.5px] font-medium text-wa-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} aria-hidden="true" />
      {official ? 'Oficial · API' : STATUS_LABELS[status] || status}
    </span>
  );
}

const PERMISSION_REASON = 'Requer permissão de Canais e Integrações';

function ErrorNote({ children }) {
  if (!children) return null;
  return <p className="rounded-[12px] bg-wa-error-bg px-3 py-2.5 text-[13.5px] text-wa-error-text">{children}</p>;
}

function ChannelConnectionTab() {
  const { channel, refresh, actions, canManage } = useOutletContext();
  const [wabaIdDraft, setWabaIdDraft] = useState(channel.wabaId || '');

  // Trocar de canal (mesma aba, id novo na URL) não remonta o componente —
  // sincroniza o rascunho com o canal atual em vez de arrastar o valor do
  // canal anterior.
  useEffect(() => {
    setWabaIdDraft(channel.wabaId || '');
  }, [channel.id, channel.wabaId]);

  const busy = actions.busyChannelId === channel.id;

  return (
    <div className="space-y-6">
      {!canManage && (
        <p className="rounded-[12px] bg-wa-warn-bg px-3 py-2.5 text-[13.5px] text-wa-warn-text">{PERMISSION_REASON}</p>
      )}

      <StatusDot status={channel.status} type={channel.type} />

      <ErrorNote>{actions.errors.wabaId}</ErrorNote>
      <ErrorNote>{actions.errors.action}</ErrorNote>

      {isOfficialChannelType(channel.type) && (
        <div className="flex flex-wrap items-end gap-2">
          <Field id="waba-id" label="WABA ID">
            <input
              id="waba-id"
              value={wabaIdDraft}
              disabled={!canManage}
              onChange={(e) => setWabaIdDraft(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Button
            onClick={() => actions.saveWabaId(channel.id, wabaIdDraft)}
            disabled={!canManage}
            title={!canManage ? PERMISSION_REASON : undefined}
          >
            Salvar WABA ID
          </Button>
        </div>
      )}

      <QrCodeView channel={channel} onRefresh={refresh} />

      <DangerZone>
        {channel.type === 'baileys' && (
          <Button
            variant="secondary"
            onClick={() => actions.reconnect(channel)}
            disabled={!canManage || busy}
            title={!canManage ? PERMISSION_REASON : undefined}
          >
            Reconectar
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => actions.toggleHidden(channel)}
          disabled={!canManage || busy}
          title={!canManage ? PERMISSION_REASON : undefined}
        >
          {channel.hidden ? 'Reexibir' : 'Ocultar'}
        </Button>
        <Button
          variant="danger"
          onClick={() => actions.remove(channel)}
          disabled={!canManage || busy}
          title={!canManage ? PERMISSION_REASON : undefined}
        >
          Excluir
        </Button>
      </DangerZone>
    </div>
  );
}

export default ChannelConnectionTab;
