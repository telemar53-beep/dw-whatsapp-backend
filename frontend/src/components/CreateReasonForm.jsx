import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createReason } from '../services/api';
import { Button, Field } from './ui';
import { descreverErro } from '../utils/errorMessages';
import { DialogoDeFormulario, CampoDoFormulario } from '../pages/settings/formulario/DialogoDeFormulario';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-accent/60 focus:bg-wa-panel focus:ring-2 focus:ring-focus-ring/40';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';

// `comoDialogo`: o diálogo claro de Configurações (Fatia S3). Sem ele, o
// formulário solto de antes. Os dois modos enviam pela mesma função.
function CreateReasonForm({ onCreated, onCancel, comoDialogo = false }) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function enviar() {
    return createReason({ name }, token);
  }

  if (comoDialogo) {
    return (
      <DialogoDeFormulario
        titulo="Novo motivo"
        descricao="Registra como o atendimento terminou e aparece nos relatórios."
        acao="Adicionar motivo"
        andamento="Adicionando…"
        erroPadrao="Não foi possível adicionar o motivo. Verifique os dados e tente novamente."
        onEnviar={enviar}
        onConcluido={onCreated}
        onClose={onCancel}
      >
        <CampoDoFormulario id="reason-name" rotulo="Nome do motivo" inteiro>
          <input id="reason-name" className="mc-entrada" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Segunda via" autoComplete="off" required />
        </CampoDoFormulario>
      </DialogoDeFormulario>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await enviar();
      setName('');
      onCreated();
    } catch (err) {
      setError(descreverErro(err, 'Falha ao cadastrar motivo'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="settings-open-form space-y-4 rounded-[16px] border border-white/[0.09] bg-ui-surface-card/95 p-5"
    >
      <h3 className="font-display text-base font-semibold text-wa-text">Cadastrar novo motivo</h3>
      <div>
        <Field id="reason-name" label="Nome" width="md">
          <input id="reason-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
        </Field>
      </div>
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
      <div className="flex gap-2">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" loading={submitting}>
          Cadastrar
        </Button>
      </div>
    </form>
  );
}

export default CreateReasonForm;
