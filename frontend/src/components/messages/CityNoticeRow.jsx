import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../hooks/useConfirm';
import { setCityNotice, deleteCityNotice } from '../../services/api';
import CityStatusDot from './StatusDot';
import { Button } from '../ui';
import { descreverErro } from '../../utils/errorMessages';

function CityNoticeRow({ city, onSaved }) {
  const { token } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState((city.notice && city.notice.message) || '');
  const [enabled, setEnabled] = useState(Boolean(city.notice && city.notice.enabled));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  function handleEditClick() {
    setText((city.notice && city.notice.message) || '');
    setEnabled(Boolean(city.notice && city.notice.enabled));
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setText((city.notice && city.notice.message) || '');
    setEnabled(Boolean(city.notice && city.notice.enabled));
    setError(null);
    setEditing(false);
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await setCityNotice(city.id, text, enabled, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(descreverErro(err, 'Falha ao salvar'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!(await confirm(`Remover o aviso da cidade "${city.name}"?`, { danger: true, confirmLabel: 'Remover' }))) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteCityNotice(city.id, token);
      onSaved();
    } catch (err) {
      setDeleteError(descreverErro(err, 'Falha ao excluir'));
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <li className="p-3.5">
        <form onSubmit={handleSave} className="space-y-2">
          <p className="text-[13.5px] font-medium text-wa-text">{city.name}</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="w-full rounded-[10px] border border-wa-border bg-wa-field px-3 py-2 text-[13.5px] text-wa-text placeholder-wa-muted outline-none transition focus:border-accent/60"
            required
          />
          <label className="flex items-center gap-2 text-[13px] text-wa-muted">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            Ativo
          </label>
          {error && <p className="rounded-[10px] border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-[13px] text-wa-error-text">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={handleCancel}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={saving}>
              Salvar
            </Button>
          </div>
        </form>
      </li>
    );
  }

  if (!city.notice) {
    return (
      <li className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <p className="truncate text-[13.5px] text-wa-text">{city.name}</p>
        <Button variant="ghost" size="sm" onClick={handleEditClick}>
          Criar aviso
        </Button>
      </li>
    );
  }

  return (
    <li className="px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium text-wa-text">{city.name}</p>
          <p className="truncate text-[12.5px] text-wa-muted">{city.notice.message}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <CityStatusDot enabled={city.notice.enabled} />
          <Button variant="ghost" size="sm" onClick={handleEditClick}>
            Editar
          </Button>
          <Button variant="danger" size="sm" onClick={handleDelete} loading={deleting}>
            Excluir
          </Button>
        </div>
      </div>
      {deleteError && (
        <p className="mt-2 rounded-[10px] border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-[12.5px] text-wa-error-text">{deleteError}</p>
      )}
      {confirmDialog}
    </li>
  );
}

export default CityNoticeRow;
