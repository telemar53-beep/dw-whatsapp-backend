import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProviderMark } from './ChannelVisuals';

// Onde existe marca real no repositório, a marca vem no lugar de glifo
// funcional — e onde NÃO existe, continua glifo, sem imitação. O Baileys ficava
// com um celular genérico (`IconDevice`) enquanto o `whatsapp.svg` estava no
// repositório sendo usado só no título da página.
describe('ProviderMark: identidade por provedor', () => {
  function marcaDe(type) {
    const { container } = render(<ProviderMark type={type} />);
    return container.querySelector('.channel-brand-mark');
  }

  test('Baileys usa a marca do WhatsApp', () => {
    const marca = marcaDe('baileys');
    expect(marca).not.toBeNull();
    expect(marca.style.maskImage).toMatch(/whatsapp/);
  });

  test('Meta Cloud usa a marca da Meta', () => {
    const marca = marcaDe('meta_cloud');
    expect(marca).not.toBeNull();
    expect(marca.style.maskImage).toMatch(/meta/);
  });

  test('Baileys e Meta Cloud não compartilham o mesmo asset', () => {
    expect(marcaDe('baileys').style.maskImage).not.toBe(marcaDe('meta_cloud').style.maskImage);
  });

  // A 360dialog usa a marca oficial da própria empresa, mas por <img> e não por
  // mask: o logotipo dela é um badge com o wordmark "360D" vazado e a empresa
  // publica só três cores. Pintar de roxo com `currentColor` seria recolorir
  // logotipo de terceiro. Entra na cor publicada, sem modificação.
  test('360dialog usa a marca oficial como imagem, sem recolorir', () => {
    const { container } = render(<ProviderMark type="360dialog" />);
    const logo = container.querySelector('img.channel-brand-logo');
    expect(logo).not.toBeNull();
    expect(logo.getAttribute('src')).toMatch(/360dialog/);
    // nada de mask aqui: mask pinta em currentColor e recoloriria a marca
    expect(container.querySelector('.channel-brand-mark')).toBeNull();
  });

  test('decorativa: a imagem não entra na árvore de acessibilidade com texto', () => {
    const { container } = render(<ProviderMark type="360dialog" />);
    expect(container.querySelector('img').getAttribute('alt')).toBe('');
  });

  // Tipo desconhecido continua caindo no símbolo funcional de sempre.
  test('tipo desconhecido continua com símbolo funcional', () => {
    const { container } = render(<ProviderMark type="outro" />);
    expect(container.querySelector('.channel-brand-mark')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
