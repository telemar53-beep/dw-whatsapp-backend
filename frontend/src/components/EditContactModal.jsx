import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCities } from '../hooks/useCities';
import { updateContact } from '../services/api';
import WaDialog, { waInputClass, waLabelClass, waPrimaryButtonClass, waGhostButtonClass, waErrorClass } from './WaDialog';

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
      onSaved({ displayName: updated.displayName, cityId: updated.cityId, cityName });
      onClose();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <WaDialog title="Editar cliente" onClose={onClose} size="max-w-sm">
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="wa-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-3">
          <div>
            <label htmlFor="contact-name" className={waLabelClass}>
              Nome
            </label>
            <input
              id="contact-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={waInputClass}
            />
          </div>
          <div>
            <label htmlFor="contact-city" className={waLabelClass}>
              Cidade
            </label>
            <select
              id="contact-city"
              value={cityId}
              onChange={(e) => setCityId(e.target.value)}
              className={waInputClass}
            >
              <option value="">Nenhuma</option>
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </div>
          {error && <p className={waErrorClass}>{error}</p>}
        </div>
        <div className="flex shrink-0 justify-end gap-2 px-4 py-3">
          <button type="button" onClick={onClose} className={waGhostButtonClass}>
            Cancelar
          </button>
          <button type="submit" disabled={submitting} className={waPrimaryButtonClass}>
            Salvar
          </button>
        </div>
      </form>
    </WaDialog>
  );
}

export default EditContactModal;
