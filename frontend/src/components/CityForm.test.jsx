import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CityForm from './CityForm';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

const MUNICIPIO = { id: 'm1', name: 'Candido Mendes', kind: 'city', parentId: null };
const OUTRO = { id: 'm2', name: 'Carutapera', kind: 'city', parentId: null };

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CityForm', () => {
  test('criar cidade nao mostra o campo de municipio pai', () => {
    render(<CityForm place={null} places={[MUNICIPIO]} onSaved={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByLabelText('Município')).not.toBeInTheDocument();
  });

  test('escolher Povoado revela o municipio pai e envia parentId', async () => {
    api.createCity.mockResolvedValue({});
    render(<CityForm place={null} places={[MUNICIPIO]} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Nome'), 'Barao de Tromai');
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'locality');
    await userEvent.selectOptions(screen.getByLabelText('Município'), 'm1');
    await userEvent.type(screen.getByLabelText('POP do SGP'), 'Barao');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(api.createCity).toHaveBeenCalledWith(
      {
        name: 'Barao de Tromai', kind: 'locality', parentId: 'm1',
        sgpPop: 'Barao', active: true, served: false, note: '',
      },
      'tok-123'
    ));
  });

  test('POP em branco vai como null, nunca string vazia', async () => {
    api.createCity.mockResolvedValue({});
    render(<CityForm place={null} places={[MUNICIPIO]} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Nome'), 'Sem pop');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(api.createCity).toHaveBeenCalledWith(
      expect.objectContaining({ sgpPop: null }),
      'tok-123'
    ));
  });

  test('o seletor de municipio nao oferece localidades', async () => {
    const povoado = { id: 'p1', name: 'Povoado', kind: 'locality', parentId: 'm1' };
    render(<CityForm place={null} places={[MUNICIPIO, povoado]} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'locality');

    const select = screen.getByLabelText('Município');
    expect(select).toHaveTextContent('Candido Mendes');
    expect(select).not.toHaveTextContent('Povoado');
  });

  test('editar um registro legado mostra Nao classificado e exige escolher um tipo', async () => {
    const legado = {
      id: 'l1', name: 'Aurizona', kind: 'unclassified', parentId: null,
      sgpPop: null, active: true, served: false, note: '',
    };
    render(<CityForm place={legado} places={[MUNICIPIO]} onSaved={vi.fn()} onCancel={vi.fn()} />);

    const tipo = screen.getByLabelText('Tipo');
    expect(tipo).toHaveValue('');
    expect(within(tipo).getByRole('option', { name: 'Não classificado' })).toBeInTheDocument();
    expect(screen.getByText(/escolha o tipo para continuar/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });

  test('editar manda PATCH com o id, e nao cria outro registro', async () => {
    api.updateCity.mockResolvedValue({});
    const municipio = { ...MUNICIPIO, sgpPop: null, active: true, served: false, note: '' };
    render(<CityForm place={municipio} places={[MUNICIPIO]} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('Atendida'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(api.updateCity).toHaveBeenCalledWith(
      'm1', expect.objectContaining({ served: true }), 'tok-123'
    ));
    expect(api.createCity).not.toHaveBeenCalled();
  });

  test('o 409 de mudanca estrutural vira mensagem que nomeia o que impede', async () => {
    api.updateCity.mockRejectedValue({
      status: 409,
      body: {
        error: 'structural change blocked',
        dependencies: { contatosComoLocalidade: 24, contatosComoMunicipio: 0, filhas: 0, avisos: 0 },
      },
    });
    const povoado = {
      id: 'p1', name: 'Barao', kind: 'locality', parentId: 'm1',
      sgpPop: null, active: true, served: false, note: '',
    };
    render(<CityForm place={povoado} places={[MUNICIPIO, OUTRO]} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.selectOptions(screen.getByLabelText('Município'), 'm2');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/24 contatos/);
  });

  test('o 409 de POP repetido explica o conflito', async () => {
    api.createCity.mockRejectedValue({ status: 409, body: { error: 'sgpPop already in use' } });
    render(<CityForm place={null} places={[MUNICIPIO]} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Nome'), 'Repetido');
    await userEvent.type(screen.getByLabelText('POP do SGP'), 'Barao');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/POP/i);
  });
});
