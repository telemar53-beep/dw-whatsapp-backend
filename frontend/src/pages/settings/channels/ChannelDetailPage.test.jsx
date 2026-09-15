import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ChannelDetailPage from './ChannelDetailPage';
import ChannelConnectionTab from './ChannelConnectionTab';
import ChannelBehaviorTab from './ChannelBehaviorTab';
import { useAuth } from '../../../contexts/AuthContext';
import { useChannels } from '../../../hooks/useChannels';
import { useTriage } from '../../../hooks/useTriage';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useBusinessHoursConfig } from '../../../hooks/useBusinessHoursConfig';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useChannels');
vi.mock('../../../hooks/useTriage');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../hooks/useBusinessHoursConfig');
vi.mock('../../../services/api');

const refresh = vi.fn();
const berg = { id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598900000000', status: 'awaiting_qr', triageEnabled: false, aiEnabled: true, aiTriageEnabled: false, aiNightModeEnabled: false, welcomeMessage: null };

function renderDetail(path, agent = { role: 'admin' }) {
  useAuth.mockReturnValue({ token: 'tok', agent });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/configuracoes/canais/:id" element={<ChannelDetailPage />}>
          <Route path="conexao" element={<ChannelConnectionTab />} />
          <Route path="atendimento" element={<ChannelBehaviorTab />} />
        </Route>
        <Route path="/configuracoes/canais" element={<p>lista de canais</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useChannels.mockReturnValue({ channels: [berg], status: 'ready', refresh });
  useTriage.mockReturnValue({ config: {}, options: [{ id: 'o1' }], status: 'ready', refresh: vi.fn() });
  useAiConfig.mockReturnValue({ config: { configured: true, mode: 'assistant', model: 'gpt', nightStartTime: null, nightEndTime: null }, status: 'ready', loading: false, refresh: vi.fn() });
  useBusinessHoursConfig.mockReturnValue({ config: { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' }, status: 'ready', refresh: vi.fn() });
  api.setChannelAiEnabled.mockResolvedValue({});
  api.setChannelTriageEnabled.mockResolvedValue({});
  api.deleteChannel.mockResolvedValue({});
  api.reconnectChannel.mockResolvedValue({});
  api.setChannelHidden.mockResolvedValue({});
});

describe('ChannelDetailPage', () => {
  test('aba Conexão mostra o QR de um baileys aguardando e as ações de cuidado', () => {
    renderDetail('/configuracoes/canais/ch1/conexao');
    expect(screen.getByRole('heading', { level: 1, name: 'Berg' })).toBeInTheDocument();
    expect(screen.getByTitle('QR - Berg')).toBeInTheDocument();
    const zone = screen.getByRole('heading', { name: /ações com cuidado/i }).closest('section');
    expect(within(zone).getByRole('button', { name: /reconectar/i })).toBeInTheDocument();
    expect(within(zone).getByRole('button', { name: /ocultar/i })).toBeInTheDocument();
    expect(within(zone).getByRole('button', { name: /excluir/i })).toBeInTheDocument();
  });

  test('aba Atendimento explica por que o noturno está desabilitado', () => {
    renderDetail('/configuracoes/canais/ch1/atendimento');
    const noturno = screen.getByRole('checkbox', { name: /atendimento noturno/i });
    expect(noturno).toBeDisabled();
    expect(screen.getByText('Precisa de Triagem com IA ligada')).toBeInTheDocument();
  });

  test('aba Atendimento avisa janela ausente com link para Automação › Atendimento noturno', () => {
    useChannels.mockReturnValue({ channels: [{ ...berg, aiTriageEnabled: true }], status: 'ready', refresh });
    renderDetail('/configuracoes/canais/ch1/atendimento');
    expect(screen.getByRole('checkbox', { name: /atendimento noturno/i })).toBeDisabled();
    expect(screen.getByRole('link', { name: /defina a janela/i })).toHaveAttribute('href', '/configuracoes/automacao/noturno');
  });

  test('ligar a IA chama setChannelAiEnabled e depois setChannelTriageEnabled(false), e recarrega', async () => {
    useChannels.mockReturnValue({ channels: [{ ...berg, aiEnabled: false }], status: 'ready', refresh });
    renderDetail('/configuracoes/canais/ch1/atendimento');
    await userEvent.click(screen.getByRole('checkbox', { name: /atendimento com ia/i }));
    await waitFor(() => expect(api.setChannelTriageEnabled).toHaveBeenCalledWith('ch1', false, 'tok'));
    expect(api.setChannelAiEnabled).toHaveBeenCalledWith('ch1', true, 'tok');
    expect(api.setChannelAiEnabled.mock.invocationCallOrder[0]).toBeLessThan(api.setChannelTriageEnabled.mock.invocationCallOrder[0]);
    expect(refresh).toHaveBeenCalled();
  });

  test('excluir pede confirmação com o texto de sempre e só então chama a API', async () => {
    renderDetail('/configuracoes/canais/ch1/conexao');
    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Excluir o canal "Berg" definitivamente? Só é possível se ele nunca teve conversas.');
    expect(api.deleteChannel).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /excluir/i }));
    await waitFor(() => expect(api.deleteChannel).toHaveBeenCalledWith('ch1', 'tok'));
  });

  // Fix round 1: reconnect()/toggleHidden() não tinham nenhum teste — o
  // AdminChannelsPage.test.jsx que os cobria foi apagado na Task 17 e a
  // migração só levou os handlers sem confirmação (triage/ai/aiTriage/
  // aiNightMode/wabaId) para useChannelActions.test.jsx.
  test('reconectar um canal já conectado pede confirmação; só chama a API depois de "Continuar", e cancelar não chama nada', async () => {
    useChannels.mockReturnValue({ channels: [{ ...berg, status: 'connected' }], status: 'ready', refresh });
    renderDetail('/configuracoes/canais/ch1/conexao');

    await userEvent.click(screen.getByRole('button', { name: /reconectar/i }));
    let dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(
      'está conectado. Reconectar vai derrubar a sessão atual e pedir um QR code novo. Continuar?'
    );
    expect(api.reconnectChannel).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: /cancelar/i }));
    expect(api.reconnectChannel).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /reconectar/i }));
    dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /continuar/i }));
    await waitFor(() => expect(api.reconnectChannel).toHaveBeenCalledWith('ch1', 'tok'));
  });

  test('ocultar um canal visível pede confirmação e chama setChannelHidden com hidden true', async () => {
    renderDetail('/configuracoes/canais/ch1/conexao');

    await userEvent.click(screen.getByRole('button', { name: /^ocultar$/i }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(
      'Ocultar o canal "Berg"? Ele sai da lista e a sessão do WhatsApp é encerrada. O histórico é preservado.'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /^ocultar$/i }));
    await waitFor(() => expect(api.setChannelHidden).toHaveBeenCalledWith('ch1', true, 'tok'));
  });

  test('canal oculto mostra Reexibir; confirmar chama setChannelHidden com hidden false', async () => {
    useChannels.mockReturnValue({ channels: [{ ...berg, hidden: true }], status: 'ready', refresh });
    renderDetail('/configuracoes/canais/ch1/conexao');

    await userEvent.click(screen.getByRole('button', { name: /^reexibir$/i }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Reexibir o canal "Berg"?');
    await userEvent.click(within(dialog).getByRole('button', { name: /^reexibir$/i }));
    await waitFor(() => expect(api.setChannelHidden).toHaveBeenCalledWith('ch1', false, 'tok'));
  });

  test('excluir recusado pela API mostra a mensagem devolvida em errors.action', async () => {
    api.deleteChannel.mockRejectedValue({ body: { error: 'Canal já teve conversas. Use Ocultar.' } });
    renderDetail('/configuracoes/canais/ch1/conexao');

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /excluir/i }));

    expect(await screen.findByText('Canal já teve conversas. Use Ocultar.')).toBeInTheDocument();
  });

  test('canal meta_cloud não mostra o botão Reconectar (não tem QR para reconectar)', () => {
    useChannels.mockReturnValue({ channels: [{ ...berg, type: 'meta_cloud', status: 'connected' }], status: 'ready', refresh });
    renderDetail('/configuracoes/canais/ch1/conexao');
    expect(screen.queryByRole('button', { name: /reconectar/i })).not.toBeInTheDocument();
  });

  test('sem o Atendimento com IA ligado, a Triagem com IA fica desabilitada com a explicação', () => {
    useChannels.mockReturnValue({ channels: [{ ...berg, aiEnabled: false }], status: 'ready', refresh });
    renderDetail('/configuracoes/canais/ch1/atendimento');
    expect(screen.getByRole('checkbox', { name: /triagem com ia/i })).toBeDisabled();
    expect(screen.getByText('Precisa de Atendimento com IA ligado')).toBeInTheDocument();
  });

  test('canal inexistente mostra aviso e link para a lista', () => {
    renderDetail('/configuracoes/canais/nao-existe/conexao');
    expect(screen.getByText(/canal não encontrado/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /voltar para a lista/i })).toHaveAttribute('href', '/configuracoes/canais');
  });

  test('gerente sem a flag vê os interruptores desabilitados com a explicação', () => {
    renderDetail('/configuracoes/canais/ch1/atendimento', { role: 'manager', canManageIntegrations: false });
    expect(screen.getByRole('checkbox', { name: /atendimento com ia/i })).toBeDisabled();
    expect(screen.getAllByText(/requer permissão de canais e integrações/i).length).toBeGreaterThan(0);
  });

  test('a aba Atendimento resume as configurações globais com atalhos', () => {
    renderDetail('/configuracoes/canais/ch1/atendimento');
    expect(screen.getByText(/1 opção/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /boas-vindas/i })).toHaveAttribute('href', '/configuracoes/mensagens/boas-vindas');
    expect(screen.getByRole('link', { name: /horário de atendimento/i })).toHaveAttribute('href', '/configuracoes/regras/horario');
    expect(screen.getByRole('link', { name: /openai/i })).toHaveAttribute('href', '/configuracoes/integracoes/openai');
  });
});
