import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditContactModal from './EditContactModal';
import { useAuth } from '../contexts/AuthContext';
import { useCities } from '../hooks/useCities';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useCities');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useCities.mockReturnValue({
    cities: [
      { id: 'city-1', name: 'Bahia' },
      { id: 'city-2', name: 'São Luís' },
    ],
    refresh: vi.fn(),
  });
});

const CONVERSATION = {
  id: 'conv-1',
  contactId: 'contact-1',
  contactDisplayName: 'Carlos',
  contactPhoneNumber: '+5511999990000',
  contactCityId: 'city-1',
};

describe('EditContactModal', () => {
  test('pre-fills the current name and city', () => {
    render(<EditContactModal conversation={CONVERSATION} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText(/nome/i)).toHaveValue('Carlos');
    expect(screen.getByLabelText(/cidade/i)).toHaveValue('city-1');
  });

  test('pre-fills with no city selected when the contact has none', () => {
    render(
      <EditContactModal conversation={{ ...CONVERSATION, contactCityId: null }} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    expect(screen.getByLabelText(/cidade/i)).toHaveValue('');
  });

  test('saving calls the API with the edited values, resolves the city name, then closes', async () => {
    api.updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Carlos Editado', cityId: 'city-2' });
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<EditContactModal conversation={CONVERSATION} onClose={onClose} onSaved={onSaved} />);

    await userEvent.clear(screen.getByLabelText(/nome/i));
    await userEvent.type(screen.getByLabelText(/nome/i), 'Carlos Editado');
    await userEvent.selectOptions(screen.getByLabelText(/cidade/i), 'city-2');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateContact).toHaveBeenCalledWith(
        'contact-1',
        { displayName: 'Carlos Editado', cityId: 'city-2' },
        'tok-123'
      )
    );
    expect(onSaved).toHaveBeenCalledWith({ displayName: 'Carlos Editado', cityName: 'São Luís' });
    expect(onClose).toHaveBeenCalled();
  });

  test('shows an error message and keeps the modal open when saving fails', async () => {
    api.updateContact.mockRejectedValue({ body: { error: 'Falha ao salvar' } });
    const onClose = vi.fn();
    render(<EditContactModal conversation={CONVERSATION} onClose={onClose} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(await screen.findByText('Falha ao salvar')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('clicking Cancelar closes the modal without saving', async () => {
    const onClose = vi.fn();
    render(<EditContactModal conversation={CONVERSATION} onClose={onClose} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(onClose).toHaveBeenCalled();
    expect(api.updateContact).not.toHaveBeenCalled();
  });
});
