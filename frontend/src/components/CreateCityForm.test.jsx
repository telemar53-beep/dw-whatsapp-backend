import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateCityForm from './CreateCityForm';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CreateCityForm', () => {
  test('creates a city and calls onCreated', async () => {
    api.createCity.mockResolvedValue({ id: 'city-1', name: 'Bahia' });
    const onCreated = vi.fn();
    render(<CreateCityForm onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Bahia');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() => expect(api.createCity).toHaveBeenCalledWith({ name: 'Bahia' }, 'tok-123'));
    expect(onCreated).toHaveBeenCalled();
  });

  test('shows an error message when creation fails', async () => {
    api.createCity.mockRejectedValue({ body: { error: 'Falha ao cadastrar' } });
    render(<CreateCityForm onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Bahia');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    expect(await screen.findByText('Falha ao cadastrar')).toBeInTheDocument();
  });
});
