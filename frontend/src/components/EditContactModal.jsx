import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCities } from '../hooks/useCities';
import { updateContact } from '../services/api';

function EditContactModal({ conversation, onClose, onSaved }) {
  const { token } = useAuth();
  const { cities } = useCities();
  const [displayName, setDisplayName] = useState(conversation.contactDisplayName || '');
  const [cityId, setCityId] = useState(conversation.contactCityId || '');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const updated = await updateContact(conversation.contactId, { displayName, cityId: cityId || null }, token);
      const cityName = updated.cityId ? cities.find((c) => c.id === updated.cityId)?.name || null : null;
      onSaved({ displayName: updated.displayName, cityName });
      onClose();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <div className="w-[90vw] max-w-80 rounded bg-white p-4 shadow">
        <h3 className="mb-3 font-semibold text-gray-800">Editar cliente</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="contact-name" className="mb-1 block text-sm text-gray-700">
              Nome
            </label>
            <input
              id="contact-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="contact-city" className="mb-1 block text-sm text-gray-700">
              Cidade
            </label>
            <select
              id="contact-city"
              value={cityId}
              onChange={(e) => setCityId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Nenhuma</option>
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded bg-blue-600 py-2 text-sm text-white disabled:opacity-50"
            >
              Salvar
            </button>
            <button type="button" onClick={onClose} className="flex-1 rounded bg-gray-200 py-2 text-sm text-gray-700">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EditContactModal;
