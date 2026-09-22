import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CitiesAdminTab from './CitiesAdminTab';
import { useCities, usePlaces } from '../hooks/useCities';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useCities');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  usePlaces.mockReturnValue({ places: [], status: 'ready', refresh: vi.fn() });
});

describe('CitiesAdminTab', () => {
  test('lists existing cities', () => {
    usePlaces.mockReturnValue({ status: 'ready', places: [{ id: 'city-1', name: 'Bahia' }], refresh: vi.fn() });
    render(<CitiesAdminTab />);

    expect(screen.getByText('Bahia')).toBeInTheDocument();
  });

  test('deleting a city asks for confirmation and calls deleteCity when accepted', async () => {
    const refresh = vi.fn();
    usePlaces.mockReturnValue({ status: 'ready', places: [{ id: 'city-1', name: 'Bahia' }], refresh });
    api.deleteCity.mockResolvedValue(undefined);
    render(<CitiesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(api.deleteCity).toHaveBeenCalledWith('city-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('does not delete when the confirmation is declined', async () => {
    usePlaces.mockReturnValue({ status: 'ready', places: [{ id: 'city-1', name: 'Bahia' }], refresh: vi.fn() });
    render(<CitiesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /cancelar/i }));

    expect(api.deleteCity).not.toHaveBeenCalled();
  });

  test('shows an error message when deleting fails', async () => {
    usePlaces.mockReturnValue({ status: 'ready', places: [{ id: 'city-1', name: 'Bahia' }], refresh: vi.fn() });
    api.deleteCity.mockRejectedValue({ body: { error: 'Falha ao excluir' } });
    render(<CitiesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Excluir' }));

    expect(await screen.findByText('Falha ao excluir')).toBeInTheDocument();
  });

  test('renders the create-city form', () => {
    usePlaces.mockReturnValue({ status: 'ready', places: [], refresh: vi.fn() });
    render(<CitiesAdminTab />);
    expect(screen.getByText(/Cadastrar nova cidade/)).toBeInTheDocument();
  });

  test('controlled: canceling the create-city form closes it without creating anything', async () => {
    usePlaces.mockReturnValue({ status: 'ready', places: [], refresh: vi.fn() });
    const onCreatingChange = vi.fn();
    render(<CitiesAdminTab creating onCreatingChange={onCreatingChange} />);

    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(onCreatingChange).toHaveBeenCalledWith(false);
    expect(api.createCity).not.toHaveBeenCalled();
  });
});

describe('CitiesAdminTab — lugares', () => {
  const MUNICIPIO = {
    id: 'm1', name: 'Candido Mendes', kind: 'city', parentId: null,
    sgpPop: null, active: true, served: true, note: '',
  };
  const POVOADO = {
    id: 'p1', name: 'Barao de Tromai', kind: 'locality', parentId: 'm1',
    sgpPop: 'Barao', active: true, served: false, note: '',
  };
  const LEGADO = {
    id: 'l1', name: 'Aurizona', kind: 'unclassified', parentId: null,
    sgpPop: null, active: true, served: false, note: '',
  };

  test('mostra tipo, municipio pai e POP', () => {
    usePlaces.mockReturnValue({ places: [MUNICIPIO, POVOADO], status: 'ready', refresh: vi.fn() });
    render(<CitiesAdminTab />);

    // Escopo na tabela: em modo nao controlado o formulario tambem esta na
    // tela, e as opcoes do select repetem os mesmos rotulos de tipo.
    const tabela = within(screen.getByRole('table'));
    expect(tabela.getByText('Barao de Tromai')).toBeInTheDocument();
    expect(tabela.getByText('Povoado / Localidade')).toBeInTheDocument();
    expect(tabela.getByText('Barao')).toBeInTheDocument();
    // O pai aparece na linha da localidade, nao na do municipio.
    const linha = tabela.getByText('Barao de Tromai').closest('tr');
    expect(within(linha).getByText('Candido Mendes')).toBeInTheDocument();
  });

  test('registro legado aparece como Nao classificado, em vez de virar cidade', () => {
    usePlaces.mockReturnValue({ places: [LEGADO], status: 'ready', refresh: vi.fn() });
    render(<CitiesAdminTab />);

    const tabela = within(screen.getByRole('table'));
    expect(tabela.getByText('Não classificado')).toBeInTheDocument();
    expect(tabela.queryByText('Cidade / Município')).not.toBeInTheDocument();
  });

  test('sem POP mostra travessao', () => {
    usePlaces.mockReturnValue({ places: [MUNICIPIO], status: 'ready', refresh: vi.fn() });
    render(<CitiesAdminTab />);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  test('atendida e nao atendida sao distinguiveis', () => {
    usePlaces.mockReturnValue({ places: [MUNICIPIO, POVOADO], status: 'ready', refresh: vi.fn() });
    render(<CitiesAdminTab />);

    const tabela = within(screen.getByRole('table'));
    expect(tabela.getByText('Atendida')).toBeInTheDocument();
    expect(tabela.getByText('A verificar')).toBeInTheDocument();
  });

  test('editar abre o formulario com o registro da linha', async () => {
    usePlaces.mockReturnValue({ places: [POVOADO, MUNICIPIO], status: 'ready', refresh: vi.fn() });
    render(<CitiesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar barao de tromai/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toHaveValue('Barao de Tromai');
  });

  test('a busca acha pelo nome do municipio pai', async () => {
    usePlaces.mockReturnValue({ places: [MUNICIPIO, POVOADO], status: 'ready', refresh: vi.fn() });
    render(<CitiesAdminTab />);

    await userEvent.type(screen.getByRole('searchbox'), 'Candido');

    const tabela = within(screen.getByRole('table'));
    expect(tabela.getByText('Barao de Tromai')).toBeInTheDocument();
    // Duas vezes de proposito: a linha do municipio e a coluna Municipio do povoado.
    expect(tabela.getAllByText('Candido Mendes')).toHaveLength(2);
  });

  test('o 409 de excluir municipio com filha vira mensagem legivel', async () => {
    const refresh = vi.fn();
    usePlaces.mockReturnValue({ places: [MUNICIPIO], status: 'ready', refresh });
    api.deleteCity.mockRejectedValue({
      status: 409,
      body: { error: 'place has localities', dependencies: { filhas: 2 } },
    });
    render(<CitiesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Excluir' }));

    expect(await screen.findByText(/2 localidades/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
