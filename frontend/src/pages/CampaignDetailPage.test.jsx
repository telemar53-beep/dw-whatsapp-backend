import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../test-utils/renderInShell';
import CampaignDetailPage from './CampaignDetailPage';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

function renderPage(id = 'campaign-1') {
  return renderInShell(<CampaignDetailPage />, { path: '/campanhas/:id', initialEntries: [`/campanhas/${id}`] });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', name: 'Ana', role: 'agent' }, logout: vi.fn() });
  api.listChannelsForAgent.mockResolvedValue([]);
});

describe('CampaignDetailPage', () => {
  test('shows the counters and the recipient list', async () => {
    api.getCampaign.mockResolvedValue({
      id: 'campaign-1', name: 'Aviso', channelId: 'ch1', totalRecipients: 2, sentCount: 1, failedCount: 1, skippedCount: 0,
      recipients: [
        { id: 'r1', phoneNumber: '5511999990000', displayName: 'Joao', status: 'sent', errorMessage: null },
        { id: 'r2', phoneNumber: '5511999990001', displayName: null, status: 'failed', errorMessage: 'Número inválido' },
      ],
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Aviso' })).toBeInTheDocument();
    expect(screen.getByText('Joao')).toBeInTheDocument();
    expect(screen.getByText('Número inválido')).toBeInTheDocument();
  });

  test('shows the campaign channel', async () => {
    // Idem: o nome sai da lista de canais, nao de um `channelName` no payload.
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch1', name: 'Berg', type: 'baileys' }]);
    api.getCampaign.mockResolvedValue({
      id: 'campaign-1', name: 'Aviso', channelId: 'ch1', totalRecipients: 0, sentCount: 0, failedCount: 0, skippedCount: 0, recipients: [],
    });
    renderPage();

    expect(await screen.findByText(/Berg/)).toBeInTheDocument();
  });

  test('arms a 5-second poll while the campaign is still processing', async () => {
    api.getCampaign.mockResolvedValue({
      id: 'campaign-1', name: 'Aviso', channelId: 'ch1', totalRecipients: 2, sentCount: 0, failedCount: 0, skippedCount: 0, recipients: [],
    });
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    renderPage();

    await screen.findByRole('heading', { name: 'Aviso' });
    await waitFor(() => expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000));
  });

  test('does not poll once every recipient is already processed', async () => {
    api.getCampaign.mockResolvedValue({
      id: 'campaign-1', name: 'Aviso', channelName: 'Berg', totalRecipients: 1, sentCount: 1, failedCount: 0, skippedCount: 0, recipients: [],
    });
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    renderPage();

    // `findByText` itself relies on @testing-library/dom's `waitFor`, which
    // unconditionally arms its own real-timer fallback via
    // `setInterval(checkRealTimersCallback, 50)` alongside its MutationObserver
    // (see node_modules/@testing-library/dom/dist/wait-for.js). That call also
    // lands on this spy, so assert specifically that the page's own 5-second
    // poll was never armed rather than that `setInterval` was never called.
    await screen.findByRole('heading', { name: 'Aviso' });
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 5000);
  });
});

// Etapa 6.6 — filtro por resultado, lote de 200 e erro legivel.
describe('destinatarios em volume', () => {
  function destinatarios(n, status = 'sent') {
    return Array.from({ length: n }, (_, i) => ({ id: 'r' + i, phoneNumber: '551199999' + String(i).padStart(4, '0'), displayName: null, status, errorMessage: null }));
  }

  test('desenha no maximo 200 linhas e oferece "mostrar mais"', async () => {
    api.getCampaign.mockResolvedValue({
      id: 'campaign-1', name: 'Grande', channelId: 'ch1', totalRecipients: 500, sentCount: 500, failedCount: 0, skippedCount: 0,
      recipients: destinatarios(500),
    });
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Grande' });

    expect(container.querySelectorAll('.campaign-recipient-row')).toHaveLength(200);
    await userEvent.click(screen.getByRole('button', { name: /mostrar mais \(300 restantes\)/i }));
    expect(container.querySelectorAll('.campaign-recipient-row')).toHaveLength(400);
  });

  test('o filtro por resultado nao mexe nos contadores nem no progresso', async () => {
    api.getCampaign.mockResolvedValue({
      id: 'campaign-1', name: 'Aviso', channelId: 'ch1', totalRecipients: 3, sentCount: 2, failedCount: 1, skippedCount: 0,
      recipients: [
        { id: 'r1', phoneNumber: '5511999990000', displayName: 'Joao', status: 'sent', errorMessage: null },
        { id: 'r2', phoneNumber: '5511999990001', displayName: 'Maria', status: 'sent', errorMessage: null },
        { id: 'r3', phoneNumber: '5511999990002', displayName: 'Ana', status: 'failed', errorMessage: '(131049) marketing limit' },
      ],
    });
    const { container } = renderPage();
    await screen.findByText('Joao');

    await userEvent.click(screen.getByRole('button', { name: /falharam/i }));

    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Joao')).not.toBeInTheDocument();
    // O progresso continua sendo o da campanha inteira, nao o do filtro.
    const barra = container.querySelector('[role=progressbar]');
    expect(barra).toHaveAttribute('aria-valuenow', '3');
    expect(barra).toHaveAttribute('aria-valuemax', '3');
    expect(screen.getByLabelText('Resumo da campanha')).toHaveTextContent('3');
  });

  test('filtro sem nenhum destinatario tem mensagem propria', async () => {
    api.getCampaign.mockResolvedValue({
      id: 'campaign-1', name: 'Aviso', channelId: 'ch1', totalRecipients: 1, sentCount: 1, failedCount: 0, skippedCount: 0,
      recipients: [{ id: 'r1', phoneNumber: '5511999990000', displayName: 'Joao', status: 'sent', errorMessage: null }],
    });
    renderPage();
    await screen.findByText('Joao');

    await userEvent.click(screen.getByRole('button', { name: /pulados/i }));

    expect(screen.getByText(/nenhum destinatário com esse resultado/i)).toBeInTheDocument();
    expect(screen.queryByText(/nenhum destinatário nesta campanha/i)).not.toBeInTheDocument();
  });

  test('erro com codigo conhecido vira frase; sem mapeamento passa inteiro', async () => {
    api.getCampaign.mockResolvedValue({
      id: 'campaign-1', name: 'Aviso', channelId: 'ch1', totalRecipients: 2, sentCount: 0, failedCount: 2, skippedCount: 0,
      recipients: [
        { id: 'r1', phoneNumber: '5511999990000', displayName: null, status: 'failed', errorMessage: '(131047) Re-engagement message' },
        { id: 'r2', phoneNumber: '5511999990001', displayName: null, status: 'failed', errorMessage: 'Número não está no WhatsApp' },
      ],
    });
    renderPage();

    expect(await screen.findByText(/fora da janela de 24 h/i)).toBeInTheDocument();
    // Sem mapeamento confiavel, o texto tecnico e preservado como veio.
    expect(screen.getByText('Número não está no WhatsApp')).toBeInTheDocument();
  });

  test('a situacao do detalhe tambem e so a derivavel', async () => {
    api.getCampaign.mockResolvedValue({
      id: 'campaign-1', name: 'Aviso', channelId: 'ch1', totalRecipients: 10, sentCount: 4, failedCount: 0, skippedCount: 0,
      recipients: destinatarios(4),
    });
    renderPage();

    expect(await screen.findByText('Processando')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/travad|pausad|cancelad|em atraso/i);
  });
});
