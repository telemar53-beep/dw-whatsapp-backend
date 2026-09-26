import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
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
        { displayName: 'Carlos Editado', cityId: 'city-2', internalNote: 'Cliente VIP' },
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

    await userEvent.type(screen.getByLabelText(/nome/i), ' Silva');
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
      { cityId: 'm2', localityId: null },
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

// O modal pode fechar com o salvamento no caminho ("Cancelar", Esc ou a troca
// de conversa). A resposta que chega depois continua valendo para o contato de
// onde saiu — por isso o onSaved —, mas não fecha de novo: o onClose fecharia a
// edição que estiver aberta agora, talvez a de outro cliente.
describe('EditContactModal — resposta depois de fechar', () => {
  test('entrega o valor salvo, mas não chama onClose de novo', async () => {
    let responder;
    api.updateContact.mockReturnValue(new Promise((resolve) => { responder = resolve; }));
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const { unmount } = render(<EditContactModal conversation={CONVERSATION} onClose={onClose} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText(/nome/i), ' Silva');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => expect(api.updateContact).toHaveBeenCalled());
    unmount();
    await act(async () => {
      responder({ id: 'contact-1', displayName: 'Carlos', cityId: 'city-1', localityId: null, internalNote: null });
    });

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// A conversa da lista pode estar desatualizada (outra edição, outra aba). Só vai
// ao servidor o que mudou em relação ao que o modal recebeu ao abrir: reenviar
// um campo intocado — a nota, sobretudo — devolvia ao servidor um valor que
// outra edição já tinha trocado. A rota aplica só as chaves que chegam.
describe('EditContactModal — só vai ao servidor o que mudou', () => {
  // Os quatro campos preenchidos: qualquer um reenviado sem mudar aparece no payload.
  const COMPLETO = {
    id: 'conv-1',
    contactId: 'contact-1',
    contactDisplayName: 'Carlos',
    contactCityId: 'city-1',
    contactLocalityId: 'loc-1',
    contactInternalNote: 'Nota atual',
  };

  beforeEach(() => {
    usePlaces.mockReturnValue({
      places: [
        { id: 'city-1', name: 'Bahia', kind: 'city', parentId: null },
        { id: 'city-2', name: 'São Luís', kind: 'city', parentId: null },
        { id: 'loc-1', name: 'Localidade Um', kind: 'locality', parentId: 'city-1' },
        { id: 'loc-2', name: 'Localidade Dois', kind: 'locality', parentId: 'city-2' },
      ],
      status: 'ready',
      refresh: vi.fn(),
    });
    api.updateContact.mockReset();
    api.updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Carlos', cityId: 'city-1', localityId: 'loc-1', internalNote: 'Nota atual' });
  });

  const abrir = (props = {}) => render(<EditContactModal conversation={COMPLETO} onClose={vi.fn()} onSaved={vi.fn()} {...props} />);
  const salvar = () => userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
  async function escrever(rotulo, texto) {
    const campo = screen.getByLabelText(rotulo);
    await userEvent.clear(campo);
    if (texto) await userEvent.type(campo, texto);
  }
  const enviado = () => api.updateContact.mock.calls[0][1];

  test('editar só o nome envia só o nome', async () => {
    abrir();
    await escrever('Nome', 'Carlos Editado');
    await salvar();
    await waitFor(() => expect(api.updateContact).toHaveBeenCalledTimes(1));
    expect(enviado()).toEqual({ displayName: 'Carlos Editado' });
  });

  test('editar só a localização envia município e localidade, e não a nota', async () => {
    abrir();
    await userEvent.selectOptions(screen.getByLabelText('Município'), 'city-2');
    await userEvent.selectOptions(screen.getByLabelText('Localidade'), 'loc-2');
    await salvar();
    await waitFor(() => expect(api.updateContact).toHaveBeenCalledTimes(1));
    expect(enviado()).toEqual({ cityId: 'city-2', localityId: 'loc-2' });
  });

  test('editar a nota envia só a nota', async () => {
    abrir();
    await escrever('Nota interna', 'Nota nova');
    await salvar();
    await waitFor(() => expect(api.updateContact).toHaveBeenCalledTimes(1));
    expect(enviado()).toEqual({ internalNote: 'Nota nova' });
  });

  test('limpar a nota de propósito envia a limpeza', async () => {
    abrir();
    await escrever('Nota interna', '');
    await salvar();
    await waitFor(() => expect(api.updateContact).toHaveBeenCalledTimes(1));
    expect(enviado()).toEqual({ internalNote: null });
  });

  test('limpar o município de propósito envia município e localidade vazios', async () => {
    abrir();
    await userEvent.selectOptions(screen.getByLabelText('Município'), '');
    await salvar();
    await waitFor(() => expect(api.updateContact).toHaveBeenCalledTimes(1));
    expect(enviado()).toEqual({ cityId: null, localityId: null });
  });

  test('sem nada alterado — nem depois de mexer e desfazer —, salvar fecha sem PATCH', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    abrir({ onClose, onSaved });
    await escrever('Nome', 'Outro nome');
    await escrever('Nome', 'Carlos');
    await salvar();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.updateContact).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
