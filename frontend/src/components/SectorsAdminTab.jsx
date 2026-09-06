import { useState } from 'react';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import { updateSector, deleteSector } from '../services/api';
import CreateSectorForm from './CreateSectorForm';

function SectorRow({ sector, onSaved, onDeleted }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sector.name);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await updateSector(sector.id, { name }, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  function handleEditClick() {
    setName(sector.name);
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setName(sector.name);
    setError(null);
    setEditing(false);
  }

  async function handleDelete() {
    if (!window.confirm(`Excluir o setor "${sector.name}"?`)) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteSector(sector.id, token);
      onDeleted();
    } catch (err) {
      setDeleteError((err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={handleSave} className="space-y-2 rounded border border-gray-200 p-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            Salvar
          </button>
          <button type="button" onClick={handleCancel} className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700">
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium text-gray-800">{sector.name}</p>
        <div className="flex items-center gap-3">
          <button onClick={handleEditClick} className="text-sm text-blue-600 underline">
            Editar
          </button>
          <button onClick={handleDelete} disabled={deleting} className="text-sm text-red-600 underline disabled:opacity-50">
            Excluir
          </button>
        </div>
      </div>
      {deleteError && <p className="mt-1 text-sm text-red-600">{deleteError}</p>}
    </div>
  );
}

function SectorsAdminTab() {
  const { sectors, refresh } = useSectors();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {sectors.map((sector) => (
          <SectorRow key={sector.id} sector={sector} onSaved={refresh} onDeleted={refresh} />
        ))}
      </div>
      <CreateSectorForm onCreated={refresh} />
    </div>
  );
}

export default SectorsAdminTab;
