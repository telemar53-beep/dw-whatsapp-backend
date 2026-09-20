import metaLogo from '../../../assets/brands/meta.svg';
import { IconPlug, IconChats } from '../../../components/icons/WaIcons';

// Meta uses its brand mark. Baileys and 360dialog use functional symbols,
// not fabricated brand logos; their provider names remain visible in the row.
export function ProviderMark({ type }) {
  if (type === 'meta_cloud') return <span className="channel-brand-mark" style={{ maskImage: `url(${metaLogo})` }} />;
  if (type === 'baileys') return <IconPlug size={18} />;
  return <IconChats size={18} />;
}

export function QrStatusIcon() {
  return <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 2h6v6H2zM12 2h6v6h-6zM2 12h6v6H2zM12 12h2v2h-2zM17 12v3h-3v3M17 18h1" /></svg>;
}

export function VisibilityIcon() {
  return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2"/></svg>;
}
