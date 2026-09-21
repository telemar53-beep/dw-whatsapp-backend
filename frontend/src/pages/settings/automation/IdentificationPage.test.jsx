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
  api.updateAiTriageConfig.mockResolvedValue({});
});

describe('IdentificationPage', () => {
  test('o botão diz o que salva', () => {
    renderInShell(<IdentificationPage />, { path: PATH });
    expect(screen.getByRole('button', { name: 'Salvar identificação' })).toBeInTheDocument();
  });

  // Contrato de gravação (spec regra 8): esta página divide o PUT /triage com
  // AiTriagePage e NightModePage; o backend trata campo ausente como
  // "desligado", então salvar aqui precisa mandar os oito campos sempre. Os
  // sete que não são desta tela vêm da RELEITURA feita no instante do save.
  test('contrato: salva os oito campos do PUT /triage, mesmo mexendo só nos dela', async () => {
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
        triageReadReceiptsDaytime: false,
      },
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

  // Regra da Etapa 5.6: se não der para conferir o estado atual, NÃO grava.
  // Gravar com o cache antigo poderia reverter, em silêncio, a Triagem ou a
  // janela noturna que outra pessoa acabou de mudar.
  test('falha ao reler a configuração impede o save e preserva o formulário', async () => {
    api.getAiConfig.mockRejectedValue(new Error('rede caiu'));
    renderInShell(<IdentificationPage />, { path: PATH });

    await userEvent.click(screen.getByLabelText(/ler comprovantes também de dia/i));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar identificação' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível conferir a configuração atual/i);
    expect(api.updateAiTriageConfig).not.toHaveBeenCalled();
    // O que o admin marcou continua marcado.
    expect(screen.getByLabelText(/ler comprovantes também de dia/i)).toBeChecked();
  });

  // O valor das outras áreas vem do servidor no instante do save, não do que
  // esta página carregou minutos antes.
  test('usa o valor recém-lido das outras páginas, não o do cache', async () => {
    api.getAiConfig.mockResolvedValue({ ...saved, triageMaxQuestions: 9, nightStartTime: '22:00', nightEndTime: '06:00' });
    renderInShell(<IdentificationPage />, { path: PATH });

    await userEvent.click(screen.getByRole('button', { name: 'Salvar identificação' }));

    await waitFor(() => expect(api.updateAiTriageConfig).toHaveBeenCalledWith(
      expect.objectContaining({ triageMaxQuestions: 9, nightStartTime: '22:00', nightEndTime: '06:00' }), 't'
    ));
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
