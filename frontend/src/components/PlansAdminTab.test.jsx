import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlansAdminTab from './PlansAdminTab';
import { usePlans } from '../hooks/usePlans';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/usePlans');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

const PLANO = {
  id: 'p1', name: '500 Mega', speedMbps: 500, monthlyPrice: 100,
  installCondition: 'Gratis', active: true, sortOrder: 0, note: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('PlansAdminTab', () => {
  test('mostra o preco formatado em real brasileiro', () => {
    usePlans.mockReturnValue({ plans: [PLANO], status: 'ready', refresh: vi.fn() });
    render(<PlansAdminTab />);

    expect(screen.getByText('R$ 100,00')).toBeInTheDocument();
    expect(screen.getByText('500 Mbps')).toBeInTheDocument();
  });

  test('plano sem velocidade mostra tracinho, nunca zero', () => {
    usePlans.mockReturnValue({
      plans: [{ ...PLANO, name: 'TV', speedMbps: null }], status: 'ready', refresh: vi.fn(),
    });
    render(<PlansAdminTab />);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0 Mbps')).not.toBeInTheDocument();
  });

  test('plano inativo aparece marcado', () => {
    usePlans.mockReturnValue({
      plans: [{ ...PLANO, active: false }], status: 'ready', refresh: vi.fn(),
    });
    render(<PlansAdminTab />);

    expect(screen.getByText('Inativo')).toBeInTheDocument();
  });

  test('a observacao interna NAO aparece na tabela', () => {
    usePlans.mockReturnValue({
      plans: [{ ...PLANO, note: 'margem apertada' }], status: 'ready', refresh: vi.fn(),
    });
    render(<PlansAdminTab />);

    expect(screen.queryByText('margem apertada')).not.toBeInTheDocument();
  });

  test('excluir pede confirmacao e so entao chama a API', async () => {
    const refresh = vi.fn();
    usePlans.mockReturnValue({ plans: [PLANO], status: 'ready', refresh });
    api.deletePlan.mockResolvedValue(undefined);
    render(<PlansAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(api.deletePlan).toHaveBeenCalledWith('p1', 'tok-123'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  test('editar abre o formulario com o plano da linha', async () => {
    usePlans.mockReturnValue({ plans: [PLANO], status: 'ready', refresh: vi.fn() });
    render(<PlansAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toHaveValue('500 Mega');
  });

  test('a busca filtra por nome', async () => {
    usePlans.mockReturnValue({
      plans: [PLANO, { ...PLANO, id: 'p2', name: '800 Mega' }], status: 'ready', refresh: vi.fn(),
    });
    render(<PlansAdminTab />);

    await userEvent.type(screen.getByRole('searchbox'), '800');

    expect(screen.getByText('800 Mega')).toBeInTheDocument();
    expect(screen.queryByText('500 Mega')).not.toBeInTheDocument();
  });

  test('sem planos, o estado vazio explica o que fazer', () => {
    usePlans.mockReturnValue({ plans: [], status: 'ready', refresh: vi.fn() });
    render(<PlansAdminTab />);

    expect(screen.getByText(/nenhum plano cadastrado/i)).toBeInTheDocument();
  });
});
