import metaLogo from '../../../assets/brands/meta.svg';
import whatsappLogo from '../../../assets/brands/whatsapp.svg';
import { IconServer } from '../../../components/icons/WaIcons';

// Onde existe marca real no repositorio, a marca vem no lugar de glifo
// funcional. As duas sao do Simple Icons 16.0.0 (colecao CC0) e ja estavam em
// `assets/brands/` — ver o README de lá.
//
// Baileys usa a marca do WHATSAPP porque e o que o canal e de fato: uma sessao
// de WhatsApp pareada por QR. O `whatsapp.svg` estava no repositorio e era usado
// so no titulo da pagina de Canais; a linha do canal ficava com IconDevice, um
// celular generico. Quem diz que NAO e a API oficial e o texto ao lado
// ("Baileys · Nao oficial" na tabela, "Baileys (nao oficial)" no modal) — esse
// texto e obrigatorio e nao sai.
//
// 360dialog continua com simbolo FUNCIONAL: nao existe logotipo dela neste
// repositorio nem em nenhum commit do historico, e inventar ou imitar um seria
// pior que nao ter. O nome do provedor continua visivel na linha.
export function ProviderMark({ type }) {
  if (type === 'meta_cloud') return <span className="channel-brand-mark" style={{ maskImage: `url(${metaLogo})` }} />;
  if (type === 'baileys') return <span className="channel-brand-mark" style={{ maskImage: `url(${whatsappLogo})` }} />;
  return <IconServer size={18} />;
}

export function QrStatusIcon() {
  return <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M2 2h6v6H2zM12 2h6v6h-6zM2 12h6v6H2zM12 12h2v2h-2zM17 12v3h-3v3M17 18h1" /></svg>;
}

export function VisibilityIcon() {
  return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2"/></svg>;
}
