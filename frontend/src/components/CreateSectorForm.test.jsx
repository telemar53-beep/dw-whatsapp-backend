import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateSectorForm from './CreateSectorForm';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CreateSectorForm', () => {
  test('creates a sector and calls onCreated', async () => {
    api.createSector.mockResolvedValue({ id: 'sector-1', name: 'Financeiro' });
    const onCreated = vi.fn();
    render(<CreateSectorForm onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Financeiro');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() => expect(api.createSector).toHaveBeenCalledWith({ name: 'Financeiro' }, 'tok-123'));
    expect(onCreated).toHaveBeenCalled();
  });

  test('shows an error message when creation fails', async () => {
    api.createSector.mockRejectedValue({ body: { error: 'Falha ao cadastrar' } });
    render(<CreateSectorForm onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Financeiro');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    expect(await screen.findByText('Falha ao cadastrar')).toBeInTheDocument();
  });
});
