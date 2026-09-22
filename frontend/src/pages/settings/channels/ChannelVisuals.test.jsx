import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProviderMark } from './ChannelVisuals';

// A identidade principal dos tres canais e o WhatsApp — e o que o canal E. O
// provedor (Meta, 360dialog) diz COMO o numero esta conectado e entra como selo
// secundario. Antes, Meta Cloud mostrava so a marca da Meta e a 360dialog so o
// badge dela: a marca do provedor ocupava o lugar do canal.
describe('ProviderMark: WhatsApp e a identidade, o provedor e o selo', () => {
  function renderMarca(type) {
    return render(<ProviderMark type={type} />).container;
  }

  test.each(['baileys', 'meta_cloud', '360dialog'])('%s tem a marca do WhatsApp como principal', (type) => {
    const marca = renderMarca(type).querySelector('.channel-brand-mark');
    expect(marca).not.toBeNull();
    expect(marca.style.maskImage).toMatch(/whatsapp/);
  });

  test('Meta Cloud traz a Meta como selo secundario, nao como marca principal', () => {
    const selo = renderMarca('meta_cloud').querySelector('.channel-brand-badge');
    expect(selo).not.toBeNull();
    expect(selo.style.maskImage).toMatch(/meta/);
  });

  // A 360dialog usa a marca oficial da propria empresa, mas por <img> e nao por
  // mask: o logotipo dela e um badge com o wordmark "360D" vazado e a empresa
  // publica so tres cores. Pintar de roxo com `currentColor` seria recolorir
  // logotipo de terceiro. Entra na cor publicada, sem modificacao.
  test('360dialog traz a marca oficial como selo, sem recolorir', () => {
    const selo = renderMarca('360dialog').querySelector('img.channel-brand-badge');
    expect(selo).not.toBeNull();
    expect(selo.getAttribute('src')).toMatch(/360dialog/);
    expect(selo.style.maskImage).toBe('');
  });

  // Baileys nao tem logotipo proprio: quem diz que a conexao nao e oficial e o
  // texto ao lado, que vive na tabela e no modal.
  test('Baileys nao ganha selo de provedor', () => {
    expect(renderMarca('baileys').querySelector('.channel-brand-badge')).toBeNull();
  });

  test('decorativa: a imagem nao entra na arvore de acessibilidade com texto', () => {
    expect(renderMarca('360dialog').querySelector('img').getAttribute('alt')).toBe('');
  });

  // Tipo desconhecido continua caindo no simbolo funcional de sempre.
  test('tipo desconhecido continua com simbolo funcional', () => {
    const c = renderMarca('outro');
    expect(c.querySelector('.channel-brand-mark')).toBeNull();
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('svg')).not.toBeNull();
  });
});
