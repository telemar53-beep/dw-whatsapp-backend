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
    // Valores diferentes dos defaults do useState (5 minutos / 25 MB) — se o
    // useEffect de conversão fosse removido, este teste falharia.
    getAiConfig.mockResolvedValue({
      configured: true, transcriptionEnabled: false, transcriptionModel: '',
      transcriptionMaxSeconds: 120, transcriptionMaxBytes: 10485760,
      transcriptionPrompt: 'PPPoE, ONU', transcriptionFeedAi: true,
    });
    render(<AudioTranscriptionConfigCard />);
    expect(await screen.findByDisplayValue('2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10')).toBeInTheDocument();
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
    // Digita valores diferentes dos que vieram do config (5/25) para o teste
    // conseguir distinguir Number(maxMinutes) * 60 de um bug tipo maxMinutes * 60.
    await userEvent.clear(screen.getByLabelText(/duração máxima/i));
    await userEvent.type(screen.getByLabelText(/duração máxima/i), '3');
    await userEvent.clear(screen.getByLabelText(/tamanho máximo/i));
    await userEvent.type(screen.getByLabelText(/tamanho máximo/i), '10');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(updateTranscriptionConfig).toHaveBeenCalledWith(
      {
        transcriptionEnabled: true,
        transcriptionModel: 'modelo-a',
        transcriptionMaxSeconds: 180,
        transcriptionMaxBytes: 10485760,
        transcriptionPrompt: 'PPPoE, ONU',
        transcriptionFeedAi: true,
      },
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

  test('não deixa salvar com duração máxima vazia', async () => {
    render(<AudioTranscriptionConfigCard />);
    await screen.findByDisplayValue('5');
    await userEvent.clear(screen.getByLabelText(/duração máxima/i));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(await screen.findByText(/duração e tamanho máximos devem ser números inteiros maiores que zero/i)).toBeInTheDocument();
    expect(updateTranscriptionConfig).not.toHaveBeenCalled();
  });

  test('desabilita o botão Salvar enquanto a configuração ainda está carregando', async () => {
    // Uma promise que nunca resolve simula a janela de carregamento em que
    // `loading` do useAiConfig ainda é true e os states carregam os defaults.
    getAiConfig.mockReturnValue(new Promise(() => {}));
    render(<AudioTranscriptionConfigCard />);

    expect(screen.getByRole('button', { name: /salvar/i })).toBeDisabled();
  });
});
