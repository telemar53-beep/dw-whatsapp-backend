import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SgpQueryConfigCard from './SgpQueryConfigCard';
import { useSgpQueryConfig } from '../hooks/useSgpQueryConfig';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useSgpQueryConfig');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('SgpQueryConfigCard', () => {
  test('shows a create button when nothing is configured yet', () => {
    useSgpQueryConfig.mockReturnValue({ config: { configured: false }, refresh: vi.fn() });
    render(<SgpQueryConfigCard />);

    expect(screen.getByRole('button', { name: /criar integração/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/url de acesso ao sgp/i)).not.toBeInTheDocument();
  });

  test('requires a token when creating a new configuration', async () => {
    useSgpQueryConfig.mockReturnValue({ config: { configured: false }, refresh: vi.fn() });
    render(<SgpQueryConfigCard />);

    await userEvent.click(screen.getByRole('button', { name: /criar integração/i }));
    await userEvent.type(screen.getByLabelText(/url de acesso ao sgp/i), 'https://x.example');
    await userEvent.type(screen.getByLabelText(/^app$/i), 'chatmix');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    expect(api.updateSgpQueryConfig).not.toHaveBeenCalled();
    expect(screen.getByText(/token é obrigatório/i)).toBeInTheDocument();
  });

  test('shows a closed summary with the base URL and status when already configured', () => {
    useSgpQueryConfig.mockReturnValue({
      config: { configured: true, baseUrl: 'https://x.example', app: 'chatmix', tokenLast4: '5c7a', enabled: true },
      refresh: vi.fn(),
    });
    render(<SgpQueryConfigCard />);

    expect(screen.getByText('https://x.example', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^editar$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/url de acesso ao sgp/i)).not.toBeInTheDocument();
  });

  test('shows only the last 4 characters of an already-saved token, once editing', async () => {
    useSgpQueryConfig.mockReturnValue({
      config: { configured: true, baseUrl: 'https://x.example', app: 'chatmix', tokenLast4: '5c7a', enabled: true },
      refresh: vi.fn(),
    });
    render(<SgpQueryConfigCard />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));

    expect(screen.getByText(/5c7a/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^token$/i)).not.toBeInTheDocument();
  });

  test('saves without a token when already configured', async () => {
    const refresh = vi.fn();
    useSgpQueryConfig.mockReturnValue({
      config: { configured: true, baseUrl: 'https://x.example', app: 'chatmix', tokenLast4: '5c7a', enabled: true },
      refresh,
    });
    api.updateSgpQueryConfig.mockResolvedValue({});
    render(<SgpQueryConfigCard />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() =>
      expect(api.updateSgpQueryConfig).toHaveBeenCalledWith(
        {
          baseUrl: 'https://x.example',
          app: 'chatmix',
          token: undefined,
          enabled: true,
          pixMerchantName: '',
          pixMerchantKey: '',
          pixMerchantKeyType: '',
        },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('lets the attendant reveal the token field to replace it', async () => {
    useSgpQueryConfig.mockReturnValue({
      config: { configured: true, baseUrl: 'https://x.example', app: 'chatmix', tokenLast4: '5c7a', enabled: true },
      refresh: vi.fn(),
    });
    render(<SgpQueryConfigCard />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    await userEvent.click(screen.getByRole('button', { name: /trocar token/i }));

    expect(screen.getByLabelText(/^token$/i)).toBeInTheDocument();
  });

  test('canceling the edit form discards unsaved changes and returns to the closed summary', async () => {
    useSgpQueryConfig.mockReturnValue({
      config: { configured: true, baseUrl: 'https://x.example', app: 'chatmix', tokenLast4: '5c7a', enabled: true },
      refresh: vi.fn(),
    });
    render(<SgpQueryConfigCard />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    const urlInput = screen.getByLabelText(/url de acesso ao sgp/i);
    await userEvent.clear(urlInput);
    await userEvent.type(urlInput, 'https://rascunho.example');
    await userEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    expect(screen.queryByLabelText(/url de acesso ao sgp/i)).not.toBeInTheDocument();
    expect(screen.getByText('https://x.example', { exact: false })).toBeInTheDocument();
  });

  test('canceling while creating discards the draft, so reopening starts blank', async () => {
    useSgpQueryConfig.mockReturnValue({ config: { configured: false }, refresh: vi.fn() });
    render(<SgpQueryConfigCard />);

    await userEvent.click(screen.getByRole('button', { name: /criar integração/i }));
    await userEvent.type(screen.getByLabelText(/url de acesso ao sgp/i), 'https://rascunho.example');
    await userEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    await userEvent.click(screen.getByRole('button', { name: /criar integração/i }));

    expect(screen.getByLabelText(/url de acesso ao sgp/i)).toHaveValue('');
  });
});

describe('SgpQueryConfigCard — recebedor Pix', () => {
  test('shows "não cadastrado" for the Pix receiver when none of the three fields are set', () => {
    useSgpQueryConfig.mockReturnValue({
      config: {
        configured: true,
        baseUrl: 'https://x.example',
        app: 'chatmix',
        tokenLast4: '5c7a',
        enabled: true,
        pixMerchantName: null,
        pixMerchantKey: null,
        pixMerchantKeyType: null,
      },
      refresh: vi.fn(),
    });
    render(<SgpQueryConfigCard />);

    expect(screen.getByText(/recebedor pix: não cadastrado/i)).toBeInTheDocument();
  });

  test('shows the Pix receiver summary when it comes filled in the config', () => {
    useSgpQueryConfig.mockReturnValue({
      config: {
        configured: true,
        baseUrl: 'https://x.example',
        app: 'chatmix',
        tokenLast4: '5c7a',
        enabled: true,
        pixMerchantName: 'DW Telecom',
        pixMerchantKey: '12345678000199',
        pixMerchantKeyType: 'CNPJ',
      },
      refresh: vi.fn(),
    });
    render(<SgpQueryConfigCard />);

    expect(screen.getByText(/recebedor pix: dw telecom · cnpj · 12345678000199/i)).toBeInTheDocument();
  });

  test('saving with only the merchant name filled shows the error and does not call the API', async () => {
    useSgpQueryConfig.mockReturnValue({
      config: {
        configured: true,
        baseUrl: 'https://x.example',
        app: 'chatmix',
        tokenLast4: '5c7a',
        enabled: true,
        pixMerchantName: null,
        pixMerchantKey: null,
        pixMerchantKeyType: null,
      },
      refresh: vi.fn(),
    });
    render(<SgpQueryConfigCard />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    await userEvent.type(screen.getByLabelText(/nome do recebedor/i), 'DW Telecom');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    expect(screen.getByText('Preencha nome, chave e tipo da chave Pix, ou deixe os três vazios')).toBeInTheDocument();
    expect(api.updateSgpQueryConfig).not.toHaveBeenCalled();
  });

  test('saving with all three Pix fields filled sends them to the API', async () => {
    const refresh = vi.fn();
    useSgpQueryConfig.mockReturnValue({
      config: {
        configured: true,
        baseUrl: 'https://x.example',
        app: 'chatmix',
        tokenLast4: '5c7a',
        enabled: true,
        pixMerchantName: null,
        pixMerchantKey: null,
        pixMerchantKeyType: null,
      },
      refresh,
    });
    api.updateSgpQueryConfig.mockResolvedValue({});
    render(<SgpQueryConfigCard />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    await userEvent.type(screen.getByLabelText(/nome do recebedor/i), 'DW Telecom');
    await userEvent.type(screen.getByLabelText(/chave pix da empresa/i), '12345678000199');
    await userEvent.selectOptions(screen.getByLabelText(/tipo da chave/i), 'CNPJ');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() =>
      expect(api.updateSgpQueryConfig).toHaveBeenCalledWith(
        {
          baseUrl: 'https://x.example',
          app: 'chatmix',
          token: undefined,
          enabled: true,
          pixMerchantName: 'DW Telecom',
          pixMerchantKey: '12345678000199',
          pixMerchantKeyType: 'CNPJ',
        },
        'tok-123'
      )
    );
    expect(refresh).toHaveBeenCalled();
  });
});
