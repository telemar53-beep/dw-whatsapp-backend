import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../hooks/useConfirm';
import { useTriage } from '../hooks/useTriage';
import { useSectors } from '../hooks/useSectors';
import { updateTriageOption, deleteTriageOption } from '../services/api';
import TriageConfigForm from './TriageConfigForm';
import CreateTriageOptionForm from './CreateTriageOptionForm';
import SectionHelp from './SectionHelp';
import { AsyncState, Field } from './ui';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-accent/60 focus:bg-wa-panel focus:ring-2 focus:ring-accent/25';

function TriageOptionRow({ option, onSaved, onDeleted }) {
  const { token } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const { sectors } = useSectors();
  const [editing, setEditing] = useState(false);
  const [optionNumber, setOptionNumber] = useState(String(option.optionNumber));
  const [sectorId, setSectorId] = useState(option.sectorId);
  const [keywords, setKeywords] = useState(option.keywords.join(', '));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  function handleEditClick() {
    setOptionNumber(String(option.optionNumber));
    setSectorId(option.sectorId);
    setKeywords(option.keywords.join(', '));
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setOptionNumber(String(option.optionNumber));
    setSectorId(option.sectorId);
    setKeywords(option.keywords.join(', '));
    setError(null);
    setEditing(false);
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const keywordList = keywords.split(',').map((k) => k.trim()).filter(Boolean);
      await updateTriageOption(option.id, { optionNumber: Number(optionNumber), sectorId, keywords: keywordList }, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    const ok = await confirm(`Excluir a opção ${option.optionNumber} (${option.sectorName})?`, { danger: true, confirmLabel: 'Excluir' });
    if (!ok) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteTriageOption(option.id, token);
      onDeleted();
    } catch (err) {
      setDeleteError((err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="space-y-3 rounded-[14px] border border-chat-orange/35 bg-white/[0.035] p-4"
      >
        <p className="text-[13px] font-semibold text-wa-text">Editar opção {option.optionNumber}</p>
        <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
          {/* Um digito de menu: largura de um digito. */}
          <Field id={`triage-option-number-${option.id}`} label="Número da opção" width="xs">
            <input
              id={`triage-option-number-${option.id}`}
              type="number"
              min="1"
              value={optionNumber}
              onChange={(e) => setOptionNumber(e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field id={`triage-option-sector-${option.id}`} label="Setor" width="md">
            <select
              id={`triage-option-sector-${option.id}`}
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              className={inputClass}
              required
            >
              {sectors.map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id={`triage-option-keywords-${option.id}`} label="Frases-gatilho">
          <input
            id={`triage-option-keywords-${option.id}`}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            className={inputClass}
            placeholder="financeiro, conta, fatura, boleto"
          />
        </Field>
        {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
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
    <div className="border-b border-white/[0.08] px-1 py-3.5 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-wa-text">
            {option.optionNumber} - {option.sectorName}
          </p>
          <p className="mt-0.5 break-words text-[12.5px] text-wa-muted">{option.keywords.join(', ') || 'Sem frases-gatilho'}</p>
        </div>
        <div className="flex items-center gap-3 self-start">
          <button onClick={handleEditClick} className="text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline">
            Editar
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-sm font-medium text-wa-error-text hover:text-wa-error-text hover:underline disabled:opacity-50"
          >
            Excluir
          </button>
        </div>
      </div>
      {deleteError && (
        <p className="mt-2 rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{deleteError}</p>
      )}
      {confirmDialog}
    </div>
  );
}

function TriageAdminTab({ creating: creatingProp, onCreatingChange } = {}) {
  const { config, options, status, refresh } = useTriage();
  const [internalCreatingOption, setInternalCreatingOption] = useState(false);
  const controlled = creatingProp !== undefined;
  const creatingOption = controlled ? creatingProp : internalCreatingOption;
  const setCreatingOption = controlled ? onCreatingChange : setInternalCreatingOption;

  return (
    <AsyncState status={status} skeletonLines={4}>
      {config && (
        <div className="settings-triage-menu-layout space-y-4">
          {options.length === 0 && (
            <p className="rounded-lg border border-wa-warn-text/30 bg-wa-warn-bg px-3 py-2 text-sm text-wa-warn-text">
              Nenhuma opção cadastrada: a triagem por menu não roda em nenhum canal, mesmo com o interruptor ligado.
            </p>
          )}
          <TriageConfigForm config={config} onSaved={refresh} />
          <section aria-label="Opções do menu" className="rounded-[16px] border border-white/[0.09] bg-[#2b343b]/95 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5">
              <div>
                <h3 className="font-display text-[16px] font-semibold text-wa-text">Opções do menu</h3>
                <p className="mt-0.5 text-[12.5px] text-wa-muted">Direcionamento por número ou frase-gatilho</p>
              </div>
              <div className="flex items-center gap-2">
              {!controlled && (
                <button
                  type="button"
                  onClick={() => setCreatingOption(true)}
                  className="rounded-lg border border-wa-border bg-wa-field px-3 py-1.5 text-sm font-medium text-wa-text transition hover:bg-wa-panel"
                >
                  Criar opção
                </button>
              )}
              <SectionHelp label="Triagem" title="Triagem">
                <p>
                  Cada opção é um item do menu automático mostrado ao cliente na primeira
                  mensagem. Ele escolhe pelo número ou digitando uma palavra-chave, e a
                  conversa entra direto na fila do setor certo.
                </p>
                <p className="mt-2 italic">
                  Exemplo: opção 1 → Financeiro, palavras-chave: fatura, boleto, conta,
                  pagamento.
                </p>
              </SectionHelp>
              </div>
            </div>
            {creatingOption && (
              <CreateTriageOptionForm
                onCreated={() => {
                  refresh();
                  setCreatingOption(false);
                }}
                onCancel={() => setCreatingOption(false)}
              />
            )}
          <div className="grid gap-x-5 lg:grid-cols-2">
            {options.map((option) => (
              <TriageOptionRow key={option.id} option={option} onSaved={refresh} onDeleted={refresh} />
            ))}
          </div>
          </section>
        </div>
      )}
    </AsyncState>
  );
}

export default TriageAdminTab;
