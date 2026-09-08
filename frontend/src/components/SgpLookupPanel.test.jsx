import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SgpLookupPanel from './SgpLookupPanel';
import { useSgpLookup } from '../hooks/useSgpLookup';

vi.mock('../hooks/useSgpLookup');

const BASE_HOOK = {
  client: null,
  contracts: [],
  loading: false,
  error: null,
  search: vi.fn(),
  fetchDuplicate: vi.fn(),
  duplicateState: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SgpLookupPanel', () => {
  test('typing a CPF and submitting calls search with only digits', async () => {
    const search = vi.fn();
    useSgpLookup.mockReturnValue({ ...BASE_HOOK, search });
    render(<SgpLookupPanel />);

    await userEvent.type(screen.getByLabelText(/cpf do cliente/i), '036.668.113-37');
    await userEvent.click(screen.getByLabelText(/^buscar$/i));

    expect(search).toHaveBeenCalledWith('03666811337');
  });

  test('shows "cliente não encontrado" on a not_found error', () => {
    useSgpLookup.mockReturnValue({ ...BASE_HOOK, error: 'not_found' });
    render(<SgpLookupPanel />);
    expect(screen.getByText(/cliente não encontrado/i)).toBeInTheDocument();
  });

  test('renders the client and a card per contract', () => {
    useSgpLookup.mockReturnValue({
      ...BASE_HOOK,
      client: { id: 1, name: 'Cliente Exemplo', document: '036.668.113-37' },
      contracts: [{ id: 17402, status: 'Ativo', plan: '1GB', address: 'RUA EXEMPLO, 523' }],
    });
    render(<SgpLookupPanel />);
    expect(screen.getByText('Cliente Exemplo')).toBeInTheDocument();
    expect(screen.getByText(/1GB/)).toBeInTheDocument();
  });

  test('clicking "Gerar 2ª via + PIX" calls fetchDuplicate with the contract id', async () => {
    const fetchDuplicate = vi.fn();
    useSgpLookup.mockReturnValue({
      ...BASE_HOOK,
      client: { id: 1, name: 'Cliente Exemplo', document: '036.668.113-37' },
      contracts: [{ id: 17402, status: 'Ativo', plan: '1GB', address: 'RUA EXEMPLO' }],
      fetchDuplicate,
    });
    render(<SgpLookupPanel />);

    await userEvent.click(screen.getByRole('button', { name: /gerar 2ª via/i }));

    expect(fetchDuplicate).toHaveBeenCalledWith(17402);
  });

  test('shows the generated duplicate\'s bar code and PIX code', () => {
    useSgpLookup.mockReturnValue({
      ...BASE_HOOK,
      client: { id: 1, name: 'Cliente Exemplo', document: '036.668.113-37' },
      contracts: [{ id: 17402, status: 'Ativo', plan: '1GB', address: 'RUA EXEMPLO' }],
      duplicateState: { 17402: { loading: false, error: null, hasOpenInvoice: true, duplicates: [{ id: '999', dueDate: '2026-09-20', value: 89.9, barCode: '836...', pixCode: '000201...', boletoLink: 'https://x' }] } },
    });
    render(<SgpLookupPanel />);
    expect(screen.getByText('836...')).toBeInTheDocument();
    expect(screen.getByText('000201...')).toBeInTheDocument();
  });

  test('shows "nenhuma fatura em aberto" when hasOpenInvoice is false', () => {
    useSgpLookup.mockReturnValue({
      ...BASE_HOOK,
      client: { id: 1, name: 'Cliente Exemplo', document: '036.668.113-37' },
      contracts: [{ id: 17402, status: 'Ativo', plan: '1GB', address: 'RUA EXEMPLO' }],
      duplicateState: { 17402: { loading: false, error: null, hasOpenInvoice: false, duplicates: [] } },
    });
    render(<SgpLookupPanel />);
    expect(screen.getByText(/nenhuma fatura em aberto/i)).toBeInTheDocument();
  });
});
