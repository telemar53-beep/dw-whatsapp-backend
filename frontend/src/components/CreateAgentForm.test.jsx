import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateAgentForm from './CreateAgentForm';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CreateAgentForm', () => {
  test('creates an agent with the default role', async () => {
    api.createAgent.mockResolvedValue({ id: 'a1' });
    const onCreated = vi.fn();
    render(<CreateAgentForm onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Ana Souza');
    await userEvent.type(screen.getByLabelText(/e-mail/i), 'ana@dw.com');
    await userEvent.type(screen.getByLabelText(/senha temporária/i), 'temp12345');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createAgent).toHaveBeenCalledWith(
        { name: 'Ana Souza', email: 'ana@dw.com', password: 'temp12345', role: 'agent' },
        'tok-123'
      )
    );
    expect(onCreated).toHaveBeenCalled();
  });

  test('creates an admin when the admin role is selected', async () => {
    api.createAgent.mockResolvedValue({ id: 'a2' });
    render(<CreateAgentForm onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Beto Lima');
    await userEvent.type(screen.getByLabelText(/e-mail/i), 'beto@dw.com');
    await userEvent.type(screen.getByLabelText(/senha temporária/i), 'temp67890');
    await userEvent.selectOptions(screen.getByLabelText(/tipo/i), 'admin');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createAgent).toHaveBeenCalledWith(
        { name: 'Beto Lima', email: 'beto@dw.com', password: 'temp67890', role: 'admin' },
        'tok-123'
      )
    );
  });

  test('does not show the integrations checkbox for the agent or admin role', () => {
    render(<CreateAgentForm onCreated={vi.fn()} />);
    expect(screen.queryByLabelText(/pode gerenciar canais e integrações/i)).not.toBeInTheDocument();
  });

  test('shows the integrations checkbox when the manager role is selected', async () => {
    render(<CreateAgentForm onCreated={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText(/tipo/i), 'manager');
    expect(screen.getByLabelText(/pode gerenciar canais e integrações/i)).toBeInTheDocument();
  });

  test('creates a manager with canManageIntegrations checked', async () => {
    api.createAgent.mockResolvedValue({ id: 'a3' });
    render(<CreateAgentForm onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Marcia Reis');
    await userEvent.type(screen.getByLabelText(/e-mail/i), 'marcia@dw.com');
    await userEvent.type(screen.getByLabelText(/senha temporária/i), 'temp11223');
    await userEvent.selectOptions(screen.getByLabelText(/tipo/i), 'manager');
    await userEvent.click(screen.getByLabelText(/pode gerenciar canais e integrações/i));
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createAgent).toHaveBeenCalledWith(
        { name: 'Marcia Reis', email: 'marcia@dw.com', password: 'temp11223', role: 'manager', canManageIntegrations: true },
        'tok-123'
      )
    );
  });

  test('creates a manager with canManageIntegrations false when the checkbox is left unchecked', async () => {
    api.createAgent.mockResolvedValue({ id: 'a4' });
    render(<CreateAgentForm onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Nilo Reis');
    await userEvent.type(screen.getByLabelText(/e-mail/i), 'nilo@dw.com');
    await userEvent.type(screen.getByLabelText(/senha temporária/i), 'temp44556');
    await userEvent.selectOptions(screen.getByLabelText(/tipo/i), 'manager');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createAgent).toHaveBeenCalledWith(
        { name: 'Nilo Reis', email: 'nilo@dw.com', password: 'temp44556', role: 'manager', canManageIntegrations: false },
        'tok-123'
      )
    );
  });

  test('shows an error message when creation fails', async () => {
    api.createAgent.mockRejectedValue({ body: { error: 'Já existe um atendente com esse email' } });
    render(<CreateAgentForm onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/nome/i), 'Ana Souza');
    await userEvent.type(screen.getByLabelText(/e-mail/i), 'ana@dw.com');
    await userEvent.type(screen.getByLabelText(/senha temporária/i), 'temp12345');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    expect(await screen.findByText('Já existe um atendente com esse email')).toBeInTheDocument();
  });

  test('clicking Cancel calls onCancel without submitting', async () => {
    const onCancel = vi.fn();
    render(<CreateAgentForm onCreated={vi.fn()} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(onCancel).toHaveBeenCalled();
    expect(api.createAgent).not.toHaveBeenCalled();
  });
});
