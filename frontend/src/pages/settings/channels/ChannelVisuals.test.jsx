import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProviderMark } from './ChannelVisuals';

// A identidade principal dos tres canais e o WhatsApp — e o que o canal E. O
// provedor (Meta, 360dialog) diz COMO o numero esta conectado e entra como selo
// secundario, menor.
//
// As marcas sao SVG INLINE. Antes eram `mask-image` com o asset inlineado pelo
// bundler, e em producao isso QUEBRAVA: o Vite troca as aspas dos atributos do
// SVG por aspas simples cruas, que sao proibidas dentro de um `url()` sem
// aspas, entao a declaracao era descartada, `mask-image` computava `none` e
// sobrava o `background-color` — a marca virava um quadrado. Estes testes
// travam o mecanismo novo para nao voltarmos a depender de url()/mask.
describe('ProviderMark: WhatsApp e a identidade, o provedor e o selo', () => {
  function marcas(type) {
    const c = render(<ProviderMark type={type} />).container;
    return {
      raiz: c,
      marca: c.querySelector('.channel-brand-mark'),
      selo: c.querySelector('.channel-brand-badge'),
    };
  }

  test.each(['baileys', 'meta_cloud', '360dialog'])('%s desenha a marca do WhatsApp como SVG inline', (type) => {
    const { marca } = marcas(type);
    expect(marca).not.toBeNull();
    expect(marca.tagName.toLowerCase()).toBe('svg');
    // O path do WhatsApp comeca em M17.472 14.382 no asset oficial.
    expect(marca.querySelector('path').getAttribute('d')).toMatch(/^M17\.472 14\.382/);
  });

  // A regressao que motivou a troca: nada de url()/mask, que e o que sumia no
  // build de producao.
  test.each(['baileys', 'meta_cloud', '360dialog'])('%s nao depende de mask nem de url()', (type) => {
    const { marca } = marcas(type);
    expect(marca.style.maskImage).toBe('');
    expect(marca.style.webkitMaskImage || '').toBe('');
  });

  test('Meta Cloud traz a Meta como selo secundario, tambem inline', () => {
    const { selo } = marcas('meta_cloud');
    expect(selo).not.toBeNull();
    expect(selo.tagName.toLowerCase()).toBe('svg');
    expect(selo.querySelector('path').getAttribute('d')).toMatch(/^M6\.915 4\.03/);
  });

  // A 360dialog usa a marca oficial da propria empresa como <img>: o logotipo
  // dela e um badge com o wordmark "360D" vazado e a empresa publica so tres
  // cores. Recolorir logotipo de terceiro nao e opcao.
  test('360dialog traz a marca oficial como selo <img>, sem recolorir', () => {
    const { selo } = marcas('360dialog');
    expect(selo).not.toBeNull();
    expect(selo.tagName.toLowerCase()).toBe('img');
    expect(selo.getAttribute('src')).toMatch(/360dialog/);
    expect(selo.getAttribute('alt')).toBe('');
  });

  // Baileys nao tem logotipo proprio: quem diz que a conexao nao e oficial e o
  // texto ao lado, que vive na tabela e no modal.
  test('Baileys nao ganha selo de provedor', () => {
    expect(marcas('baileys').selo).toBeNull();
  });

  // Tipo desconhecido continua caindo no simbolo funcional de sempre.
  test('tipo desconhecido continua com simbolo funcional', () => {
    const { raiz, marca, selo } = marcas('outro');
    expect(marca).toBeNull();
    expect(selo).toBeNull();
    expect(raiz.querySelector('svg')).not.toBeNull();
  });
});
