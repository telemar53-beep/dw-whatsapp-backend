import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditContactModal from './EditContactModal';
import { useAuth } from '../contexts/AuthContext';
import { usePlaces } from '../hooks/useCities';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useCities');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  // O modal passou a usar usePlaces: precisa da hierarquia para encadear
  // município e localidade. Os municípios de sempre continuam aqui.
  usePlaces.mockReturnValue({
    places: [
      { id: 'city-1', name: 'Bahia', kind: 'city', parentId: null },
      { id: 'city-2', name: 'São Luís', kind: 'city', parentId: null },
    ],
    status: 'ready',
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
    expect(screen.getByLabelText('Município')).toHaveValue('city-1');
  });

  test('pre-fills with no city selected when the contact has none', () => {
    render(
      <EditContactModal conversation={{ ...CONVERSATION, contactCityId: null }} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    expect(screen.getByLabelText('Município')).toHaveValue('');
  });

  test('pre-fills the internal note when the contact has one', () => {
    render(
      <EditContactModal
        conversation={{ ...CONVERSATION, contactInternalNote: 'Já reclamou 3x' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/nota interna/i)).toHaveValue('Já reclamou 3x');
  });

  test('pre-fills an empty internal note when the contact has none', () => {
    render(<EditContactModal conversation={CONVERSATION} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText(/nota interna/i)).toHaveValue('');
  });

  test('saving calls the API with the edited values, resolves the city name, then closes', async () => {
    api.updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Carlos Editado', cityId: 'city-2', internalNote: 'Cliente VIP' });
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<EditContactModal conversation={CONVERSATION} onClose={onClose} onSaved={onSaved} />);

    await userEvent.clear(screen.getByLabelText(/nome/i));
    await userEvent.type(screen.getByLabelText(/nome/i), 'Carlos Editado');
    await userEvent.selectOptions(screen.getByLabelText('Município'), 'city-2');
    await userEvent.type(screen.getByLabelText(/nota interna/i), 'Cliente VIP');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateContact).toHaveBeenCalledWith(
        'contact-1',
        { displayName: 'Carlos Editado', cityId: 'city-2', localityId: null, internalNote: 'Cliente VIP' },
        'tok-123'
      )
    );
    expect(onSaved).toHaveBeenCalledWith({
      displayName: 'Carlos Editado',
      cityId: 'city-2',
      cityName: 'São Luís',
      localityId: undefined,
      localityName: null,
      internalNote: 'Cliente VIP',
    });
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

  test('em carregamento, o seletor de cidade mostra "Carregando…" e fica desabilitado', () => {
    usePlaces.mockReturnValue({ places: [], status: 'loading', refresh: vi.fn() });
    render(<EditContactModal conversation={CONVERSATION} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByLabelText('Município')).toBeDisabled();
    expect(screen.getByLabelText('Localidade')).toBeDisabled();
    expect(screen.queryByText('Nenhum')).not.toBeInTheDocument();
  });
});

describe('EditContactModal — municipio e localidade', () => {
  const LUGARES = [
    { id: 'm1', name: 'Candido Mendes', kind: 'city', parentId: null },
    { id: 'm2', name: 'Carutapera', kind: 'city', parentId: null },
    { id: 'p1', name: 'Barao de Tromai', kind: 'locality', parentId: 'm1' },
    { id: 'l1', name: 'Aurizona', kind: 'unclassified', parentId: null },
  ];

  const CONVERSA = {
    contactId: 'c1', contactDisplayName: 'Ana',
    contactCityId: 'm1', contactLocalityId: null, contactInternalNote: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ token: 'tok-123' });
    usePlaces.mockReturnValue({ places: LUGARES, status: 'ready' });
  });

  test('o seletor de municipio nao oferece povoado, mas oferece o legado', () => {
    render(<EditContactModal conversation={CONVERSA} onClose={vi.fn()} onSaved={vi.fn()} />);

    const municipio = within(screen.getByLabelText('Município'));
    expect(municipio.getByRole('option', { name: 'Candido Mendes' })).toBeInTheDocument();
    expect(municipio.getByRole('option', { name: 'Aurizona' })).toBeInTheDocument();
    expect(municipio.queryByRole('option', { name: 'Barao de Tromai' })).not.toBeInTheDocument();
  });

  test('a localidade so oferece filhas do municipio escolhido', async () => {
    render(<EditContactModal conversation={CONVERSA} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(within(screen.getByLabelText('Localidade')).getByRole('option', { name: 'Barao de Tromai' }))
      .toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Município'), 'm2');

    expect(within(screen.getByLabelText('Localidade')).queryByRole('option', { name: 'Barao de Tromai' }))
      .not.toBeInTheDocument();
  });

  test('sem municipio, a localidade fica desabilitada', () => {
    render(
      <EditContactModal
        conversation={{ ...CONVERSA, contactCityId: null }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Localidade')).toBeDisabled();
  });

  test('trocar de municipio limpa a localidade escolhida', async () => {
    api.updateContact.mockResolvedValue({
      displayName: 'Ana', cityId: 'm2', localityId: null, internalNote: null,
    });
    render(
      <EditContactModal
        conversation={{ ...CONVERSA, contactLocalityId: 'p1' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText('Município'), 'm2');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(api.updateContact).toHaveBeenCalledWith(
      'c1',
      { displayName: 'Ana', cityId: 'm2', localityId: null, internalNote: null },
      'tok-123'
    ));
  });

  test('salva municipio e localidade juntos e devolve os dois nomes', async () => {
    api.updateContact.mockResolvedValue({
      displayName: 'Ana', cityId: 'm1', localityId: 'p1', internalNote: null,
    });
    const onSaved = vi.fn();
    render(<EditContactModal conversation={CONVERSA} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.selectOptions(screen.getByLabelText('Localidade'), 'p1');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      cityId: 'm1', cityName: 'Candido Mendes',
      localityId: 'p1', localityName: 'Barao de Tromai',
    })));
  });
});
