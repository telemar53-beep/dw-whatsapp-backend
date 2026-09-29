import './channels-polish.css';
import { isOfficialChannelType } from '../../../utils/channelTypes';
import { STATUS_LABELS } from './channelStatus';

// Peças compartilhadas por Números conectados (CartoesDeCanais.jsx), pelo
// detalhe do canal e pelas confirmações: o estado da conexão e os nomes do
// provedor. A lista em tabela que morava aqui virou os cartões da Fatia S1.
//
// Desde a S2 o estado é só ponto e texto: sem os ícones da família antiga,
// que eram desenhados e depois escondidos por CSS.

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

// A qualidade que a Meta atribui ao número: é o aviso que vem ANTES de ela
// limitar ou bloquear o envio. UNKNOWN (número novo, sem histórico) não vira
// selo — não há o que dizer.
export const QUALIDADE = { GREEN: 'Alta', YELLOW: 'Média', RED: 'Baixa' };
const QUALITY_LABELS = { GREEN: 'Qualidade alta', YELLOW: 'Qualidade média', RED: 'Qualidade baixa' };

// O estado lido do canal, uma coisa só para o selo, a faixa do detalhe e a
// confirmação: `tom` (ok, espera, erro, neutro), o texto curto e, no oficial,
// a qualidade e o motivo que a Meta deu.
//
// Conexão: o Baileys tem handshake próprio e o status vem do banco. O oficial
// não tem — quem sabe é a Meta, e o backend pergunta a ela ao montar a lista
// (só meta_cloud; o 360dialog continua sem verificação). Sem resposta dela, o
// estado é "Não verificada", que é honesto: não sabemos.
export function estadoDoCanal(channel) {
  if (isOfficialChannelType(channel.type)) {
    const { connection } = channel;
    if (!connection || connection.state === 'unknown') return { chave: 'unknown', tom: 'neutro', texto: 'Não verificada' };
    if (connection.state === 'connected') {
      const qualidade = connection.quality;
      const reduzida = qualidade === 'YELLOW' || qualidade === 'RED';
      return { chave: 'connected', tom: reduzida ? 'espera' : 'ok', texto: 'Conectado', qualidade: QUALIDADE[qualidade] ? qualidade : null };
    }
    if (connection.state === 'disconnected') return { chave: 'disconnected', tom: 'erro', texto: 'Desconectado' };
    return { chave: 'error', tom: 'erro', texto: connection.motivo || 'Erro na conexão', motivo: connection.motivo || null };
  }
  const tons = { connected: 'ok', awaiting_qr: 'espera', disconnected: 'erro' };
  return { chave: channel.status, tom: tons[channel.status] || 'neutro', texto: STATUS_LABELS[channel.status] || channel.status };
}

// Selo de estado: ponto na cor do tom e o texto. No detalhe, o oficial
// conectado leva também a qualidade que a Meta informou (`comQualidade`).
export function ConnectionStatus({ channel, comQualidade = false }) {
  const estado = estadoDoCanal(channel);
  return (
    <span className="channel-connection" data-connection={estado.chave} data-tom={estado.tom} title={estado.motivo || undefined}>
      <span aria-hidden="true" className="channel-status-dot" />
      <span className="channel-connection-reason">{estado.texto}</span>
      {comQualidade && estado.qualidade && (
        <span className="channel-quality-chip" data-qualidade={estado.qualidade}>{QUALITY_LABELS[estado.qualidade]}</span>
      )}
    </span>
  );
}
