import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createChannel } from '../services/api';

function CreateChannelForm({ onCreated }) {
  const { token } = useAuth();
  const [type, setType] = useState('baileys');
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const payload =
      type === 'meta_cloud' ? { type, name, phoneNumber, phoneNumberId, accessToken, wabaId } : { type, name, phoneNumber };
    try {
      await createChannel(payload, token);
      setName('');
      setPhoneNumber('');
      setPhoneNumberId('');
      setAccessToken('');
      setWabaId('');
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar canal');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-800">Cadastrar novo canal</h3>
      <div>
        <label htmlFor="type" className="mb-1 block text-sm text-gray-600">
          Tipo
        </label>
        <select
          id="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
        >
          <option value="baileys">Baileys (não oficial)</option>
          <option value="meta_cloud">Meta Cloud (oficial)</option>
        </select>
      </div>
      <div>
        <label htmlFor="name" className="mb-1 block text-sm text-gray-600">
          Nome
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      <div>
        <label htmlFor="phoneNumber" className="mb-1 block text-sm text-gray-600">
          Telefone
        </label>
        <input
          id="phoneNumber"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="+5511999998888"
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      {type === 'meta_cloud' && (
        <>
          <div>
            <label htmlFor="phoneNumberId" className="mb-1 block text-sm text-gray-600">
              Phone Number ID
            </label>
            <input
              id="phoneNumberId"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
              required
            />
          </div>
          <div>
            <label htmlFor="accessToken" className="mb-1 block text-sm text-gray-600">
              Access Token
            </label>
            <input
              id="accessToken"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
              required
            />
          </div>
          <div>
            <label htmlFor="wabaId" className="mb-1 block text-sm text-gray-600">
              WABA ID
            </label>
            <input
              id="wabaId"
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
              required
            />
          </div>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
        Cadastrar
      </button>
    </form>
  );
}

export default CreateChannelForm;
