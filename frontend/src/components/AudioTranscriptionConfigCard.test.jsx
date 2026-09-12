import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import AudioTranscriptionConfigCard from './AudioTranscriptionConfigCard';

vi.mock('../services/api');
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));

import { getAiConfig, updateTranscriptionConfig, testAiConnection } from '../services/api';

describe('AudioTranscriptionConfigCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAiConfig.mockResolvedValue({
      configured: true, transcriptionEnabled: false, transcriptionModel: '',
      transcriptionMaxSeconds: 300, transcriptionMaxBytes: 26214400,
      transcriptionPrompt: 'PPPoE, ONU', transcriptionFeedAi: true,
    });
  });

  test('mostra a duração em minutos e o tamanho em MB', async () => {
    render(<AudioTranscriptionConfigCard />);
    expect(await screen.findByDisplayValue('5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('25')).toBeInTheDocument();
  });

  test('carrega o vocabulário salvo', async () => {
    render(<AudioTranscriptionConfigCard />);
    expect(await screen.findByDisplayValue('PPPoE, ONU')).toBeInTheDocument();
  });

  test('buscar modelos preenche a lista', async () => {
    testAiConnection.mockResolvedValue({ ok: true, models: ['modelo-a', 'modelo-b'] });
    render(<AudioTranscriptionConfigCard />);
    await userEvent.click(await screen.findByRole('button', { name: /buscar modelos/i }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'modelo-a' })).toBeInTheDocument());
  });

  test('salvar envia minutos e MB convertidos para segundos e bytes', async () => {
    testAiConnection.mockResolvedValue({ ok: true, models: ['modelo-a'] });
    updateTranscriptionConfig.mockResolvedValue({});
    render(<AudioTranscriptionConfigCard />);

    await userEvent.click(await screen.findByRole('button', { name: /buscar modelos/i }));
    await waitFor(() => screen.getByRole('option', { name: 'modelo-a' }));
    await userEvent.selectOptions(screen.getByLabelText(/modelo/i), 'modelo-a');
    await userEvent.click(screen.getByLabelText(/transcrever áudios/i));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(updateTranscriptionConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionEnabled: true, transcriptionModel: 'modelo-a',
        transcriptionMaxSeconds: 300, transcriptionMaxBytes: 26214400,
      }),
      't'
    ));
  });

  test('não deixa salvar habilitado sem modelo', async () => {
    render(<AudioTranscriptionConfigCard />);
    await userEvent.click(await screen.findByLabelText(/transcrever áudios/i));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByText(/modelo é obrigatório/i)).toBeInTheDocument();
    expect(updateTranscriptionConfig).not.toHaveBeenCalled();
  });
});
