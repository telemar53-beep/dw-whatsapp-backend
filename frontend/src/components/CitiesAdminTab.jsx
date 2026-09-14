import { useState } from 'react';
import { useCities } from '../hooks/useCities';
import { useAuth } from '../contexts/AuthContext';
import { deleteCity } from '../services/api';
import CreateCityForm from './CreateCityForm';
import { IconClose } from './icons/WaIcons';

// Cidade é só um nome com um botão de excluir — uma etiqueta cabe muito mais
// por linha do que um cartão inteiro, e com 20+ cidades isso é o que evita
// uma lista quilométrica.
function CityChip({ city, onDeleted, onError }) {
  const { token } = useAuth();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Excluir a cidade "${city.name}"?`)) {
      return;
    }
    onError(city.id, null);
    setDeleting(true);
    try {
      await deleteCity(city.id, token);
      onDeleted();
    } catch (err) {
      onError(city.id, (err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  return (
    <span className="group inline-flex items-center gap-1.5 rounded-full border border-wa-border bg-wa-surface py-1.5 pl-3.5 pr-2 text-[13.5px] text-wa-text transition-colors hover:border-wa-error-text/40">
      {city.name}
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        aria-label={`Excluir ${city.name}`}
        title={`Excluir ${city.name}`}
        className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-wa-muted transition-colors hover:bg-wa-error-bg hover:text-wa-error-text disabled:opacity-50"
      >
        <IconClose size={11} />
      </button>
    </span>
  );
}

function CitiesAdminTab() {
  const { cities, refresh } = useCities();
  const [errors, setErrors] = useState({});

  function setCityError(cityId, message) {
    setErrors((prev) => ({ ...prev, [cityId]: message }));
  }

  const errorMessages = Object.values(errors).filter(Boolean);

  return (
    <div className="space-y-5">
      {cities.length === 0 ? (
        <p className="text-[14px] text-wa-muted">Nenhuma cidade cadastrada ainda.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {cities.map((city) => (
            <CityChip key={city.id} city={city} onDeleted={refresh} onError={setCityError} />
          ))}
        </div>
      )}
      {errorMessages.map((message, index) => (
        <p key={index} className="rounded-[10px] border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-[13px] text-wa-error-text">
          {message}
        </p>
      ))}
      <CreateCityForm onCreated={refresh} />
    </div>
  );
}

export default CitiesAdminTab;
