import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SgpLookupPanel from './SgpLookupPanel';
import { useSgpLookup } from '../hooks/useSgpLookup';
import QRCode from 'qrcode';

vi.mock('../hooks/useSgpLookup');
vi.mock('qrcode');

const BASE_HOOK = {
  client: null,
  contracts: [],
  loading: false,
  error: null,
  errorMessage: null,
  search: vi.fn(),
  fetchDuplicate: vi.fn(),
  duplicateState: {},
};

const CLIENT = { id: 1, name: 'Cliente Exemplo', document: '036.668.113-37' };
const CONTRACT_A = { id: 17402, status: 'Ativo', plan: '1GB' };
const CONTRACT_B = { id: 25439, status: 'Suspenso', plan: '600 Mega' };

const DUPLICATE = { id: '999', dueDate: '2026-09-20', value: 89.9, barCode: '836...', pixCode: '000201...', boletoLink: 'https://x' };

function renderPanel(onSendMessage = vi.fn()) {
  render(<SgpLookupPanel onSendMessage={onSendMessage} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  QRCode.toDataURL.mockResolvedValue('data:image/png;base64,FAKE');
});

describe('SgpLookupPanel — busca por CPF', () => {
  test('typing a CPF and submitting calls search with only digits', async () => {
    const search = vi.fn();
    useSgpLookup.mockReturnValue({ ...BASE_HOOK, search });
    renderPanel();

    await userEvent.type(screen.getByLabelText(/cpf do cliente/i), '036.668.113-37');
    await userEvent.click(screen.getByLabelText(/^buscar$/i));

    expect(search).toHaveBeenCalledWith('03666811337');
  });

  test('shows "cliente não encontrado" on a not_found error', () => {
    useSgpLookup.mockReturnValue({ ...BASE_HOOK, error: 'not_found' });
    renderPanel();
    expect(screen.getByText(/cliente não encontrado/i)).toBeInTheDocument();
  });

  test('shows the backend\'s real error message when present', () => {
    useSgpLookup.mockReturnValue({ ...BASE_HOOK, error: 'error', errorMessage: 'SGP integration is not configured' });
    renderPanel();
    expect(screen.getByText('SGP integration is not configured')).toBeInTheDocument();
  });
});

describe('SgpLookupPanel — seletor de contrato', () => {
  test('shows a dropdown with every contract and defaults to the first one\'s details', () => {
    useSgpLookup.mockReturnValue({ ...BASE_HOOK, client: CLIENT, contracts: [CONTRACT_A, CONTRACT_B] });
    renderPanel();

    const select = screen.getByLabelText(/^contrato$/i);
    expect(select).toHaveValue(String(CONTRACT_A.id));
    expect(screen.getByText('Cliente Exemplo')).toBeInTheDocument();
    expect(screen.getByText('1GB')).toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
    expect(screen.getByText('036.668.113-37')).toBeInTheDocument();
  });

  test('switching the dropdown shows the newly selected contract\'s details', async () => {
    useSgpLookup.mockReturnValue({ ...BASE_HOOK, client: CLIENT, contracts: [CONTRACT_A, CONTRACT_B] });
    renderPanel();

    await userEvent.selectOptions(screen.getByLabelText(/^contrato$/i), String(CONTRACT_B.id));

    expect(screen.getByText('600 Mega')).toBeInTheDocument();
    expect(screen.getByText('Suspenso')).toBeInTheDocument();
  });

  test('renders the selected contract\'s phones and emails when present', () => {
    useSgpLookup.mockReturnValue({
      ...BASE_HOOK,
      client: CLIENT,
      contracts: [{ ...CONTRACT_A, phones: ['(98) 98512-0338'], emails: ['exemplo@dominio.com'] }],
    });
    renderPanel();
    expect(screen.getByText('(98) 98512-0338')).toBeInTheDocument();
    expect(screen.getByText('exemplo@dominio.com')).toBeInTheDocument();
  });

  test('does not render a dropdown when there are no contracts', () => {
    useSgpLookup.mockReturnValue({ ...BASE_HOOK, client: CLIENT, contracts: [] });
    renderPanel();
    expect(screen.queryByLabelText(/^contrato$/i)).not.toBeInTheDocument();
  });
});

