import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createAgent } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-950/70';

function CreateAgentForm({ onCreated }) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('agent');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createAgent({ name, email, password, role }, token);
      setName('');
      setEmail('');
      setPassword('');
      setRole('agent');
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar atendente');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
    >
      <h3 className="font-display text-base font-semibold text-ink-950">Cadastrar novo atendente</h3>
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
          Email
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
          <option value="admin">Administrador</option>
        </select>
      </div>
      {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Cadastrar
      </button>
    </form>
  );
}

export default CreateAgentForm;
