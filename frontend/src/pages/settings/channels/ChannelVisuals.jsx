import metaLogo from '../../../assets/brands/meta.svg';
import whatsappLogo from '../../../assets/brands/whatsapp.svg';
import dialog360Logo from '../../../assets/brands/360dialog.svg';
import { IconServer } from '../../../components/icons/WaIcons';

// A identidade principal dos tres canais e o WHATSAPP, porque e o que o canal
// E: o atendente precisa reconhecer primeiro o WhatsApp e so depois COMO aquele
// numero esta conectado. Antes, Meta Cloud mostrava so a marca da Meta e a
// 360dialog so o badge dela — a marca do provedor ocupava o lugar do canal.
//
// O provedor volta como SELO secundario, num canto, sem competir com a marca
// principal. Baileys nao tem selo: nao existe logotipo proprio, e quem diz que
// a conexao nao e oficial e o texto obrigatorio ao lado ("Baileys · Nao
// oficial"), que continua onde estava.
//
// Meta e WhatsApp sao glifos monocromaticos de path unico (Simple Icons 16.0.0,
// colecao CC0) e por isso entram por `mask` com `currentColor` — e o uso certo
// para esse tipo de glifo.
//
// A 360dialog e o unico que NAO usa mask, de proposito: a marca dela e um BADGE
// de app com o wordmark "360D" vazado, e a empresa distribui so tres cores
// (Black, White, Perf Green). Pintar esse badge com `currentColor` seria
// recolorir logotipo de terceiro. Entra como <img>, na cor publicada pela
// propria empresa, sem modificacao. Ver o README de assets/brands.
export function ProviderMark({ type }) {
  const provedores = {
    meta_cloud: <span className="channel-brand-badge" style={{ maskImage: `url(${metaLogo})` }} />,
    '360dialog': <img src={dialog360Logo} alt="" className="channel-brand-badge is-logo" />,
    baileys: null,
  };
  if (!(type in provedores)) {
    // Tipo desconhecido: simbolo funcional, como sempre foi. Sem imitar marca.
    return <IconServer size={18} />;
  }
  return (
    <span className="channel-brand">
      <span className="channel-brand-mark" style={{ maskImage: `url(${whatsappLogo})` }} />
      {provedores[type]}
    </span>
  );
}

export function QrStatusIcon() {
  return <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M2 2h6v6H2zM12 2h6v6h-6zM2 12h6v6H2zM12 12h2v2h-2zM17 12v3h-3v3M17 18h1" /></svg>;
}

export function VisibilityIcon() {
  return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2"/></svg>;
}