describe('SgpLookupPanel — card Financeiro', () => {
  test('starts with a button to fetch the open invoice, no automatic call', () => {
    useSgpLookup.mockReturnValue({ ...BASE_HOOK, client: CLIENT, contracts: [CONTRACT_A] });
    renderPanel();
    expect(BASE_HOOK.fetchDuplicate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /consultar fatura em aberto/i })).toBeInTheDocument();
  });

  test('clicking the button calls fetchDuplicate with the selected contract id', async () => {
    const fetchDuplicate = vi.fn();
    useSgpLookup.mockReturnValue({ ...BASE_HOOK, client: CLIENT, contracts: [CONTRACT_A], fetchDuplicate });
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: /consultar fatura em aberto/i }));

    expect(fetchDuplicate).toHaveBeenCalledWith(17402);
  });

  test('shows a loading state while fetching', () => {
    useSgpLookup.mockReturnValue({
      ...BASE_HOOK,
      client: CLIENT,
      contracts: [CONTRACT_A],
      duplicateState: { 17402: { loading: true, error: null } },
    });
    renderPanel();
    expect(screen.getByText(/consultando/i)).toBeInTheDocument();
  });

  test('shows "nenhuma fatura em aberto" when hasOpenInvoice is false', () => {
    useSgpLookup.mockReturnValue({
      ...BASE_HOOK,
      client: CLIENT,
      contracts: [CONTRACT_A],
      duplicateState: { 17402: { loading: false, error: null, hasOpenInvoice: false, duplicates: [] } },
    });
    renderPanel();
    expect(screen.getByText(/nenhuma fatura em aberto/i)).toBeInTheDocument();
  });

  test('shows the error message when fetching the invoice fails', () => {
    useSgpLookup.mockReturnValue({
      ...BASE_HOOK,
      client: CLIENT,
      contracts: [CONTRACT_A],
      duplicateState: { 17402: { loading: false, error: 'error', errorMessage: 'Failed to reach SGP' } },
    });
    renderPanel();
    expect(screen.getByText('Failed to reach SGP')).toBeInTheDocument();
  });

  function renderWithDuplicate(onSendMessage) {
    useSgpLookup.mockReturnValue({
      ...BASE_HOOK,
      client: CLIENT,
      contracts: [CONTRACT_A],
      duplicateState: { 17402: { loading: false, error: null, hasOpenInvoice: true, duplicates: [DUPLICATE] } },
    });
    renderPanel(onSendMessage);
  }

  test('shows vencimento, valor formatado e status da fatura', () => {
    renderWithDuplicate();
    expect(screen.getByText(/20\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/R\$ 89,90/)).toBeInTheDocument();
    expect(screen.getByText('Em aberto')).toBeInTheDocument();
  });

  test('clicking "Cód Pix" sends the raw pix code via the same sendMessage the chat input uses', async () => {
    const onSendMessage = vi.fn().mockResolvedValue({});
    renderWithDuplicate(onSendMessage);

    await userEvent.click(screen.getByRole('button', { name: /cód pix/i }));

    expect(onSendMessage).toHaveBeenCalledWith('000201...');
    expect(await screen.findByText(/enviado/i)).toBeInTheDocument();
  });

  test('clicking "Cód Barras" sends the raw bar code via the same sendMessage the chat input uses', async () => {
    const onSendMessage = vi.fn().mockResolvedValue({});
    renderWithDuplicate(onSendMessage);

    await userEvent.click(screen.getByRole('button', { name: /cód barras/i }));

    expect(onSendMessage).toHaveBeenCalledWith('836...');
    expect(await screen.findByText(/enviado/i)).toBeInTheDocument();
  });

  test('clicking "Link Fatura" sends the boleto link via the same sendMessage the chat input uses', async () => {
    const onSendMessage = vi.fn().mockResolvedValue({});
    renderWithDuplicate(onSendMessage);

    await userEvent.click(screen.getByRole('button', { name: /^link fatura$/i }));

    expect(onSendMessage).toHaveBeenCalledWith('https://x');
  });

  test('clicking "PDF Fatura" sends the same boleto link via the same sendMessage the chat input uses', async () => {
    const onSendMessage = vi.fn().mockResolvedValue({});
    renderWithDuplicate(onSendMessage);

    await userEvent.click(screen.getByRole('button', { name: /^pdf fatura$/i }));

    expect(onSendMessage).toHaveBeenCalledWith('https://x');
  });

  test('shows an error when sending the message fails', async () => {
    const onSendMessage = vi.fn().mockRejectedValue(new Error('network error'));
    renderWithDuplicate(onSendMessage);

    await userEvent.click(screen.getByRole('button', { name: /cód pix/i }));

    expect(await screen.findByText(/não foi possível enviar/i)).toBeInTheDocument();
  });

  test('clicking "QR Pix" generates and shows a QR code image from the pix code, clicking again hides it', async () => {
    renderWithDuplicate();

    await userEvent.click(screen.getByRole('button', { name: /qr pix/i }));

    expect(QRCode.toDataURL).toHaveBeenCalledWith('000201...');
    await waitFor(() => expect(screen.getByAltText(/qr code do pix/i)).toHaveAttribute('src', 'data:image/png;base64,FAKE'));

    await userEvent.click(screen.getByRole('button', { name: /qr pix/i }));
    expect(screen.queryByAltText(/qr code do pix/i)).not.toBeInTheDocument();
  });

  test('switching contracts resets the QR code image', async () => {
    useSgpLookup.mockReturnValue({
      ...BASE_HOOK,
      client: CLIENT,
      contracts: [CONTRACT_A, CONTRACT_B],
      duplicateState: {
        17402: { loading: false, error: null, hasOpenInvoice: true, duplicates: [DUPLICATE] },
        25439: { loading: false, error: null, hasOpenInvoice: true, duplicates: [{ ...DUPLICATE, id: '1000', pixCode: 'other-pix' }] },
      },
    });
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: /qr pix/i }));
    await waitFor(() => expect(screen.getByAltText(/qr code do pix/i)).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText(/^contrato$/i), String(CONTRACT_B.id));

    expect(screen.queryByAltText(/qr code do pix/i)).not.toBeInTheDocument();
  });
});
