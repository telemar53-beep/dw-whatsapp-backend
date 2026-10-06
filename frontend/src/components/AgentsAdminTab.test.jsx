import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentsAdminTab from './AgentsAdminTab';
import { useAuth } from '../contexts/AuthContext';
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { useSectors } from '../hooks/useSectors';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useAgentsAdmin');
vi.mock('../hooks/useSectors');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
  useSectors.mockReturnValue({ sectors: [], refresh: vi.fn() });
});

const ANA = { id: 'a1', name: 'Ana', email: 'ana@dw.test', role: 'agent', active: true, sectors: [] };

// O jsdom não tem PointerEvent: o clique no fundo é descer e soltar no mesmo ponto.
function ponteiro(alvo, tipo, x, y) {
  fireEvent(alvo, new MouseEvent(tipo, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
}

async function abrirAcao(nome) {
  await userEvent.click(screen.getByRole('button', { name: /mais ações/i }));
  await userEvent.click(screen.getByRole('button', { name: nome }));
}

describe('AgentsAdminTab', () => {
  test('lists every agent with name, email, role and status', () => {
    useAgentsAdmin.mockReturnValue({
      agents: [
        { id: 'a1', name: 'Ana', email: 'ana@dw.test', role: 'agent', active: true, sectors: [] },
        { id: 'a2', name: 'Beto', email: 'beto@dw.test', role: 'admin', active: false, sectors: [] },
      ],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText(/ana@dw.test/)).toBeInTheDocument();
    expect(screen.getByText('Beto')).toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
    expect(screen.getByText('Inativo')).toBeInTheDocument();
  });

  test('shows Gerente as the role label for a manager', () => {
    useAgentsAdmin.mockReturnValue({
      agents: [{ id: 'a1', name: 'Marcia', email: 'marcia@dw.test', role: 'manager', active: true, sectors: [] }],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);
    expect(screen.getByRole('cell', { name: 'Gerente' })).toBeInTheDocument();
  });

  // Fatia S0 (29/09): desativar pede confirmação com o nome e o efeito, e a
  // falha não finge sucesso.
  test('desativar pede confirmação com o nome e o efeito; confirmar chama a API uma vez e recarrega', async () => {
    const refresh = vi.fn();
    useAgentsAdmin.mockReturnValue({ agents: [ANA], refresh });
    api.setAgentActive.mockResolvedValue({});
    render(<AgentsAdminTab />);

    await abrirAcao(/desativar/i);
    const dialogo = screen.getByRole('alertdialog', { name: 'Desativar Ana?' });
    expect(dialogo).toHaveTextContent(/não consegue mais entrar/i);
    expect(api.setAgentActive).not.toHaveBeenCalled();

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Desativar usuário' }));

    await waitFor(() => expect(api.setAgentActive).toHaveBeenCalledTimes(1));
    expect(api.setAgentActive).toHaveBeenCalledWith('a1', false, 'tok-123');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  test('cancelar ou Escape na confirmação de desativar não chamam a API', async () => {
    useAgentsAdmin.mockReturnValue({ agents: [ANA], refresh: vi.fn() });
    render(<AgentsAdminTab />);

    await abrirAcao(/desativar/i);
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await abrirAcao(/desativar/i);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    expect(api.setAgentActive).not.toHaveBeenCalled();
  });

  test('desativando: clique duplo não repete o pedido, o botão diz o que faz e Escape não fecha', async () => {
    useAgentsAdmin.mockReturnValue({ agents: [ANA], refresh: vi.fn() });
    api.setAgentActive.mockReturnValue(new Promise(() => {}));
    render(<AgentsAdminTab />);

    await abrirAcao(/desativar/i);
    const confirmar = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Desativar usuário' });
    await userEvent.click(confirmar);
    await userEvent.click(confirmar);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(api.setAgentActive).toHaveBeenCalledTimes(1);
    expect(confirmar).toHaveTextContent('Desativando…');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  test('falha ao desativar: o usuário continua ativo, o erro aparece e dá para tentar de novo', async () => {
    const refresh = vi.fn();
    useAgentsAdmin.mockReturnValue({ agents: [ANA], refresh });
    api.setAgentActive.mockRejectedValueOnce(Object.assign(new Error('Agent not found'), { status: 404 })).mockResolvedValueOnce({});
    render(<AgentsAdminTab />);

    await abrirAcao(/desativar/i);
    const dialogo = screen.getByRole('alertdialog');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Desativar usuário' }));

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(/.+/);
    expect(refresh).not.toHaveBeenCalled();
    expect(within(screen.getByRole('table')).getByText('Ativo')).toBeInTheDocument();

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Desativar usuário' }));
    await waitFor(() => expect(api.setAgentActive).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  test('reactivates a deactivated agent', async () => {
    const refresh = vi.fn();
    useAgentsAdmin.mockReturnValue({
      agents: [{ id: 'a1', name: 'Ana', email: 'ana@dw.test', role: 'agent', active: false, sectors: [] }],
      refresh,
    });
    api.setAgentActive.mockResolvedValue({});
    render(<AgentsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /mais ações/i }));
    await userEvent.click(screen.getByRole('button', { name: /reativar/i }));

    await waitFor(() => expect(api.setAgentActive).toHaveBeenCalledWith('a1', true, 'tok-123'));
  });

  test('does not show a deactivate button for the currently logged-in admin', () => {
    useAgentsAdmin.mockReturnValue({
      agents: [{ id: 'admin-1', name: 'Você', email: 'voce@dw.test', role: 'admin', active: true, sectors: [] }],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);
    expect(screen.queryByRole('button', { name: /desativar/i })).not.toBeInTheDocument();
  });

  test('does not show a "Gerar nova senha" button for the currently logged-in admin', () => {
    useAgentsAdmin.mockReturnValue({
      agents: [{ id: 'admin-1', name: 'Você', email: 'voce@dw.test', role: 'admin', active: true, sectors: [] }],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);
    expect(screen.queryByRole('button', { name: /gerar nova senha/i })).not.toBeInTheDocument();
  });

  // Fatia S0 (29/09): gerar senha pede confirmação, e a senha nova só sai da
  // tela por uma ação explícita.
  test('gerar nova senha pede confirmação com o nome e o aviso; cancelar não chama a API', async () => {
    useAgentsAdmin.mockReturnValue({ agents: [ANA], refresh: vi.fn() });
    render(<AgentsAdminTab />);

    await abrirAcao(/gerar nova senha/i);
    const dialogo = screen.getByRole('alertdialog', { name: 'Gerar nova senha para Ana?' });
    expect(dialogo).toHaveTextContent(/deixa de funcionar imediatamente/i);

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.resetAgentPassword).not.toHaveBeenCalled();
  });

  test('confirmar gera a senha uma vez e mostra num diálogo que não fecha por Escape nem clique fora', async () => {
    useAgentsAdmin.mockReturnValue({ agents: [ANA], refresh: vi.fn() });
    api.resetAgentPassword.mockResolvedValue({ newPassword: 'Xy9kFpQr2z' });
    render(<AgentsAdminTab />);

    await abrirAcao(/gerar nova senha/i);
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Gerar nova senha' }));

    const campo = await screen.findByDisplayValue('Xy9kFpQr2z');
    expect(api.resetAgentPassword).toHaveBeenCalledTimes(1);
    expect(api.resetAgentPassword).toHaveBeenCalledWith('a1', 'tok-123');

    fireEvent.keyDown(document, { key: 'Escape' });
    const fundo = screen.getByRole('alertdialog', { name: /nova senha de ana/i }).parentElement;
    ponteiro(fundo, 'pointerdown', 10, 10);
    ponteiro(fundo, 'pointerup', 11, 11);
    expect(campo).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^fechar$/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Já copiei a senha' }));
    expect(screen.queryByDisplayValue('Xy9kFpQr2z')).not.toBeInTheDocument();
  });

  test('gerando a senha: clique duplo não gera duas', async () => {
    useAgentsAdmin.mockReturnValue({ agents: [ANA], refresh: vi.fn() });
    api.resetAgentPassword.mockReturnValue(new Promise(() => {}));
    render(<AgentsAdminTab />);

    await abrirAcao(/gerar nova senha/i);
    const confirmar = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Gerar nova senha' });
    await userEvent.click(confirmar);
    await userEvent.click(confirmar);

    expect(api.resetAgentPassword).toHaveBeenCalledTimes(1);
    expect(confirmar).toHaveTextContent('Gerando senha…');
  });

  test('a senha nova continua na tela mesmo se a lista falhar ao reler', async () => {
    useAgentsAdmin.mockReturnValue({ agents: [ANA], status: 'ready', refresh: vi.fn() });
    api.resetAgentPassword.mockResolvedValue({ newPassword: 'Xy9kFpQr2z' });
    const { rerender } = render(<AgentsAdminTab />);

    await abrirAcao(/gerar nova senha/i);
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Gerar nova senha' }));
    await screen.findByDisplayValue('Xy9kFpQr2z');

    useAgentsAdmin.mockReturnValue({ agents: [ANA], status: 'error', refresh: vi.fn() });
    rerender(<AgentsAdminTab />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Xy9kFpQr2z')).toBeInTheDocument();
  });

  test('copiar a senha: sucesso avisa; falha diz o que fazer e a senha fica', async () => {
    const writeText = vi.fn().mockResolvedValueOnce().mockRejectedValueOnce(new Error('negado'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    useAgentsAdmin.mockReturnValue({ agents: [ANA], refresh: vi.fn() });
    api.resetAgentPassword.mockResolvedValue({ newPassword: 'Xy9kFpQr2z' });
    render(<AgentsAdminTab />);

    await abrirAcao(/gerar nova senha/i);
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Gerar nova senha' }));
    await screen.findByDisplayValue('Xy9kFpQr2z');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copiar senha' })); });
    expect(writeText).toHaveBeenCalledWith('Xy9kFpQr2z');
    expect(screen.getByRole('status')).toHaveTextContent('Senha copiada.');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copiar senha' })); });
    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível copiar/i);
    expect(screen.getByDisplayValue('Xy9kFpQr2z')).toBeInTheDocument();
  });

  test('does not show the create-agent form until its button is clicked', () => {
    useAgentsAdmin.mockReturnValue({ agents: [], refresh: vi.fn() });
    render(<AgentsAdminTab />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /adicionar usuário/i })).toBeInTheDocument();
  });

  test('clicking Criar usuário reveals the create-agent form', async () => {
    useAgentsAdmin.mockReturnValue({ agents: [], refresh: vi.fn() });
    render(<AgentsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /adicionar usuário/i }));

    expect(await screen.findByRole('heading', { name: /adicionar usuário/i })).toBeInTheDocument();
  });

  test('canceling the create-agent form hides it again', async () => {
    useAgentsAdmin.mockReturnValue({ agents: [], refresh: vi.fn() });
    render(<AgentsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /adicionar usuário/i }));
    await userEvent.click(await screen.findByRole('button', { name: /cancelar/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /adicionar usuário/i })).toBeInTheDocument();
  });

  test('shows each agent\'s assigned sectors', () => {
    useAgentsAdmin.mockReturnValue({
      agents: [
        {
          id: 'a1',
          name: 'Ana',
          email: 'ana@dw.test',
          role: 'agent',
          active: true,
          sectors: [
            { id: 's1', name: 'Financeiro' },
            { id: 's2', name: 'Comercial' },
          ],
        },
      ],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);
    expect(screen.getByText(/Financeiro, Comercial/)).toBeInTheDocument();
  });

  test('shows "Nenhum setor" when an agent has no sectors', () => {
    useAgentsAdmin.mockReturnValue({
      agents: [{ id: 'a1', name: 'Ana', email: 'ana@dw.test', role: 'agent', active: true, sectors: [] }],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);
    expect(screen.getByText(/Nenhum setor/)).toBeInTheDocument();
  });

  test('editing sectors: toggling a checkbox and saving calls setAgentSectors and refreshes', async () => {
    const refresh = vi.fn();
    useAgentsAdmin.mockReturnValue({
      agents: [
        { id: 'a1', name: 'Ana', email: 'ana@dw.test', role: 'agent', active: true, sectors: [{ id: 's1', name: 'Financeiro' }] },
      ],
      refresh,
    });
    useSectors.mockReturnValue({
      sectors: [
        { id: 's1', name: 'Financeiro' },
        { id: 's2', name: 'Comercial' },
      ],
      refresh: vi.fn(),
    });
    api.setAgentSectors.mockResolvedValue({ ok: true });
    render(<AgentsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar setores/i }));
    await userEvent.click(screen.getByLabelText('Comercial'));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(api.setAgentSectors).toHaveBeenCalledWith('a1', ['s1', 's2'], 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('editing sectors: unchecking a checkbox and saving calls setAgentSectors with the sector removed', async () => {
    const refresh = vi.fn();
    useAgentsAdmin.mockReturnValue({
      agents: [
        { id: 'a1', name: 'Ana', email: 'ana@dw.test', role: 'agent', active: true, sectors: [{ id: 's1', name: 'Financeiro' }] },
      ],
      refresh,
    });
    useSectors.mockReturnValue({
      sectors: [
        { id: 's1', name: 'Financeiro' },
        { id: 's2', name: 'Comercial' },
      ],
      refresh: vi.fn(),
    });
    api.setAgentSectors.mockResolvedValue({ ok: true });
    render(<AgentsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar setores/i }));
    await userEvent.click(screen.getByLabelText('Financeiro'));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(api.setAgentSectors).toHaveBeenCalledWith('a1', [], 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('canceling sector edits discards unsaved changes', async () => {
    useAgentsAdmin.mockReturnValue({
      agents: [
        { id: 'a1', name: 'Ana', email: 'ana@dw.test', role: 'agent', active: true, sectors: [{ id: 's1', name: 'Financeiro' }] },
      ],
      refresh: vi.fn(),
    });
    useSectors.mockReturnValue({
      sectors: [
        { id: 's1', name: 'Financeiro' },
        { id: 's2', name: 'Comercial' },
      ],
      refresh: vi.fn(),
    });
    render(<AgentsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar setores/i }));
    await userEvent.click(screen.getByLabelText('Comercial'));
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    await userEvent.click(screen.getByRole('button', { name: /editar setores/i }));
    expect(screen.getByLabelText('Financeiro')).toBeChecked();
    expect(screen.getByLabelText('Comercial')).not.toBeChecked();
  });
});
