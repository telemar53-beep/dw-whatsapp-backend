import { SettingsIcon } from '../SettingsVisuals';
import { ProviderMark, QrStatusIcon } from './ChannelVisuals';
import './channels-polish.css';
import { IconClock, IconCheckCircle, IconWarning } from '../../../components/icons/WaIcons';
import { isOfficialChannelType } from '../../../utils/channelTypes';
import { STATUS_LABELS } from './channelStatus';

// Peças compartilhadas por Números conectados (CartoesDeCanais.jsx) e pelo
// detalhe do canal: o estado da conexão, o símbolo e os nomes do provedor. A
// lista em tabela que morava aqui virou os cartões da Fatia S1.

const PROVIDER_LABELS = { baileys: 'Baileys', meta_cloud: 'Meta Cloud', '360dialog': '360dialog' };
// Como a conexao e feita, dito por extenso. A 360dialog e BSP: oficial, mas
// intermediada — "API oficial" apagava essa diferenca, que e justamente o que
// o segundo nivel da linha existe para dizer.
const CONEXAO_LABELS = { baileys: 'Não oficial', meta_cloud: 'API oficial', '360dialog': 'BSP oficial' };
export function conexaoLabel(type) {
  return CONEXAO_LABELS[type] || (isOfficialChannelType(type) ? 'API oficial' : 'Não oficial');
}
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
          <span aria-hidden="true" className="channel-status-dot h-2 w-2 rounded-full bg-wa-chip-text" />
          Conectado
          {quality && (
            <span className={`channel-quality-chip rounded-full border px-2 py-0.5 text-[12px] font-medium ${QUALITY_TONES[connection.quality]}`}>
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
        <span aria-hidden="true" className="channel-status-dot h-2 w-2 shrink-0 rounded-full bg-wa-error-text" />
        <span className="channel-connection-reason max-w-[22ch] truncate">{motivo}</span>
      </span>
    );
  }
  const color =
    channel.status === 'connected' ? 'bg-wa-chip-text' : channel.status === 'awaiting_qr' ? 'bg-wa-warn-text' : 'bg-wa-error-text';
  return (
    <span data-connection={channel.status} className="channel-connection inline-flex max-w-full items-center gap-2 text-[13.5px] text-wa-text">
      <span className="channel-status-icon" aria-hidden="true">{channel.status === 'connected' ? <IconCheckCircle size={13} /> : channel.status === 'awaiting_qr' ? <QrStatusIcon /> : <IconWarning size={13} />}</span>
      <span aria-hidden="true" className={`channel-status-dot h-2 w-2 shrink-0 rounded-full ${color}`} />
      <span className="min-w-0 leading-[18px]">{STATUS_LABELS[channel.status] || channel.status}</span>
    </span>
  );
}
