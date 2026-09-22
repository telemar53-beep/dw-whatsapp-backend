import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../../../test-utils/renderInShell';
import IdentificationPage from './IdentificationPage';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useCompanyConfig } from '../../../hooks/useCompanyConfig';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../hooks/useCompanyConfig');
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
  useCompanyConfig.mockReturnValue({ config: { name: 'Net Fibra', acceptedPayeeNames: ['Net Fibra LTDA'] }, status: 'ready', refresh: vi.fn() });
  // O save relê a configuração antes de gravar: é assim que os campos das
  // outras duas páginas vão para o PUT com o valor atual do servidor, e não
  // com o que estava em cache aqui.
  api.getAiConfig.mockResolvedValue(saved);
  api.patchAiTriageConfig.mockResolvedValue({});
});

describe('IdentificationPage', () => {
  test('o botão diz o que salva', () => {
    renderInShell(<IdentificationPage />, { path: PATH });
    expect(screen.getByRole('button', { name: 'Salvar identificação' })).toBeInTheDocument();
  });

  // Contrato de gravação: esta página divide a linha de `ai_config` com
  // AiTriagePage e NightModePage. Enquanto o backend só tinha update total,
  // salvar aqui precisava mandar os oito campos, e os sete que não são desta
  // tela vinham de uma releitura no instante do save — mitigação que encurtava
  // a janela de sobreposição sem eliminá-la. Com o PATCH parcial esta tela
  // manda SÓ o campo dela.
  test('contrato: salva só o campo dela, e nada da triagem nem da janela', async () => {
    renderInShell(<IdentificationPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: 'Salvar identificação' }));

    await waitFor(() => expect(api.patchAiTriageConfig).toHaveBeenCalledWith(
      { triageReadReceiptsDaytime: false },
      't'
    ));
  });

  test('link para os nomes aceitos no comprovante aponta para Empresa', () => {
    renderInShell(<IdentificationPage />, { path: PATH });
    expect(screen.getByRole('link', { name: /configurar empresa/i })).toHaveAttribute('href', '/configuracoes/empresa');
  });

  // A identificação por CPF não tem controle aqui: quem liga é a Triagem. A
  // página mostra o estado e o caminho, e nada mais.
  test('identificação por CPF aparece como dependência da Triagem, sem controle próprio', () => {
    renderInShell(<IdentificationPage />, { path: PATH });
    expect(screen.getByRole('link', { name: /configurar triagem com ia/i })).toHaveAttribute('href', '/configuracoes/automacao/ia');
    expect(screen.getByText(/triagem com ia desligada/i)).toBeInTheDocument();
    // Um controle só na tela inteira: o de leitura de comprovantes.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  test('com a triagem ligada, a dependência diz que está ativa', () => {
    useAiConfig.mockReturnValue({ config: { ...saved, mode: 'triage' }, status: 'ready', loading: false, refresh: vi.fn() });
    renderInShell(<IdentificationPage />, { path: PATH });
    expect(screen.getByText(/triagem com ia ativa/i)).toBeInTheDocument();
  });

  test('sem nome aceito, o aviso de que nenhum comprovante confere aparece', () => {
    useCompanyConfig.mockReturnValue({ config: { name: 'Net Fibra', acceptedPayeeNames: [] }, status: 'ready', refresh: vi.fn() });
    renderInShell(<IdentificationPage />, { path: PATH });
    expect(screen.getByText('Nenhum nome cadastrado')).toBeInTheDocument();
    expect(screen.getByText(/nenhum comprovante confere/i)).toBeInTheDocument();
  });

  // Estes dois testes cobriam a releitura antes do save: a mitigação que
  // existia porque o backend fazia update total. Ela saiu junto com o PUT, e
  // o que passou a valer é o que vai abaixo — o save não depende de conferir
  // nada, e o que não é desta tela simplesmente não é enviado.
  test('não relê a configuração para salvar: o PATCH preserva o resto sozinho', async () => {
    renderInShell(<IdentificationPage />, { path: PATH });

    await userEvent.click(screen.getByLabelText(/ler comprovantes também de dia/i));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar identificação' }));

    await waitFor(() => expect(api.patchAiTriageConfig).toHaveBeenCalled());
    expect(api.getAiConfig).not.toHaveBeenCalled();
  });

  // O cache desta página pode estar velho em relação às outras duas — e não
  // importa mais: esses campos não entram no corpo, então não há o que
  // reverter.
  test('cache velho das outras telas não é enviado nem reverte nada', async () => {
    useAiConfig.mockReturnValue({
      config: { ...saved, triageMaxQuestions: 9, nightStartTime: '22:00', nightEndTime: '06:00' },
      status: 'ready', loading: false, refresh: vi.fn(),
    });
    renderInShell(<IdentificationPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: 'Salvar identificação' }));

    await waitFor(() => expect(api.patchAiTriageConfig).toHaveBeenCalled());
    const corpo = api.patchAiTriageConfig.mock.calls[0][0];
    expect(Object.keys(corpo)).toEqual(['triageReadReceiptsDaytime']);
    expect('triageMaxQuestions' in corpo).toBe(false);
    expect('nightStartTime' in corpo).toBe(false);
    expect('nightEndTime' in corpo).toBe(false);
  });

  describe('ler comprovantes também de dia', () => {
    test('nasce desmarcado e vai como false ao salvar', async () => {
      renderInShell(<IdentificationPage />, { path: PATH });

      const caixa = screen.getByLabelText(/ler comprovantes também de dia/i);
      expect(caixa).not.toBeChecked();
      expect(screen.getByText(/avisa a atendente se o comprovante já foi usado/i)).toBeInTheDocument();
      expect(screen.getByText(/Nenhuma liberação de dia/i)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Salvar identificação' }));
      await waitFor(() => expect(api.patchAiTriageConfig).toHaveBeenCalledWith(
        expect.objectContaining({ triageReadReceiptsDaytime: false }), 't'
      ));
    });

    test('marcar manda true', async () => {
      renderInShell(<IdentificationPage />, { path: PATH });

      await userEvent.click(screen.getByLabelText(/ler comprovantes também de dia/i));
      await userEvent.click(screen.getByRole('button', { name: 'Salvar identificação' }));

      await waitFor(() => expect(api.patchAiTriageConfig).toHaveBeenCalledWith(
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
