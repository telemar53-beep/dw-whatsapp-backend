import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChangePasswordModal from './ChangePasswordModal';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('ChangePasswordModal', () => {
  test('changes the password and shows a success message', async () => {
    api.changePassword.mockResolvedValue({ ok: true });
    render(<ChangePasswordModal onClose={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/senha atual/i), 'oldpass123');
    await userEvent.type(screen.getByLabelText(/nova senha/i), 'newpass456');
    await userEvent.click(screen.getByRole('button', { name: /trocar senha/i }));

    await waitFor(() => expect(api.changePassword).toHaveBeenCalledWith('oldpass123', 'newpass456', 'tok-123'));
    expect(await screen.findByText(/sucesso/i)).toBeInTheDocument();
  });

  test('shows an error message when the current password is wrong', async () => {
    api.changePassword.mockRejectedValue({ body: { error: 'Current password is incorrect' } });
    render(<ChangePasswordModal onClose={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/senha atual/i), 'wrongpass');
    await userEvent.type(screen.getByLabelText(/nova senha/i), 'newpass456');
    await userEvent.click(screen.getByRole('button', { name: /trocar senha/i }));

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
  });

  test('calls onClose when Cancelar is clicked', async () => {
    const onClose = vi.fn();
    render(<ChangePasswordModal onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
