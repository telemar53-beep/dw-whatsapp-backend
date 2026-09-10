import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateChannelForm from './CreateChannelForm';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CreateChannelForm', () => {
  test('creates a baileys channel with just name and phone number', async () => {
    api.createChannel.mockResolvedValue({ id: 'ch1' });
    const onCreated = vi.fn();
    render(<CreateChannelForm type="baileys" onCreated={onCreated} />);

    expect(screen.queryByLabelText(/phone number id/i)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^nome/i), 'Vendas');
    await userEvent.type(screen.getByLabelText(/telefone/i), '+5511988887777');
    await userEvent.click(screen.getByRole('button', { name: /^cadastrar$/i }));

    await waitFor(() =>
      expect(api.createChannel).toHaveBeenCalledWith(
        { type: 'baileys', name: 'Vendas', phoneNumber: '+5511988887777' },
        'tok-123'
      )
    );
    expect(onCreated).toHaveBeenCalled();
  });

  test('shows the phoneNumberId, accessToken and wabaId fields for meta_cloud', () => {
    render(<CreateChannelForm type="meta_cloud" onCreated={vi.fn()} />);

    expect(screen.getByLabelText(/phone number id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/access token/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/waba id/i)).toBeInTheDocument();
  });

  test('creates a meta_cloud channel with all fields', async () => {
    api.createChannel.mockResolvedValue({ id: 'ch2' });
    render(<CreateChannelForm type="meta_cloud" onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/^nome/i), 'Suporte');
    await userEvent.type(screen.getByLabelText(/telefone/i), '+5511999990000');
    await userEvent.type(screen.getByLabelText(/phone number id/i), '123456');
    await userEvent.type(screen.getByLabelText(/access token/i), 'tok-meta');
    await userEvent.type(screen.getByLabelText(/waba id/i), 'waba-1');
    await userEvent.click(screen.getByRole('button', { name: /^cadastrar$/i }));

    await waitFor(() =>
      expect(api.createChannel).toHaveBeenCalledWith(
        {
          type: 'meta_cloud',
          name: 'Suporte',
          phoneNumber: '+5511999990000',
          phoneNumberId: '123456',
          accessToken: 'tok-meta',
          wabaId: 'waba-1',
        },
        'tok-123'
      )
    );
  });

  test('shows apiKey and wabaId fields only for type 360dialog', () => {
    render(<CreateChannelForm type="360dialog" onCreated={vi.fn()} />);

    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/waba id/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/phone number id/i)).not.toBeInTheDocument();
  });

  test('submits the 360dialog payload with apiKey and wabaId', async () => {
    api.createChannel.mockResolvedValue({ id: 'channel-9' });
    render(<CreateChannelForm type="360dialog" onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/^nome/i), 'Via BSP');
    await userEvent.type(screen.getByLabelText(/telefone/i), '+5511999990009');
    await userEvent.type(screen.getByLabelText(/api key/i), 'd360-key-abc');
    await userEvent.type(screen.getByLabelText(/waba id/i), 'waba-9');
    await userEvent.click(screen.getByRole('button', { name: /^cadastrar$/i }));

    await waitFor(() =>
      expect(api.createChannel).toHaveBeenCalledWith(
        {
          type: '360dialog',
          name: 'Via BSP',
          phoneNumber: '+5511999990009',
          apiKey: 'd360-key-abc',
          wabaId: 'waba-9',
        },
        'tok-123'
      )
    );
  });

  test('shows an error message when creation fails', async () => {
    api.createChannel.mockRejectedValue({ body: { error: 'Ja existe um canal com esse telefone' } });
    render(<CreateChannelForm type="baileys" onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/^nome/i), 'Vendas');
    await userEvent.type(screen.getByLabelText(/telefone/i), '+5511988887777');
    await userEvent.click(screen.getByRole('button', { name: /^cadastrar$/i }));

    expect(await screen.findByText('Ja existe um canal com esse telefone')).toBeInTheDocument();
  });

  test('clicking Cancel calls onCancel without creating', async () => {
    const onCancel = vi.fn();
    render(<CreateChannelForm type="baileys" onCreated={vi.fn()} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(onCancel).toHaveBeenCalled();
    expect(api.createChannel).not.toHaveBeenCalled();
  });
});
