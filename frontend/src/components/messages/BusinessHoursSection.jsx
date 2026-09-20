import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useBusinessHoursConfig } from '../../hooks/useBusinessHoursConfig';
import { updateBusinessHoursConfig } from '../../services/api';
import { inputClass, AsyncState, Field } from '../ui';
import CityStatusDot from './StatusDot';

function BusinessHoursSection() {
  const { token } = useAuth();
  const { config: fetchedConfig, status, refresh } = useBusinessHoursConfig();
  const [editing, setEditing] = useState(false);
  const [savedConfig, setSavedConfig] = useState(null);
  const config = savedConfig || fetchedConfig;
  const [enabled, setEnabled] = useState(config.enabled);
  const [startTime, setStartTime] = useState(config.startTime);
  const [endTime, setEndTime] = useState(config.endTime);
  const [message, setMessage] = useState(config.message);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  function handleEditClick() {
    setEnabled(config.enabled);
    setStartTime(config.startTime);
    setEndTime(config.endTime);
    setMessage(config.message);
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setEnabled(config.enabled);
    setStartTime(config.startTime);
    setEndTime(config.endTime);
    setMessage(config.message);
    setError(null);
    setEditing(false);
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const saved = await updateBusinessHoursConfig({ enabled, startTime, endTime, message }, token);
      setSavedConfig(saved);
      setEditing(false);
      refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="settings-open-form space-y-3 rounded-[16px] border border-white/[0.09] bg-[#2b343b]/95 p-4"
      >
        <div>
          <h2 className="font-display text-[16px] font-semibold text-wa-text">Editar horário de atendimento</h2>
          <p className="mt-1 text-[12.5px] text-wa-muted">Disponibilidade humana e aviso fora do expediente.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-wa-muted">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-accent" />
          Ativo
        </label>
        {/* Hora e quatro digitos: a largura e de hora, nao de campo de texto. */}
        <div className="flex flex-wrap gap-3">
          <Field id="business-hours-start" label="Hora de início" width="sm">
            <input
              id="business-hours-start"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field id="business-hours-end" label="Hora de fim" width="sm">
            <input
              id="business-hours-end"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={inputClass}
              required
            />
          </Field>
        </div>
        <Field id="business-hours-message" label="Mensagem">
          <textarea
            id="business-hours-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Nosso horário de atendimento é de segunda a sexta, das 08:00 às 18:00. Sua mensagem será respondida assim que possível."
            rows={2}
            className={`${inputClass} min-h-[72px] max-h-56 resize-y [field-sizing:content]`}
            required
          />
        </Field>
        {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-wa-border bg-wa-surface px-3 py-1.5 text-sm font-medium text-wa-muted transition hover:bg-wa-panel hover:text-wa-text"
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="rounded-[16px] border border-white/[0.09] bg-[#2b343b]/95 p-5">
      <AsyncState status={status} skeletonLines={2}>
        {config.id === null ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-display text-[16px] font-semibold text-wa-text">Horário de atendimento</h2><p className="mt-1 text-[13px] text-wa-muted">Nenhum horário configurado ainda.</p></div>
            <button onClick={handleEditClick} className="text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline">
              Criar horário de atendimento
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-display text-[16px] font-semibold text-wa-text">Horário de atendimento</h2><p className="mt-1 text-sm text-wa-muted">
              Das {config.startTime} às {config.endTime}, segunda a sexta
            </p></div>
            <div className="flex items-center gap-3">
              <CityStatusDot enabled={config.enabled} />
              <button onClick={handleEditClick} className="text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline">
                Editar
              </button>
            </div>
          </div>
        )}
      </AsyncState>
    </div>
  );
}

export default BusinessHoursSection;
