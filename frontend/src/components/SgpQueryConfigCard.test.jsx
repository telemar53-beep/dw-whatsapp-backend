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
  test('shows an empty form and requires a token when nothing is configured yet', async () => {
    useSgpQueryConfig.mockReturnValue({ config: { configured: false }, refresh: vi.fn() });
    render(<SgpQueryConfigCard />);

    await userEvent.type(screen.getByLabelText(/url de acesso ao sgp/i), 'https://x.example');
    await userEvent.type(screen.getByLabelText(/^app$/i), 'chatmix');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(api.updateSgpQueryConfig).not.toHaveBeenCalled();
    expect(screen.getByText(/token é obrigatório/i)).toBeInTheDocument();
  });

  test('shows only the last 4 characters of an already-saved token', () => {
    useSgpQueryConfig.mockReturnValue({
      config: { configured: true, baseUrl: 'https://x.example', app: 'chatmix', tokenLast4: '5c7a', enabled: true },
      refresh: vi.fn(),
    });
    render(<SgpQueryConfigCard />);
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

    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateSgpQueryConfig).toHaveBeenCalledWith(
        { baseUrl: 'https://x.example', app: 'chatmix', token: undefined, enabled: true },
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

    await userEvent.click(screen.getByRole('button', { name: /trocar token/i }));

    expect(screen.getByLabelText(/^token$/i)).toBeInTheDocument();
  });
});
