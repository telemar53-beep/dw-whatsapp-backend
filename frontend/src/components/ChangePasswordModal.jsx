import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { changePassword } from '../services/api';

function ChangePasswordModal({ onClose }) {
  const { token } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
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
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <div className="w-80 rounded bg-white p-4 shadow">
        <h3 className="mb-3 font-semibold text-gray-800">Trocar minha senha</h3>
        {success ? (
          <>
            <p className="mb-3 text-sm text-green-600">Senha alterada com sucesso.</p>
            <button onClick={onClose} className="w-full rounded bg-blue-600 py-2 text-sm text-white">
              Fechar
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="current-password" className="mb-1 block text-sm text-gray-600">
                Senha atual
              </label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2"
                required
              />
            </div>
            <div>
              <label htmlFor="new-password" className="mb-1 block text-sm text-gray-600">
                Nova senha
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2"
                required
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded bg-blue-600 py-2 text-sm text-white disabled:opacity-50"
              >
                Trocar senha
              </button>
              <button type="button" onClick={onClose} className="flex-1 rounded bg-gray-200 py-2 text-sm text-gray-700">
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
