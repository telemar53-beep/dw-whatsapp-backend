import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChannelStatusBanner from './ChannelStatusBanner';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useChannels');

beforeEach(() => {
  vi.clearAllMocks();
});

function renderBanner() {
  return render(
    <MemoryRouter>
      <ChannelStatusBanner />
    </MemoryRouter>
  );
}

describe('ChannelStatusBanner', () => {
  test('renders nothing for a non-admin agent', () => {
    useAuth.mockReturnValue({ agent: { role: 'agent' } });
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }], loading: false });
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing for an admin when every channel is connected', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg', status: 'connected' }], loading: false });
    const { container } = renderBanner();
    // Nada a avisar: só a região viva vazia, sempre montada para o leitor de tela.
    expect(container.textContent).toBe('');
  });

  test('warns an admin about a disconnected channel', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }],
      loading: false,
    });
    renderBanner();
    expect(screen.getByText(/Berg/)).toBeInTheDocument();
    expect(screen.getByText(/desconectado/i)).toBeInTheDocument();
  });

  // AdminChannelsPage (e o link "administração de canais") se aposentaram na
  // Task 17: a tela de canais agora mora em Configurações.
  test('o link leva ao próprio canal e diz a ação', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }],
      loading: false,
    });
    renderBanner();
    const link = screen.getByRole('link', { name: 'Conectar' });
    expect(link).toHaveAttribute('href', '/configuracoes/canais/ch1');
  });

  test('warns an admin about a channel awaiting QR', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', status: 'awaiting_qr' }],
      loading: false,
    });
    renderBanner();
    expect(screen.getByText(/QR/)).toBeInTheDocument();
  });

  test('nunca avisa sobre um canal oficial, qualquer que seja o status guardado', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({
      channels: [
        { id: 'ch1', type: 'meta_cloud', name: 'Oficial Meta', status: 'disconnected' },
        { id: 'ch2', type: '360dialog', name: 'Oficial BSP', status: 'disconnected' },
      ],
      loading: false,
    });
    const { container } = renderBanner();
    // Nada a avisar: só a região viva vazia, sempre montada para o leitor de tela.
    expect(container.textContent).toBe('');
  });

  test('ainda avisa sobre um canal baileys desconectado', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', type: 'baileys', name: 'Berg', status: 'disconnected' }],
      loading: false,
    });
    renderBanner();
    expect(screen.getByText(/Berg/)).toBeInTheDocument();
    expect(screen.getByText(/desconectado/i)).toBeInTheDocument();
  });

  test('warns a manager with canManageIntegrations about a disconnected channel', () => {
    useAuth.mockReturnValue({ agent: { role: 'manager', canManageIntegrations: true } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }],
      loading: false,
    });
    renderBanner();
    expect(screen.getByText(/Berg/)).toBeInTheDocument();
    expect(screen.getByText(/desconectado/i)).toBeInTheDocument();
  });

  test('renders nothing for a manager without canManageIntegrations', () => {
    useAuth.mockReturnValue({ agent: { role: 'manager', canManageIntegrations: false } });
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }],
      loading: false,
    });
    const { container } = renderBanner();
    // Nada a avisar: só a região viva vazia, sempre montada para o leitor de tela.
    expect(container.textContent).toBe('');
  });
});

describe('ChannelStatusBanner: erro, leitor de tela e atualização no turno', () => {
  test('falha ao buscar os canais não parece "tudo conectado": diz e oferece "Tentar de novo"', async () => {
    const refresh = vi.fn();
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({ channels: [], status: 'error', loading: false, refresh });
    renderBanner();
    expect(screen.getByText(/Não foi possível conferir os canais/)).toBeInTheDocument();
    screen.getByRole('button', { name: 'Tentar de novo' }).click();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('o aviso mora numa região viva sempre montada', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg', status: 'disconnected' }], status: 'ready', loading: false, refresh: vi.fn() });
    const { container } = renderBanner();
    const regiao = container.querySelector('[aria-live="polite"]');
    expect(regiao).not.toHaveAttribute('role');
    expect(regiao).toHaveTextContent('Berg');
  });

  test('busca de novo quando a aba volta a ficar visível', () => {
    const refresh = vi.fn();
    useAuth.mockReturnValue({ agent: { role: 'admin' } });
    useChannels.mockReturnValue({ channels: [], status: 'ready', loading: false, refresh });
    renderBanner();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
