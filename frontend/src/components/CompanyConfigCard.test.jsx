import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CompanyConfigCard from './CompanyConfigCard';
import { useCompanyConfig } from '../hooks/useCompanyConfig';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useCompanyConfig');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

const CONFIG = { id: 'cfg-1', name: 'Provedor X', acceptedPayeeNames: ['Provedor X Ltda', 'Fulano de Tal'] };

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useCompanyConfig.mockReturnValue({ config: CONFIG, loading: false, refresh: vi.fn() });
});

describe('CompanyConfigCard', () => {
  test('mostra o nome cadastrado sem abrir o formulário', () => {
    render(<CompanyConfigCard />);
    expect(screen.getByText('Empresa')).toBeInTheDocument();
    expect(screen.getByText('Provedor X')).toBeInTheDocument();
    expect(screen.getByText(/Provedor X Ltda · Fulano de Tal/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/nome da empresa/i)).not.toBeInTheDocument();
  });

  test('sem nome cadastrado, avisa que a empresa não está configurada', () => {
    useCompanyConfig.mockReturnValue({ config: { id: null, name: '', acceptedPayeeNames: [] }, loading: false, refresh: vi.fn() });
    render(<CompanyConfigCard />);
    expect(screen.getByText(/não cadastrada/i)).toBeInTheDocument();
  });

  test('Editar abre o formulário já preenchido, com um nome de favorecido por linha', async () => {
    render(<CompanyConfigCard />);
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));

    expect(screen.getByLabelText(/nome da empresa/i)).toHaveValue('Provedor X');
    expect(screen.getByLabelText(/nomes aceitos como favorecido/i)).toHaveValue('Provedor X Ltda\nFulano de Tal');
  });

  // Sem nenhum nome aceito nenhum comprovante confere — o texto de ajuda é o
  // que evita o admin cadastrar só a razão social e achar que basta.
  test('explica que os nomes precisam ser iguais aos do comprovante', async () => {
    render(<CompanyConfigCard />);
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByText(/razão social, nome fantasia e o titular da conta que recebe/i)).toBeInTheDocument();
    expect(screen.getByText(/nenhum comprovante confere/i)).toBeInTheDocument();
  });

  test('salvar envia o nome e a lista, uma linha por nome, sem linhas vazias', async () => {
    const refresh = vi.fn();
    useCompanyConfig.mockReturnValue({ config: CONFIG, loading: false, refresh });
    api.updateCompanyConfig.mockResolvedValue(CONFIG);
    render(<CompanyConfigCard />);
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));

    await userEvent.clear(screen.getByLabelText(/nome da empresa/i));
    await userEvent.type(screen.getByLabelText(/nome da empresa/i), 'Provedor Y');
    await userEvent.clear(screen.getByLabelText(/nomes aceitos como favorecido/i));
    await userEvent.type(screen.getByLabelText(/nomes aceitos como favorecido/i), 'Y Ltda\n\n  Beltrano  \n');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateCompanyConfig).toHaveBeenCalledWith({ name: 'Provedor Y', acceptedPayeeNames: ['Y Ltda', 'Beltrano'] }, 'tok-123')
    );
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText(/nome da empresa/i)).not.toBeInTheDocument());
  });

  test('cancelar fecha o formulário sem chamar a API e descarta o rascunho', async () => {
    render(<CompanyConfigCard />);
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.type(screen.getByLabelText(/nome da empresa/i), ' rascunho');
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(api.updateCompanyConfig).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/nome da empresa/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByLabelText(/nome da empresa/i)).toHaveValue('Provedor X');
  });

  test('erro do backend aparece no cartão e o formulário continua aberto', async () => {
    api.updateCompanyConfig.mockRejectedValue({ body: { error: 'name must be a string with at most 80 characters' } });
    render(<CompanyConfigCard />);
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(await screen.findByText('name must be a string with at most 80 characters')).toBeInTheDocument();
    expect(screen.getByLabelText(/nome da empresa/i)).toBeInTheDocument();
  });
});
