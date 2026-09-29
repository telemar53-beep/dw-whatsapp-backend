import { describe, test, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../../../test-utils/renderInShell';
import AiToolsPage from './AiToolsPage';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useAiTools } from '../../../hooks/useAiTools';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../hooks/useAiTools');
vi.mock('../../../services/api');

const PATH = '/configuracoes/automacao/ferramentas';

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 't', agent: { role: 'admin' } });
  useAiConfig.mockReturnValue({ config: { triageResolvedReasonId: null }, status: 'ready', loading: false, refresh: vi.fn() });
});

const SENSIVEIS = ['desbloqueio_confianca', 'gerar_pix', 'enviar_boleto'];
const NOMES = [
  'buscar_cliente', 'consultar_status_contrato', 'consultar_status_conexao', 'consultar_plano', 'consultar_status_todos_contratos',
  'consultar_financeiro', 'consultar_faturas', 'consultar_faturas_todos_contratos', 'analisar_comprovante', 'gerar_segunda_via', 'gerar_pix',
  'desbloqueio_confianca', 'enviar_boleto',
  'definir_motivo_atendimento', 'esquecer_identificacao', 'concluir_triagem',
  'transferir_atendimento', 'encerrar_atendimento',
];
function ferramenta(nome, enabled) {
  return { nome, categoria: 'CONSULTA', descricao: 'd', enabled };
}
// As 18 do produto, alternando ligadas e desligadas; as três sensíveis desligadas.
// O rerender do renderInShell trocaria a raiz e perderia o roteador: quem força
// a nova renderização (a da releitura que chega) é este invólucro.
let recarregar = () => {};
function ComRecarga() {
  const [, setN] = useState(0);
  recarregar = () => setN((n) => n + 1);
  return <AiToolsPage />;
}
const TODAS = () => NOMES.map((nome, i) => ferramenta(nome, SENSIVEIS.includes(nome) ? false : i % 2 === 0));

