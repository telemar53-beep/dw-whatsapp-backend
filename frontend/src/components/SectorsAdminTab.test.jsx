import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SectorsAdminTab from './SectorsAdminTab';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useSectors');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('SectorsAdminTab', () => {
  test('lists existing sectors', () => {
    useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], refresh: vi.fn() });
    render(<SectorsAdminTab />);

    expect(screen.getByText('Financeiro')).toBeInTheDocument();
  });

  test('editing a sector calls updateSector and refreshes', async () => {
    const refresh = vi.fn();
    useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], refresh });
    api.updateSector.mockResolvedValue({ id: 'sector-1', name: 'Editado' });
    render(<SectorsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const nameInput = screen.getByDisplayValue('Financeiro');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Editado');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(api.updateSector).toHaveBeenCalledWith('sector-1', { name: 'Editado' }, 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('canceling an edit discards unsaved changes', async () => {
    useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], refresh: vi.fn() });
    render(<SectorsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const nameInput = screen.getByDisplayValue('Financeiro');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Rascunho abandonado');
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByDisplayValue('Financeiro')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Rascunho abandonado')).not.toBeInTheDocument();
  });

  test('deleting a sector asks for confirmation and calls deleteSector when accepted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const refresh = vi.fn();
    useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], refresh });
    api.deleteSector.mockResolvedValue(undefined);
    render(<SectorsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    await waitFor(() => expect(api.deleteSector).toHaveBeenCalledWith('sector-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('does not delete when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], refresh: vi.fn() });
    render(<SectorsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    expect(api.deleteSector).not.toHaveBeenCalled();
  });

  test('shows an error message when deleting fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], refresh: vi.fn() });
    api.deleteSector.mockRejectedValue({ body: { error: 'Falha ao excluir' } });
    render(<SectorsAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    expect(await screen.findByText('Falha ao excluir')).toBeInTheDocument();
  });

  test('renders the create-sector form', () => {
    useSectors.mockReturnValue({ sectors: [], refresh: vi.fn() });
    render(<SectorsAdminTab />);
    expect(screen.getByText(/Cadastrar novo setor/)).toBeInTheDocument();
  });
});
