import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../../../test-utils/renderInShell';
import AiTriagePage from './AiTriagePage';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useReasons } from '../../../hooks/useReasons';
import { useChannels } from '../../../hooks/useChannels';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../hooks/useReasons');
vi.mock('../../../hooks/useChannels');
vi.mock('../../../services/api');

const PATH = '/configuracoes/automacao/ia';

// Valores diferentes dos defaults do hook (80% / 2 / 3 minutos) — provam que
// a tela carrega da config em vez de coincidir com o default.
const saved = {
  configured: true,
  mode: 'assistant',
  triageConfidenceThreshold: 0.65,
  triageMaxQuestions: 4,
  triageTimeoutMinutes: 12,
  triageExtraInstructions: 'Pergunte o CPF antes de tudo',
  triageResolvedReasonId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 't', agent: { role: 'admin' } });
  useAiConfig.mockReturnValue({ config: saved, status: 'ready', loading: false, refresh: vi.fn() });
  useReasons.mockReturnValue({
    reasons: [
      { id: 'r-1', name: 'Segunda via', active: true },
      { id: 'r-2', name: 'Resolvido pela IA', active: true },
    ],
    status: 'ready',
  });
  useChannels.mockReturnValue({ channels: [], status: 'ready' });
  api.patchAiTriageConfig.mockResolvedValue({});
});

describe('AiTriagePage', () => {
  test('carrega os valores salvos (65 / 4 / 12)', () => {
    renderInShell(<AiTriagePage />, { path: PATH });
    expect(screen.getByDisplayValue('65')).toBeInTheDocument();
    expect(screen.getByDisplayValue('4')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pergunte o CPF antes de tudo')).toBeInTheDocument();
  });

  test('salva convertendo 85 (%) para 0.85', async () => {
    renderInShell(<AiTriagePage />, { path: PATH });

    const confidenceInput = screen.getByDisplayValue('65');
    await userEvent.clear(confidenceInput);
    await userEvent.type(confidenceInput, '85');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar triagem com IA' }));

    // Esta página é dona de cinco campos. A janela noturna e o recibo de dia
    // pertencem a outras duas telas e NÃO vão no corpo: o PATCH não encosta
    // em coluna que não veio.
    await waitFor(() => expect(api.patchAiTriageConfig).toHaveBeenCalledWith(
      {
        triageConfidenceThreshold: 0.85,
        triageMaxQuestions: 4,
        triageTimeoutMinutes: 12,
        triageExtraInstructions: 'Pergunte o CPF antes de tudo',
        triageResolvedReasonId: null,
      },
      't'
    ));
  });

  test('mostra o erro devolvido pelo backend', async () => {
    api.patchAiTriageConfig.mockRejectedValue({ body: { error: 'triageMaxQuestions must be an integer from 0 to 5' } });
    renderInShell(<AiTriagePage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: 'Salvar triagem com IA' }));

    expect(await screen.findByText(/triageMaxQuestions must be an integer from 0 to 5/i)).toBeInTheDocument();
  });

  test('lista os motivos cadastrados no select de encerramento pela IA', () => {
    renderInShell(<AiTriagePage />, { path: PATH });
    const select = screen.getByLabelText(/encerrar sozinha/i);
    expect(screen.getByRole('option', { name: 'Resolvido pela IA' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Segunda via' })).toBeInTheDocument();
    // Vazio é o padrão: sem motivo, a conversa vai para a fila como hoje.
    expect(select).toHaveValue('');
  });

  test('salva o motivo escolhido e volta a null quando o admin limpa', async () => {
    renderInShell(<AiTriagePage />, { path: PATH });

    const select = screen.getByLabelText(/encerrar sozinha/i);
    await userEvent.selectOptions(select, 'r-2');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar triagem com IA' }));
    await waitFor(() => expect(api.patchAiTriageConfig).toHaveBeenCalledWith(
      expect.objectContaining({ triageResolvedReasonId: 'r-2' }), 't'
    ));

    await userEvent.selectOptions(select, '');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar triagem com IA' }));
    await waitFor(() => expect(api.patchAiTriageConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ triageResolvedReasonId: null }), 't'
    ));
  });

  test('mostra a situação da OpenAI com atalho e os canais com IA', () => {
    useAiConfig.mockReturnValue({ config: { ...saved, configured: false, mode: 'assistant' }, status: 'ready', loading: false, refresh: vi.fn() });
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg', aiEnabled: true }, { id: 'ch2', name: 'Suporte', aiEnabled: false }], status: 'ready' });
    renderInShell(<AiTriagePage />, { path: PATH });
    expect(screen.getByText('Não configurada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /openai/i })).toHaveAttribute('href', '/configuracoes/integracoes/openai');
    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Suporte')).not.toBeInTheDocument();
  });

  test('avisa quando o motivo apontado não existe mais', () => {
    // O motivo salvo ('r-2') existe no default de reasons mas não na lista
    // reduzida abaixo — é exatamente essa divergência que o aviso denuncia.
    useAiConfig.mockReturnValue({ config: { ...saved, triageResolvedReasonId: 'r-2' }, status: 'ready', loading: false, refresh: vi.fn() });
    useReasons.mockReturnValue({ reasons: [{ id: 'outro', name: 'Outro' }], status: 'ready' });
    renderInShell(<AiTriagePage />, { path: PATH });
    expect(screen.getByText(/motivo escolhido está inativo ou não existe mais/i)).toBeInTheDocument();
  });

  test('o botão diz o que salva', () => {
    renderInShell(<AiTriagePage />, { path: PATH });
    expect(screen.getByRole('button', { name: 'Salvar triagem com IA' })).toBeInTheDocument();
  });
});

// Quando um atendente assume, a IA passava a sugerir respostas para ele. Isso
// agora e uma chave propria: desligar pelo `mode` levaria junto a triagem e a
// transcricao de audio, que continuam desejadas.
describe('sugestao de resposta ao atendente', () => {
  function renderPage() {
    return renderInShell(<AiTriagePage />, { path: PATH });
  }

  test('mostra a chave com o estado atual', () => {
    useAiConfig.mockReturnValue({
      config: { configured: true, mode: 'assistant', assistantSuggestionsEnabled: true },
      status: 'ready',
      loading: false,
      refresh: vi.fn(),
    });
    renderPage();

    expect(screen.getByRole('checkbox', { name: /sugerir respostas/i })).toBeChecked();
  });

  test('desmarcada quando a sugestao esta desligada', () => {
    useAiConfig.mockReturnValue({
      config: { configured: true, mode: 'assistant', assistantSuggestionsEnabled: false },
      status: 'ready',
      loading: false,
      refresh: vi.fn(),
    });
    renderPage();

    expect(screen.getByRole('checkbox', { name: /sugerir respostas/i })).not.toBeChecked();
  });

  test('ligar chama a API e recarrega', async () => {
    const refresh = vi.fn();
    useAiConfig.mockReturnValue({
      config: { configured: true, mode: 'assistant', assistantSuggestionsEnabled: false },
      status: 'ready',
      loading: false,
      refresh,
    });
    api.setAssistantSuggestionsEnabled.mockResolvedValue({});
    renderPage();

    await userEvent.click(screen.getByRole('checkbox', { name: /sugerir respostas/i }));

    await waitFor(() => expect(api.setAssistantSuggestionsEnabled).toHaveBeenCalledWith(true, 't'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
