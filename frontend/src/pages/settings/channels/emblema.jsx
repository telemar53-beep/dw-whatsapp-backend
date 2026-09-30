import './emblema.css';
import { isOfficialChannelType } from '../../../utils/channelTypes';

// O tipo do canal dito em letras, sem marca de terceiro (S1, mantido na S2):
// API é a da Meta, BSP é a da 360dialog e BL é o Baileys (não oficial). O
// mesmo emblema nos cartões, no detalhe, no Adicionar canal e nas
// confirmações: um canal, uma identidade.
const SIGLAS = { meta_cloud: 'API', '360dialog': 'BSP', baileys: 'BL' };

export function siglaDoTipo(type) {
  return SIGLAS[type] || String(type || '?').slice(0, 3).toUpperCase();
}

export function EmblemaDoCanal({ type, className = '' }) {
  const oficial = isOfficialChannelType(type);
  return (
    <span className={`cfg-emblema ${oficial ? '' : 'is-nao-oficial'} ${className}`.trim()} aria-hidden="true">
      {siglaDoTipo(type)}
    </span>
  );
}
