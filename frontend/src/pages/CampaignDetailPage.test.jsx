import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CampaignDetailPage from './CampaignDetailPage';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

function renderPage(id = 'campaign-1') {
  return render(
    <MemoryRouter initialEntries={[`/campaigns/${id}`]}>
      <Routes>
        <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', name: 'Ana', role: 'agent' }, logout: vi.fn() });
});

describe('CampaignDetailPage', () => {
  test('shows the counters and the recipient list', async () => {
    api.getCampaign.mockResolvedValue({
      id: 'campaign-1', name: 'Aviso', totalRecipients: 2, sentCount: 1, failedCount: 1, skippedCount: 0,
      recipients: [
        { id: 'r1', phoneNumber: '5511999990000', displayName: 'Joao', status: 'sent', errorMessage: null },
        { id: 'r2', phoneNumber: '5511999990001', displayName: null, status: 'failed', errorMessage: 'Número inválido' },
      ],
    });
    renderPage();

    expect(await screen.findByText('Aviso')).toBeInTheDocument();
    expect(screen.getByText('Joao')).toBeInTheDocument();
    expect(screen.getByText('Número inválido')).toBeInTheDocument();
  });

  test('arms a 3-second poll while the campaign is still processing', async () => {
    api.getCampaign.mockResolvedValue({
      id: 'campaign-1', name: 'Aviso', totalRecipients: 2, sentCount: 0, failedCount: 0, skippedCount: 0, recipients: [],
    });
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    renderPage();

    await screen.findByText('Aviso');
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 3000);
  });

  test('does not poll once every recipient is already processed', async () => {
    api.getCampaign.mockResolvedValue({
      id: 'campaign-1', name: 'Aviso', totalRecipients: 1, sentCount: 1, failedCount: 0, skippedCount: 0, recipients: [],
    });
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    renderPage();

    // `findByText` itself relies on @testing-library/dom's `waitFor`, which
    // unconditionally arms its own real-timer fallback via
    // `setInterval(checkRealTimersCallback, 50)` alongside its MutationObserver
    // (see node_modules/@testing-library/dom/dist/wait-for.js). That call also
    // lands on this spy, so assert specifically that the page's own 3-second
    // poll was never armed rather than that `setInterval` was never called.
    await screen.findByText('Aviso');
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 3000);
  });
});