describe('AiToolsPage', () => {
  test('organiza as ações por assunto sem esconder as sensíveis', () => {
    useAiTools.mockReturnValue({
      tools: [
        { nome: 'consultar_plano', categoria: 'CONSULTA', descricao: 'd', enabled: true },
        { nome: 'gerar_pix', categoria: 'ACAO_SENSIVEL', descricao: 'd', enabled: false },
      ],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<AiToolsPage />, { path: PATH });
    expect(screen.getByText('Consultas')).toBeInTheDocument();
    expect(screen.getByText('Financeiro')).toBeInTheDocument();
    expect(screen.getByText('Ação sensível')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  test('mantém ferramentas futuras visíveis em Outras ações', () => {
    useAiTools.mockReturnValue({
      tools: [{ nome: 'nova_ferramenta', categoria: 'NOVA', descricao: 'Nova descrição', enabled: false }],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<AiToolsPage />, { path: PATH });
    expect(screen.getByText('Outras ações')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'nova_ferramenta' })).toBeInTheDocument();
  });

  test('toggling a tool saves it', async () => {
    useAiTools.mockReturnValue({ tools: [ferramenta('consultar_plano', true), ferramenta('gerar_pix', false)], status: 'ready', refresh: vi.fn() });
    api.setAiToolEnabled.mockResolvedValue({ toolName: 'consultar_plano', enabled: false });
    renderInShell(<AiToolsPage />, { path: PATH });

    await userEvent.click(screen.getByRole('checkbox', { name: /consultar plano contratado/i }));

    expect(api.setAiToolEnabled).toHaveBeenCalledWith('consultar_plano', false, 't');
  });

  // Fatia S0 (29/09): só ATIVAR as três ações que mexem com dinheiro ou com a
  // conexão do cliente pede confirmação. Desativar e os outros 15 seguem imediatos.
  test.each([
    ['desbloqueio_confianca', /liberar em confiança/i, /religar a internet/i],
    ['gerar_pix', /gerar código pix/i, /código pix/i],
    ['enviar_boleto', /enviar boleto em pdf/i, /boleto em pdf/i],
  ])('ativar %s pede confirmação; cancelar não grava e o controle fica desligado', async (nome, rotulo, efeito) => {
    useAiTools.mockReturnValue({ tools: TODAS(), status: 'ready', refresh: vi.fn() });
    renderInShell(<AiToolsPage />, { path: PATH });

    const controle = screen.getByRole('checkbox', { name: rotulo });
    await userEvent.click(controle);

    const dialogo = screen.getByRole('alertdialog');
    expect(dialogo).toHaveTextContent(efeito);
    expect(api.setAiToolEnabled).not.toHaveBeenCalled();
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));

    expect(api.setAiToolEnabled).not.toHaveBeenCalled();
    expect(controle).not.toBeChecked();
  });

  test.each([
    ['desbloqueio_confianca', /liberar em confiança/i, 'Ativar liberação em confiança'],
    ['gerar_pix', /gerar código pix/i, 'Ativar geração de PIX'],
    ['enviar_boleto', /enviar boleto em pdf/i, 'Ativar envio de boleto'],
  ])('confirmar a ativação de %s grava uma vez com o mesmo payload', async (nome, rotulo, confirmar) => {
    useAiTools.mockReturnValue({ tools: TODAS(), status: 'ready', refresh: vi.fn() });
    api.setAiToolEnabled.mockResolvedValue({ toolName: nome, enabled: true });
    renderInShell(<AiToolsPage />, { path: PATH });

    await userEvent.click(screen.getByRole('checkbox', { name: rotulo }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: confirmar }));

    await waitFor(() => expect(api.setAiToolEnabled).toHaveBeenCalledTimes(1));
    expect(api.setAiToolEnabled).toHaveBeenCalledWith(nome, true, 't');
    await waitFor(() => expect(screen.getByRole('checkbox', { name: rotulo })).toBeChecked());
  });

  test('desativar as três sensíveis é imediato, sem confirmação', async () => {
    const ligadas = TODAS().map((t) => (SENSIVEIS.includes(t.nome) ? { ...t, enabled: true } : t));
    useAiTools.mockReturnValue({ tools: ligadas, status: 'ready', refresh: vi.fn() });
    api.setAiToolEnabled.mockResolvedValue({});
    renderInShell(<AiToolsPage />, { path: PATH });

    for (const rotulo of [/liberar em confiança/i, /gerar código pix/i, /enviar boleto em pdf/i]) {
      await userEvent.click(screen.getByRole('checkbox', { name: rotulo }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    }
    await waitFor(() => expect(api.setAiToolEnabled).toHaveBeenCalledTimes(3));
    for (const nome of SENSIVEIS) expect(api.setAiToolEnabled).toHaveBeenCalledWith(nome, false, 't');
  });

  test('os outros 15 controles gravam sem confirmação, ao ligar e ao desligar', async () => {
    useAiTools.mockReturnValue({ tools: TODAS(), status: 'ready', refresh: vi.fn() });
    api.setAiToolEnabled.mockResolvedValue({});
    renderInShell(<AiToolsPage />, { path: PATH });

    const outras = TODAS().filter((t) => !SENSIVEIS.includes(t.nome));
    expect(outras).toHaveLength(15);
    for (const t of outras) {
      await userEvent.click(document.getElementById(`tool-${t.nome}`));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    }
    await waitFor(() => expect(api.setAiToolEnabled).toHaveBeenCalledTimes(15));
    for (const t of outras) expect(api.setAiToolEnabled).toHaveBeenCalledWith(t.nome, !t.enabled, 't');
  });

  test('salvando: mostra "Salvando…" e um segundo clique no mesmo controle não gera outro pedido', async () => {
    useAiTools.mockReturnValue({ tools: [ferramenta('consultar_plano', false)], status: 'ready', refresh: vi.fn() });
    api.setAiToolEnabled.mockReturnValue(new Promise(() => {}));
    renderInShell(<AiToolsPage />, { path: PATH });

    const controle = screen.getByRole('checkbox', { name: /consultar plano contratado/i });
    await userEvent.click(controle);
    await userEvent.click(controle);

    expect(api.setAiToolEnabled).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Salvando…');
    expect(controle).toBeChecked();
  });

  test('falha: o controle volta ao valor anterior, o erro aparece e dá para tentar de novo', async () => {
    useAiTools.mockReturnValue({ tools: [ferramenta('consultar_plano', false)], status: 'ready', refresh: vi.fn() });
    api.setAiToolEnabled
      .mockRejectedValueOnce(Object.assign(new Error('falhou'), { status: 500 }))
      .mockResolvedValueOnce({});
    renderInShell(<AiToolsPage />, { path: PATH });

    const controle = screen.getByRole('checkbox', { name: /consultar plano contratado/i });
    await userEvent.click(controle);

    expect(await screen.findByRole('alert')).toHaveTextContent(/valor anterior foi mantido/i);
    expect(controle).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    await waitFor(() => expect(controle).toBeChecked());
    expect(api.setAiToolEnabled).toHaveBeenLastCalledWith('consultar_plano', true, 't');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('resposta atrasada da releitura não desfaz uma mudança já gravada', async () => {
    const refresh = vi.fn();
    useAiTools.mockReturnValue({ tools: [ferramenta('consultar_plano', false)], status: 'ready', refresh });
    api.setAiToolEnabled.mockResolvedValue({});
    renderInShell(<ComRecarga />, { path: PATH });

    const controle = screen.getByRole('checkbox', { name: /consultar plano contratado/i });
    await userEvent.click(controle);
    await waitFor(() => expect(controle).toBeChecked());

    // A releitura pedida antes da gravação chega depois, com o valor velho.
    useAiTools.mockReturnValue({ tools: [ferramenta('consultar_plano', false)], status: 'ready', refresh });
    act(() => recarregar());

    expect(screen.getByRole('checkbox', { name: /consultar plano contratado/i })).toBeChecked();
  });

  test('mantém descrição e identificador técnico acessíveis sob demanda', async () => {
    useAiTools.mockReturnValue({
      tools: [{ nome: 'consultar_status_conexao', categoria: 'CONSULTA', descricao: 'Verifica em tempo real...', enabled: true }],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<AiToolsPage />, { path: PATH });
    expect(screen.getByRole('checkbox', { name: /consultar conexão de internet/i })).toBeChecked();
    await userEvent.click(screen.getByText('Quando usar'));
    expect(screen.getByText('consultar_status_conexao')).toBeInTheDocument();
    expect(screen.getByText(/verifica em tempo real/i)).toBeInTheDocument();
  });

  test('avisa quando encerrar sozinha está configurado mas a ferramenta está desligada', () => {
    useAiConfig.mockReturnValue({ config: { triageResolvedReasonId: 'r1' }, status: 'ready', loading: false, refresh: vi.fn() });
    useAiTools.mockReturnValue({
      tools: [{ nome: 'encerrar_atendimento', categoria: 'ACAO', descricao: '...', enabled: false }],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<AiToolsPage />, { path: PATH });
    expect(screen.getByText(/ferramenta encerrar atendimento sozinha está desligada/i)).toBeInTheDocument();
  });

  test('não avisa quando a ferramenta encerrar sozinha já está ligada', () => {
    useAiConfig.mockReturnValue({ config: { triageResolvedReasonId: 'r1' }, status: 'ready', loading: false, refresh: vi.fn() });
    useAiTools.mockReturnValue({
      tools: [{ nome: 'encerrar_atendimento', categoria: 'ACAO', descricao: '...', enabled: true }],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<AiToolsPage />, { path: PATH });
    expect(screen.queryByText(/está desligada/i)).not.toBeInTheDocument();
  });
});
