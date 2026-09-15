import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChannelsListPage from './ChannelsListPage';
import { renderInShell } from '../../../test-utils/renderInShell';
import { useAuth } from '../../../contexts/AuthContext';
import { useChannels } from '../../../hooks/useChannels';
import { useTriage } from '../../../hooks/useTriage';
import { useAiConfig } from '../../../hooks/useAiConfig';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useChannels');
vi.mock('../../../hooks/useTriage');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../services/api');

const baileys = { id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598900000000', status: 'connected', triageEnabled: true, aiEnabled: false };
const oficial = { id: 'ch2', type: 'meta_cloud', name: 'Suporte', phoneNumber: '+5511900000000', status: 'connected', aiEnabled: true, aiTriageEnabled: true, aiNightModeEnabled: true };

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
  useTriage.mockReturnValue({ config: {}, options: [], status: 'ready', refresh: vi.fn() });
  useAiConfig.mockReturnValue({ config: { configured: false, mode: 'disabled', nightStartTime: null, nightEndTime: null }, status: 'ready', loading: false, refresh: vi.fn() });
});

describe('ChannelsListPage', () => {
  test('lista canais com provedor, número, situação e resumo das automações', () => {
    useChannels.mockReturnValue({ channels: [baileys, oficial], status: 'ready', refresh: vi.fn() });
    renderInShell(<ChannelsListPage />, { path: '/configuracoes/canais' });
    expect(screen.getByRole('link', { name: /berg/i })).toHaveAttribute('href', '/configuracoes/canais/ch1/conexao');
    expect(screen.getByText('Oficial · API')).toBeInTheDocument();
    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.getByText('Triagem por menu ligada sem opções cadastradas')).toBeInTheDocument();
    expect(screen.getByText('IA ligada sem OpenAI configurada')).toBeInTheDocument();
    expect(screen.getByText('Noturno ligado sem janela definida')).toBeInTheDocument();
  });

  test('gerente sem a flag vê a lista mas não o botão Criar canal', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'manager', canManageIntegrations: false } });
    useChannels.mockReturnValue({ channels: [baileys], status: 'ready', refresh: vi.fn() });
    renderInShell(<ChannelsListPage />, { path: '/configuracoes/canais' });
    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /criar canal/i })).not.toBeInTheDocument();
  });

  test('"Mostrar canais ocultos" vai para a URL e pede os ocultos ao hook', async () => {
    useChannels.mockReturnValue({ channels: [], status: 'ready', refresh: vi.fn() });
    renderInShell(<ChannelsListPage />, { path: '/configuracoes/canais' });
    await userEvent.click(screen.getByRole('checkbox', { name: /mostrar canais ocultos/i }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('ocultos=1');
    expect(useChannels).toHaveBeenLastCalledWith(true, true);
  });

  test('em carregamento não mostra "nenhum canal"', () => {
    useChannels.mockReturnValue({ channels: [], status: 'loading', refresh: vi.fn() });
    renderInShell(<ChannelsListPage />, { path: '/configuracoes/canais' });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(/nenhum canal/i)).not.toBeInTheDocument();
  });
});
