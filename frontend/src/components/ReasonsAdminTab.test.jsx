import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReasonsAdminTab from './ReasonsAdminTab';
import { useReasonsAdmin } from '../hooks/useReasonsAdmin';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useReasonsAdmin');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('ReasonsAdminTab', () => {
  test('lists existing reasons', () => {
    useReasonsAdmin.mockReturnValue({
      reasons: [{ id: 'r1', name: 'Troca de senha', active: true }],
      refresh: vi.fn(),
    });
    render(<ReasonsAdminTab />);
    expect(screen.getByText('Troca de senha')).toBeInTheDocument();
  });

  test('creating a reason calls createReason and refreshes', async () => {
    const refresh = vi.fn();
    useReasonsAdmin.mockReturnValue({ reasons: [], refresh });
    api.createReason.mockResolvedValue({ id: 'r1', name: 'Pagamento', active: true });
    render(<ReasonsAdminTab />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Pagamento');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    expect(api.createReason).toHaveBeenCalledWith({ name: 'Pagamento' }, 'tok-123');
    expect(refresh).toHaveBeenCalled();
  });

  test('toggling active calls updateReason with the flipped value and refreshes', async () => {
    const refresh = vi.fn();
    useReasonsAdmin.mockReturnValue({
      reasons: [{ id: 'r1', name: 'Troca de senha', active: true }],
      refresh,
    });
    api.updateReason.mockResolvedValue({ id: 'r1', name: 'Troca de senha', active: false });
    render(<ReasonsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /desativar/i }));

    expect(api.updateReason).toHaveBeenCalledWith('r1', { active: false }, 'tok-123');
    expect(refresh).toHaveBeenCalled();
  });

  test('shows Ativar for an inactive reason', () => {
    useReasonsAdmin.mockReturnValue({
      reasons: [{ id: 'r1', name: 'Antigo', active: false }],
      refresh: vi.fn(),
    });
    render(<ReasonsAdminTab />);
    expect(screen.getByRole('button', { name: /ativar/i })).toBeInTheDocument();
  });

  test('editing a reason calls updateReason with the new name and refreshes', async () => {
    const refresh = vi.fn();
    useReasonsAdmin.mockReturnValue({
      reasons: [{ id: 'r1', name: 'Original', active: true }],
      refresh,
    });
    api.updateReason.mockResolvedValue({ id: 'r1', name: 'Editado', active: true });
    render(<ReasonsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const input = screen.getByDisplayValue('Original');
    await userEvent.clear(input);
    await userEvent.type(input, 'Editado');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(api.updateReason).toHaveBeenCalledWith('r1', { name: 'Editado' }, 'tok-123');
    expect(refresh).toHaveBeenCalled();
  });
});
