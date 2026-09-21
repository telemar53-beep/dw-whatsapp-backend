import metaLogo from '../../../assets/brands/meta.svg';
import { IconDevice, IconServer } from '../../../components/icons/WaIcons';

// Meta usa a marca oficial. Baileys e 360dialog usam simbolos FUNCIONAIS —
// nao existe logotipo confiavel para reproduzir, e inventar um seria pior que
// nao ter. O nome do provedor continua visivel na linha.
//
// Cada simbolo diz COMO o canal conecta: o Baileys pareia um aparelho lendo
// um QR; a 360dialog e um gateway hospedado. Antes o Baileys usava IconPlug,
// o mesmo glifo do grupo Integracoes, e a 360dialog usava IconChats, o mesmo
// do menu Atendimento.
export function ProviderMark({ type }) {
  if (type === 'meta_cloud') return <span className="channel-brand-mark" style={{ maskImage: `url(${metaLogo})` }} />;
  if (type === 'baileys') return <IconDevice size={18} />;
  return <IconServer size={18} />;
}

export function QrStatusIcon() {
  return <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M2 2h6v6H2zM12 2h6v6h-6zM2 12h6v6H2zM12 12h2v2h-2zM17 12v3h-3v3M17 18h1" /></svg>;
}

export function VisibilityIcon() {
  return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2"/></svg>;
}
