import { useState } from 'react';
import { useCities } from '../hooks/useCities';
import { useAuth } from '../contexts/AuthContext';
import { deleteCity } from '../services/api';
import CreateCityForm from './CreateCityForm';

function CityRow({ city, onDeleted }) {
  const { token } = useAuth();
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Excluir a cidade "${city.name}"?`)) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteCity(city.id, token);
      onDeleted();
    } catch (err) {
      setDeleteError((err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <p className="font-medium text-ink-950">{city.name}</p>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-sm font-medium text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
        >
          Excluir
        </button>
      </div>
      {deleteError && (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{deleteError}</p>
      )}
    </div>
  );
}

function CitiesAdminTab() {
  const { cities, refresh } = useCities();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {cities.map((city) => (
          <CityRow key={city.id} city={city} onDeleted={refresh} />
        ))}
      </div>
      <CreateCityForm onCreated={refresh} />
    </div>
  );
}

export default CitiesAdminTab;
