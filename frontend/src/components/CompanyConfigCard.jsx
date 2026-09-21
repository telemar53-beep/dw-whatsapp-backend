import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCompanyConfig } from '../hooks/useCompanyConfig';
import { updateCompanyConfig } from '../services/api';
import { AsyncState, Button, Field } from './ui';
import { descreverErro } from '../utils/errorMessages';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-accent/60 focus:bg-wa-panel focus:ring-2 focus:ring-focus-ring/40';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';
const cardClass = 'settings-open-form grid items-start gap-3 px-0 pb-4 pt-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]';

// A textarea guarda um nome por linha; o backend recebe (e devolve) um array.
function linhasParaNomes(texto) {
  return texto
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);
}

function CompanyConfigCard() {
  const { token } = useAuth();
  const { config, status, refresh } = useCompanyConfig();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [payeeNames, setPayeeNames] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setName(config.name || '');
    setPayeeNames((config.acceptedPayeeNames || []).join('\n'));
  }, [config]);

  function handleEditClick() {
    setError(null);
    setName(config.name || '');
    setPayeeNames((config.acceptedPayeeNames || []).join('\n'));
    setEditing(true);
  }

  function handleCancel() {
    setName(config.name || '');
    setPayeeNames((config.acceptedPayeeNames || []).join('\n'));
    setError(null);
    setEditing(false);
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await updateCompanyConfig({ name: name.trim(), acceptedPayeeNames: linhasParaNomes(payeeNames) }, token);
      refresh();
      setEditing(false);
    } catch (err) {
      setError(descreverErro(err, 'Falha ao salvar'));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="settings-open-form border-b border-white/[0.09] px-0 pb-4 pt-2">
        <AsyncState status={status} skeletonLines={2}>
          <div className="settings-company-summary">
            <div className="settings-company-name"><p className="settings-cell-label font-medium text-wa-text">Empresa</p><h2>{config.name || 'Empresa não cadastrada'}</h2></div>
            <div className="settings-company-payees"><h3>Nomes aceitos no comprovante</h3>
              {(config.acceptedPayeeNames || []).length > 0 ? <ul>{config.acceptedPayeeNames.map((name,index) => <li key={index}>{name}</li>)}</ul> : <p>nenhum</p>}
            </div>
            {/* A aba tem vários "Editar": o rótulo acessível diz qual é este. */}
            <Button variant="secondary" size="sm" onClick={handleEditClick} aria-label="Editar dados da empresa">
              Editar
            </Button>
          </div>
        </AsyncState>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className={cardClass}>
      <h3 className="font-display text-base font-semibold text-wa-text lg:col-span-2">Empresa</h3>
      <Field
        id="company-name"
        label="Nome da empresa"
        width="md"
        help="Como aparece para o cliente: na tela de login, no chat e nas mensagens da IA."
      >
        <input id="company-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <div>
        <label htmlFor="company-payee-names" className={labelClass}>Nomes aceitos como favorecido no comprovante</label>
        <textarea
          id="company-payee-names"
          value={payeeNames}
          onChange={(e) => setPayeeNames(e.target.value)}
          rows={3}
          className={`${inputClass} min-h-[88px] max-h-60 resize-y [field-sizing:content]`}
        />
        <p className="mt-1 text-[12px] text-wa-muted">
          Um por linha. Escreva exatamente como aparece nos comprovantes de Pix e transferência: razão social, nome
          fantasia e o titular da conta que recebe. Sem isso, nenhum comprovante confere.
        </p>
      </div>
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text lg:col-span-2">{error}</p>}
      <div className="flex gap-2 lg:col-span-2">
        <Button variant="secondary" onClick={handleCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={saving}>
          Salvar
        </Button>
      </div>
    </form>
  );
}

export default CompanyConfigCard;
