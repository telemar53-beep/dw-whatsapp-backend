import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createAgent } from '../services/api';
import { Button } from './ui';
import { descreverErro } from '../utils/errorMessages';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-accent/60 focus:bg-wa-panel focus:ring-2 focus:ring-focus-ring/40';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';

// `embedded`: dentro de um pop-up que já tem título e moldura — sem borda nem h3.
function CreateAgentForm({ onCreated, onCancel, embedded = false }) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('agent');
  const [canManageIntegrations, setCanManageIntegrations] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = { name, email, password, role };
      if (role === 'manager') {
        payload.canManageIntegrations = canManageIntegrations;
      }
      await createAgent(payload, token);
      setName('');
      setEmail('');
      setPassword('');
      setRole('agent');
      setCanManageIntegrations(false);
      onCreated();
    } catch (err) {
      setError(descreverErro(err, 'Falha ao cadastrar atendente'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={embedded ? 'space-y-3' : 'space-y-3 rounded-[16px] border border-wa-border bg-wa-surface p-5'}
    >
      {!embedded && <h3 className="text-[15px] font-medium text-wa-text">Cadastrar novo usuário</h3>}
      <div>
        <label htmlFor="agent-name" className={labelClass}>
          Nome
        </label>
        <input
          id="agent-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          required
        />
      </div>
      <div>
        <label htmlFor="agent-email" className={labelClass}>
          E-mail
        </label>
        <input
          id="agent-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          required
        />
      </div>
      <div>
        <label htmlFor="agent-password" className={labelClass}>
          Senha temporária
        </label>
        <input
          id="agent-password"
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
          required
        />
      </div>
      <div>
        <label htmlFor="agent-role" className={labelClass}>
          Tipo
        </label>
        <select
          id="agent-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className={inputClass}
        >
          <option value="agent">Atendente</option>
          <option value="manager">Gerente</option>
          <option value="admin">Administrador</option>
        </select>
      </div>
      {role === 'manager' && (
        <label className="flex items-center gap-2 text-sm text-wa-muted">
          <input
            type="checkbox"
            checked={canManageIntegrations}
            onChange={(e) => setCanManageIntegrations(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Pode gerenciar Canais e Integrações
        </label>
      )}
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
      <div className="flex gap-2">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" loading={submitting}>
          Cadastrar
        </Button>
      </div>
    </form>
  );
}

export default CreateAgentForm;
