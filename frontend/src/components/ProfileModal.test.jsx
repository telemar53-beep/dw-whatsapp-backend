import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileModal from './ProfileModal';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', updateAgent: vi.fn() });
  api.getMyProfile.mockResolvedValue({ id: 'agent-1', name: 'Ana', email: 'ana@dw.com', phone: '11999998888', avatarPath: null, role: 'agent' });
});

describe('ProfileModal', () => {
  test('loads and shows the current profile', async () => {
    render(<ProfileModal onClose={vi.fn()} />);
    expect(await screen.findByDisplayValue('Ana')).toBeInTheDocument();
    expect(screen.getByDisplayValue('11999998888')).toBeInTheDocument();
    expect(screen.getByText('ana@dw.com')).toBeInTheDocument();
  });

  test('saves name and phone', async () => {
    api.updateMyProfile.mockResolvedValue({ id: 'agent-1', name: 'Ana Paula', email: 'ana@dw.com', phone: '11988887777', avatarPath: null, role: 'agent' });
    const onProfileUpdated = vi.fn();
    render(<ProfileModal onClose={vi.fn()} onProfileUpdated={onProfileUpdated} />);
    await screen.findByDisplayValue('Ana');

    await userEvent.clear(screen.getByLabelText(/nome completo/i));
    await userEvent.type(screen.getByLabelText(/nome completo/i), 'Ana Paula');
    await userEvent.clear(screen.getByLabelText(/telefone/i));
    await userEvent.type(screen.getByLabelText(/telefone/i), '11988887777');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith({ name: 'Ana Paula', phone: '11988887777' }, 'tok-123'));
    expect(onProfileUpdated).toHaveBeenCalled();
  });

  test('uploads a new avatar when a file is chosen', async () => {
    api.uploadMyAvatar.mockResolvedValue({ avatarPath: 'avatars/new.jpg' });
    const onProfileUpdated = vi.fn();
    render(<ProfileModal onClose={vi.fn()} onProfileUpdated={onProfileUpdated} />);
    await screen.findByDisplayValue('Ana');

    const file = new File(['fake-bytes'], 'foto.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText(/alterar foto/i), file);

    await waitFor(() => expect(api.uploadMyAvatar).toHaveBeenCalledWith(file, 'tok-123'));
    expect(onProfileUpdated).toHaveBeenCalled();
  });

  test('removes the avatar when Remover foto is clicked', async () => {
    api.getMyProfile.mockResolvedValue({ id: 'agent-1', name: 'Ana', email: 'ana@dw.com', phone: null, avatarPath: 'avatars/a1.jpg', role: 'agent' });
    api.deleteMyAvatar.mockResolvedValue({ ok: true });
    render(<ProfileModal onClose={vi.fn()} />);
    await screen.findByDisplayValue('Ana');

    await userEvent.click(screen.getByRole('button', { name: /remover foto/i }));

    await waitFor(() => expect(api.deleteMyAvatar).toHaveBeenCalledWith('tok-123'));
  });

  test('does not show Remover foto when there is no avatar', async () => {
    render(<ProfileModal onClose={vi.fn()} />);
    await screen.findByDisplayValue('Ana');
    expect(screen.queryByRole('button', { name: /remover foto/i })).not.toBeInTheDocument();
  });

  test('changes the password from the embedded section', async () => {
    api.changePassword.mockResolvedValue({ ok: true });
    render(<ProfileModal onClose={vi.fn()} />);
    await screen.findByDisplayValue('Ana');
    await userEvent.click(screen.getByText('Atualize sua senha de acesso.'));

    await userEvent.type(screen.getByLabelText(/senha atual/i), 'oldpass123');
    await userEvent.type(screen.getByLabelText(/^nova senha/i), 'newpass456');
    await userEvent.type(screen.getByLabelText(/confirmar nova senha/i), 'newpass456');
    await userEvent.click(screen.getByRole('button', { name: /trocar senha/i }));

    await waitFor(() => expect(api.changePassword).toHaveBeenCalledWith('oldpass123', 'newpass456', 'tok-123'));
    expect(await screen.findByText(/sucesso/i)).toBeInTheDocument();
  });

  test('shows an error when the confirmation password does not match', async () => {
    render(<ProfileModal onClose={vi.fn()} />);
    await screen.findByDisplayValue('Ana');
    await userEvent.click(screen.getByText('Atualize sua senha de acesso.'));

    await userEvent.type(screen.getByLabelText(/senha atual/i), 'oldpass123');
    await userEvent.type(screen.getByLabelText(/^nova senha/i), 'newpass456');
    await userEvent.type(screen.getByLabelText(/confirmar nova senha/i), 'somethingelse');
    await userEvent.click(screen.getByRole('button', { name: /trocar senha/i }));

    expect(await screen.findByText('As senhas não coincidem')).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  test('calls onClose when Cancelar is clicked', async () => {
    const onClose = vi.fn();
    render(<ProfileModal onClose={onClose} />);
    await screen.findByDisplayValue('Ana');
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onClose).toHaveBeenCalled();
  });

  test('shows an error and a working Fechar button when the initial profile fetch fails', async () => {
    api.getMyProfile.mockRejectedValue({ body: { error: 'Sessão expirada' } });
    const onClose = vi.fn();
    render(<ProfileModal onClose={onClose} />);

    const fecharButton = (await screen.findAllByRole('button', { name: /fechar/i })).find((b) => !b.hasAttribute('data-dialog-close'));
    expect(await screen.findByText('Sessão expirada')).toBeInTheDocument();

    await userEvent.click(fecharButton);
    expect(onClose).toHaveBeenCalled();
  });

  test('Tentar de novo recarrega o perfil depois da falha, sem perder a mensagem do servidor', async () => {
    api.getMyProfile.mockRejectedValueOnce({ body: { error: 'Sessão expirada' } });
    render(<ProfileModal onClose={vi.fn()} />);
    expect(await screen.findByText('Sessão expirada')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByDisplayValue('Ana')).toBeInTheDocument();
    expect(api.getMyProfile).toHaveBeenCalledTimes(2);
  });
});

describe('Meu perfil: estados e comportamento', () => {
  test('salvar diz "Salvando…" enquanto espera; o sucesso some na próxima edição (PRF-07, PRF-09)', async () => {
    let terminar;
    api.updateMyProfile.mockReturnValue(new Promise((r) => { terminar = r; }));
    render(<ProfileModal onClose={vi.fn()} />);
    await screen.findByDisplayValue('Ana');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
    terminar({ id: 'agent-1', name: 'Ana', email: 'ana@dw.com', phone: '11999998888', avatarPath: null, role: 'agent' });
    expect(await screen.findByText('Perfil atualizado.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/telefone/i), '1');
    expect(screen.queryByText('Perfil atualizado.')).not.toBeInTheDocument();
  });

  test('nome só com espaços: "Informe o nome." e nada é enviado (PRF-06/08)', async () => {
    render(<ProfileModal onClose={vi.fn()} />);
    await screen.findByDisplayValue('Ana');
    await userEvent.clear(screen.getByLabelText(/nome completo/i));
    await userEvent.type(screen.getByLabelText(/nome completo/i), '   ');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByText('Informe o nome.')).toBeInTheDocument();
    expect(api.updateMyProfile).not.toHaveBeenCalled();
  });

  test('enviar a foto mostra "Enviando foto…" (PRF-04)', async () => {
    let terminar;
    api.uploadMyAvatar.mockReturnValue(new Promise((r) => { terminar = r; }));
    render(<ProfileModal onClose={vi.fn()} />);
    await screen.findByDisplayValue('Ana');
    await userEvent.upload(screen.getByLabelText('Alterar foto'), new File(['x'], 'f.png', { type: 'image/png' }));
    expect(screen.getByText('Enviando foto…')).toBeInTheDocument();
    terminar({ avatarPath: 'b.jpg' });
    await waitFor(() => expect(screen.queryByText('Enviando foto…')).not.toBeInTheDocument());
  });

  test('fechar com edição pergunta antes; sem edição fecha direto (PRF-17)', async () => {
    const onClose = vi.fn();
    render(<ProfileModal onClose={onClose} />);
    await screen.findByDisplayValue('Ana');
    await userEvent.type(screen.getByLabelText(/telefone/i), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Continuar editando' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/telefone/i)).toHaveValue('119999988881');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Descartar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
