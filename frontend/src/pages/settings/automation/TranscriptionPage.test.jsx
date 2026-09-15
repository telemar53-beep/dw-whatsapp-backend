import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderInShell } from '../../../test-utils/renderInShell';
import TranscriptionPage from './TranscriptionPage';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../services/api');

const PATH = '/configuracoes/automacao/transcricao';

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 't', agent: { role: 'admin' } });
});

describe('TranscriptionPage', () => {
  test('mostra o cartão de transcrição com o botão certo', () => {
    useAiConfig.mockReturnValue({
      config: { configured: true, transcriptionEnabled: false, transcriptionModel: '', transcriptionMaxSeconds: 300, transcriptionMaxBytes: 26214400, transcriptionPrompt: '', transcriptionFeedAi: true },
      loading: false,
      refresh: vi.fn(),
    });
    renderInShell(<TranscriptionPage />, { path: PATH });
    expect(screen.getByRole('button', { name: 'Salvar transcrição' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /buscar modelos/i })).not.toBeDisabled();
  });

  test('desabilita Buscar modelos com a OpenAI ainda não configurada', () => {
    useAiConfig.mockReturnValue({
      config: { configured: false, transcriptionEnabled: false, transcriptionModel: '', transcriptionMaxSeconds: 300, transcriptionMaxBytes: 26214400, transcriptionPrompt: '', transcriptionFeedAi: true },
      loading: false,
      refresh: vi.fn(),
    });
    renderInShell(<TranscriptionPage />, { path: PATH });
    const buscar = screen.getByRole('button', { name: /buscar modelos/i });
    expect(buscar).toBeDisabled();
    expect(buscar).toHaveAttribute('title', 'Salve a chave da OpenAI primeiro');
  });
});
