import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CampaignsPage from './CampaignsPage';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

function renderPage() {
  return render(
    <MemoryRouter>
      <CampaignsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', name: 'Ana', role: 'agent' }, logout: vi.fn() });
});

describe('CampaignsPage', () => {
  test('lists existing campaigns with their counters', async () => {
    api.listCampaigns.mockResolvedValue([
      { id: 'campaign-1', name: 'Aviso setembro', totalRecipients: 45, sentCount: 42, failedCount: 2, skippedCount: 1, createdAt: '2026-09-11T10:00:00Z' },
    ]);
    renderPage();

    expect(await screen.findByText('Aviso setembro')).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  test('shows a message when there are no campaigns yet', async () => {
    api.listCampaigns.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/nenhuma campanha/i)).toBeInTheDocument();
  });

  test('opens the create campaign modal', async () => {
    api.listCampaigns.mockResolvedValue([]);
    api.listChannelsForAgent.mockResolvedValue([]);
    renderPage();

    await screen.findByText(/nenhuma campanha/i);
    await userEvent.click(screen.getByRole('button', { name: /nova campanha/i }));

    expect(await screen.findByRole('heading', { name: 'Nova campanha' })).toBeInTheDocument();
  });

  test('adds the new campaign to the list after creating it', async () => {
    const newCampaign = { id: 'campaign-new', name: 'Nova', totalRecipients: 1, sentCount: 0, failedCount: 0, skippedCount: 0, createdAt: '2026-09-11T10:00:00Z' };
    api.listCampaigns.mockResolvedValueOnce([]).mockResolvedValueOnce([newCampaign]);
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.createCampaign.mockResolvedValue(newCampaign);
    renderPage();

    await screen.findByText(/nenhuma campanha/i);
    await userEvent.click(screen.getByRole('button', { name: /nova campanha/i }));
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000');
    await userEvent.click(screen.getByRole('button', { name: /disparar/i }));

    await waitFor(() => expect(screen.getByText('Nova')).toBeInTheDocument());
  });
});
