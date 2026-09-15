import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../../../test-utils/renderInShell';
import IdentificationPage from './IdentificationPage';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../services/api');

const PATH = '/configuracoes/automacao/identificacao';

const saved = {
  configured: true,
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
  api.updateAiTriageConfig.mockResolvedValue({});
});

describe('IdentificationPage', () => {
  test('o botão diz o que salva', () => {
    renderInShell(<IdentificationPage />, { path: PATH });
    expect(screen.getByRole('button', { name: 'Salvar identificação' })).toBeInTheDocument();
  });

  // Contrato de gravação (spec regra 8): esta página divide o PUT /triage com
  // AiTriagePage e NightModePage; o backend trata campo ausente como
  // "desligado", então salvar aqui precisa mandar os nove campos sempre, com
  // os valores das outras duas páginas preservados tal como vieram do GET.
  test('contrato: salva os nove campos do PUT /triage, mesmo mexendo só nos dela', async () => {
    renderInShell(<IdentificationPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: 'Salvar identificação' }));

    await waitFor(() => expect(api.updateAiTriageConfig).toHaveBeenCalledWith(
      {
        triageConfidenceThreshold: 0.65,
        triageMaxQuestions: 4,
        triageTimeoutMinutes: 12,
        triageExtraInstructions: 'Pergunte o CPF antes de tudo',
        triageResolvedReasonId: null,
        // Config sem janela: os campos nascem vazios e salvam null (não mais
        // o padrão 20:00/08:00 — essa página não mostra a janela).
        nightStartTime: null,
        nightEndTime: null,
        triageRequireBirthdate: false,
        triageReadReceiptsDaytime: false,
      },
      't'
    ));
  });

  test('link para os nomes aceitos no comprovante aponta para Empresa', () => {
    renderInShell(<IdentificationPage />, { path: PATH });
    expect(screen.getByRole('link', { name: /empresa/i })).toHaveAttribute('href', '/configuracoes/empresa');
  });

  describe('exigir data de nascimento depois do CPF', () => {
    test('nasce desmarcado e vai como false ao salvar', async () => {
      renderInShell(<IdentificationPage />, { path: PATH });

      const caixa = screen.getByLabelText(/exigir data de nascimento depois do CPF/i);
      expect(caixa).not.toBeChecked();
      expect(screen.getByText(/o CPF digitado já identifica o cliente e libera boleto\/PIX/i)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Salvar identificação' }));
      await waitFor(() => expect(api.updateAiTriageConfig).toHaveBeenCalledWith(
        expect.objectContaining({ triageRequireBirthdate: false }), 't'
      ));
    });

    test('marcar manda true', async () => {
      renderInShell(<IdentificationPage />, { path: PATH });

      await userEvent.click(screen.getByLabelText(/exigir data de nascimento depois do CPF/i));
      await userEvent.click(screen.getByRole('button', { name: 'Salvar identificação' }));

      await waitFor(() => expect(api.updateAiTriageConfig).toHaveBeenCalledWith(
        expect.objectContaining({ triageRequireBirthdate: true }), 't'
      ));
    });

    test('carrega marcado quando a config já exige a data', () => {
      useAiConfig.mockReturnValue({ config: { ...saved, triageRequireBirthdate: true }, status: 'ready', loading: false, refresh: vi.fn() });
      renderInShell(<IdentificationPage />, { path: PATH });
      expect(screen.getByLabelText(/exigir data de nascimento depois do CPF/i)).toBeChecked();
    });
  });

  describe('ler comprovantes também de dia', () => {
    test('nasce desmarcado e vai como false ao salvar', async () => {
      renderInShell(<IdentificationPage />, { path: PATH });

      const caixa = screen.getByLabelText(/ler comprovantes também de dia/i);
      expect(caixa).not.toBeChecked();
      expect(screen.getByText(/avisa a atendente se o comprovante já foi usado/i)).toBeInTheDocument();
      expect(screen.getByText(/Nenhuma liberação de dia/i)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Salvar identificação' }));
      await waitFor(() => expect(api.updateAiTriageConfig).toHaveBeenCalledWith(
        expect.objectContaining({ triageReadReceiptsDaytime: false }), 't'
      ));
    });

    test('marcar manda true', async () => {
      renderInShell(<IdentificationPage />, { path: PATH });

      await userEvent.click(screen.getByLabelText(/ler comprovantes também de dia/i));
      await userEvent.click(screen.getByRole('button', { name: 'Salvar identificação' }));

      await waitFor(() => expect(api.updateAiTriageConfig).toHaveBeenCalledWith(
        expect.objectContaining({ triageReadReceiptsDaytime: true }), 't'
      ));
    });

    test('carrega marcado quando a config já lê de dia', () => {
      useAiConfig.mockReturnValue({ config: { ...saved, triageReadReceiptsDaytime: true }, status: 'ready', loading: false, refresh: vi.fn() });
      renderInShell(<IdentificationPage />, { path: PATH });
      expect(screen.getByLabelText(/ler comprovantes também de dia/i)).toBeChecked();
    });
  });
});
