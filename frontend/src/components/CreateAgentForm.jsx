import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createAgent } from '../services/api';

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
    <form onSubmit={handleSubmit} className="space-y-3 rounded border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-800">Cadastrar novo atendente</h3>
      <div>
        <label htmlFor="agent-name" className="mb-1 block text-sm text-gray-600">
          Nome
        </label>
        <input
          id="agent-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      <div>
        <label htmlFor="agent-email" className="mb-1 block text-sm text-gray-600">
          Email
        </label>
        <input
          id="agent-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      <div>
        <label htmlFor="agent-password" className="mb-1 block text-sm text-gray-600">
          Senha temporária
        </label>
        <input
          id="agent-password"
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      <div>
        <label htmlFor="agent-role" className="mb-1 block text-sm text-gray-600">
          Tipo
        </label>
        <select
          id="agent-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
        >
          <option value="agent">Atendente</option>
          <option value="admin">Administrador</option>
        </select>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
        Cadastrar
      </button>
    </form>
  );
}

export default CreateAgentForm;
