import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CitiesAdminTab from './CitiesAdminTab';
import { useCities } from '../hooks/useCities';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useCities');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CitiesAdminTab', () => {
  test('lists existing cities', () => {
    useCities.mockReturnValue({ cities: [{ id: 'city-1', name: 'Bahia' }], refresh: vi.fn() });
    render(<CitiesAdminTab />);

    expect(screen.getByText('Bahia')).toBeInTheDocument();
  });

  test('deleting a city asks for confirmation and calls deleteCity when accepted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const refresh = vi.fn();
    useCities.mockReturnValue({ cities: [{ id: 'city-1', name: 'Bahia' }], refresh });
    api.deleteCity.mockResolvedValue(undefined);
    render(<CitiesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    await waitFor(() => expect(api.deleteCity).toHaveBeenCalledWith('city-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('does not delete when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    useCities.mockReturnValue({ cities: [{ id: 'city-1', name: 'Bahia' }], refresh: vi.fn() });
    render(<CitiesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    expect(api.deleteCity).not.toHaveBeenCalled();
  });

  test('shows an error message when deleting fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useCities.mockReturnValue({ cities: [{ id: 'city-1', name: 'Bahia' }], refresh: vi.fn() });
    api.deleteCity.mockRejectedValue({ body: { error: 'Falha ao excluir' } });
    render(<CitiesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    expect(await screen.findByText('Falha ao excluir')).toBeInTheDocument();
  });

  test('renders the create-city form', () => {
    useCities.mockReturnValue({ cities: [], refresh: vi.fn() });
    render(<CitiesAdminTab />);
    expect(screen.getByText(/Cadastrar nova cidade/)).toBeInTheDocument();
  });
});
