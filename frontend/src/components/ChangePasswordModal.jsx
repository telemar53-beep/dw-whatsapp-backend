import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { changePassword } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-950/70';
const primaryButtonClass =
  'flex-1 rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 text-sm font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50';

function IconLock(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-white/70 bg-white/90 p-6 shadow-[0_30px_80px_-20px_rgba(15,35,60,0.45)] backdrop-blur-2xl">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-teal-signal/30 bg-teal-signal/10 text-teal-signal">
            <IconLock className="h-5 w-5" />
          </span>
          <h3 className="font-display text-lg font-semibold text-ink-950">Trocar minha senha</h3>
        </div>
        {success ? (
          <>
            <p className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-700">
              Senha alterada com sucesso.
            </p>
            <button onClick={onClose} className={primaryButtonClass}>
              Fechar
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="current-password" className={labelClass}>
                Senha atual
              </label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label htmlFor="new-password" className={labelClass}>
                Nova senha
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className={labelClass}>
                Confirmar nova senha
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
                required
              />
            </div>
            {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={submitting} className={primaryButtonClass}>
                Trocar senha
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-ink-950/15 bg-white/50 px-4 py-2.5 text-sm font-medium text-ink-950/70 transition hover:bg-white/80 hover:text-ink-950"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default ChangePasswordModal;
