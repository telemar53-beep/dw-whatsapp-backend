import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { changePassword } from '../services/api';
import WaDialog, { waInputClass, waLabelClass, waPrimaryButtonClass, waGhostButtonClass, waErrorClass } from './WaDialog';

function ChangePasswordModal({ onClose }) {
  const { token } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword, token);
      setSuccess(true);
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao trocar senha');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <WaDialog title="Trocar minha senha" onClose={onClose} size="max-w-sm">
      {success ? (
        <>
          <p className="px-6 py-3 text-[14.5px] leading-[20px] text-wa-muted">Senha alterada com sucesso.</p>
          <div className="flex shrink-0 justify-end px-4 py-3">
            <button onClick={onClose} className={waPrimaryButtonClass}>
              Fechar
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="wa-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-3">
            <div>
              <label htmlFor="current-password" className={waLabelClass}>
                Senha atual
              </label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={waInputClass}
                required
              />
            </div>
            <div>
              <label htmlFor="new-password" className={waLabelClass}>
                Nova senha
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={waInputClass}
                required
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className={waLabelClass}>
                Confirmar nova senha
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={waInputClass}
                required
              />
            </div>
            {error && <p className={waErrorClass}>{error}</p>}
          </div>
          <div className="flex shrink-0 justify-end gap-2 px-4 py-3">
            <button type="button" onClick={onClose} className={waGhostButtonClass}>
              Cancelar
            </button>
            <button type="submit" disabled={submitting} className={waPrimaryButtonClass}>
              Trocar senha
            </button>
          </div>
        </form>
      )}
    </WaDialog>
  );
}

export default ChangePasswordModal;
