import dialog360Logo from '../../../assets/brands/360dialog.svg';
import { IconServer } from '../../../components/icons/WaIcons';

// Os caminhos abaixo sao os DOS ARQUIVOS em `assets/brands/` (Simple Icons
// 16.0.0, colecao CC0) — copiados, nao redesenhados. Os .svg continuam no
// repositorio como fonte e procedencia; ver o README de la.
//
// Por que inline, e nao mais `mask-image`: em producao o Vite inlineia o SVG
// como data URI e troca as aspas dos atributos por ASPAS SIMPLES CRUAS
// (`role='img'`). Um `'` cru e proibido dentro de um `url()` sem aspas pela
// gramatica do CSS — o token fica invalido, a declaracao inteira e descartada e
// `mask-image` computa `none`. Sobrava so o `background-color`, e a marca virava
// um QUADRADO. No dev o valor e um caminho sem aspas, por isso so quebrava
// depois de publicado. Medido: `maskImage=NONE` no build de producao contra
// `url(...)` no dev server. SVG inline nao depende de url(), de encoding do
// bundler nem de suporte a mask.
function MarcaWhatsApp(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

function MarcaMeta(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z" />
    </svg>
  );
}

// A identidade principal dos tres canais e o WHATSAPP, porque e o que o canal
// E: o atendente reconhece primeiro o WhatsApp e so depois COMO aquele numero
// esta conectado. O provedor entra como SELO secundario, menor, num canto.
// Baileys nao tem selo: nao existe logotipo proprio, e quem diz que a conexao
// nao e oficial e o texto obrigatorio ao lado.
//
// A 360dialog continua como <img> na cor publicada pela propria empresa: a
// marca dela e um badge com o wordmark "360D" vazado, e recolorir logotipo de
// terceiro nao e opcao.
export function ProviderMark({ type }) {
  const selos = {
    meta_cloud: <MarcaMeta className="channel-brand-badge" />,
    '360dialog': <img src={dialog360Logo} alt="" className="channel-brand-badge is-logo" />,
    baileys: null,
  };
  if (!(type in selos)) {
    // Tipo desconhecido: simbolo funcional, como sempre foi. Sem imitar marca.
    return <IconServer size={18} />;
  }
  return (
    <span className="channel-brand">
      <MarcaWhatsApp className="channel-brand-mark" />
      {selos[type]}
    </span>
  );
}

export function QrStatusIcon() {
  return <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M2 2h6v6H2zM12 2h6v6h-6zM2 12h6v6H2zM12 12h2v2h-2zM17 12v3h-3v3M17 18h1" /></svg>;
}

export function VisibilityIcon() {
  return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2"/></svg>;
}
