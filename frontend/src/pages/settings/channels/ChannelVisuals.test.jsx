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

  // Não existe logotipo da 360dialog neste repositório nem em nenhum commit do
  // histórico. Inventar ou imitar um seria pior que não ter, então ela continua
  // com símbolo funcional e o nome do provedor visível na linha.
  test('360dialog continua com símbolo funcional, sem marca inventada', () => {
    const { container } = render(<ProviderMark type="360dialog" />);
    expect(container.querySelector('.channel-brand-mark')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
