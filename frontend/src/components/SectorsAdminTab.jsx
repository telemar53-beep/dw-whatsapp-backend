import { useState } from 'react';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../hooks/useConfirm';
import { updateSector, deleteSector } from '../services/api';
import CreateSectorForm from './CreateSectorForm';
import WaDialog, { waErrorClass } from './WaDialog';
import { AsyncState, Button, CABECALHO, CELULA, DataTable, inputClass } from './ui';

// Escala de raio da seção: cartão 16 > controle 12 > botão de linha 10.
const SMALL_BTN =
  'inline-flex h-8 shrink-0 items-center justify-center rounded-[10px] border px-3 text-[13px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-50';

function SectorRow({ sector, onSaved, onDeleted }) {
  const { token } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sector.name);
  const [aiHint, setAiHint] = useState(sector.aiHint || '');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await updateSector(sector.id, { name, aiHint }, token);
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
    setAiHint(sector.aiHint || '');
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setName(sector.name);
    setAiHint(sector.aiHint || '');
    setError(null);
    setEditing(false);
  }

  async function handleDelete() {
    const question = 'Excluir o setor "' + sector.name + '"?';
    const ok = await confirm(question, { danger: true, confirmLabel: 'Excluir' });
    if (!ok) {
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
      <tr className="border-t border-wa-border bg-black/[0.12]">
        <td colSpan={3} className="px-4 pb-4 pt-3">
          <form onSubmit={handleSave} className="max-w-[640px] space-y-3">
            <div>
              <label htmlFor={`sector-name-${sector.id}`} className="mb-1.5 block text-[13px] font-medium text-wa-muted">
                Nome
              </label>
              <input
                id={`sector-name-${sector.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label htmlFor={`sector-ai-hint-${sector.id}`} className="mb-1.5 block text-[13px] font-medium text-wa-muted">
                Orientação para a IA
              </label>
              <textarea
                id={`sector-ai-hint-${sector.id}`}
                rows={3}
                value={aiHint}
                onChange={(e) => setAiHint(e.target.value)}
                className={inputClass}
              />
            </div>
            {error && <p className={waErrorClass}>{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" loading={submitting} className="!py-1.5">
                Salvar
              </Button>
              <Button variant="secondary" onClick={handleCancel} className="!py-1.5">
                Cancelar
              </Button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-wa-border">
      <td className={`${CELULA} whitespace-nowrap font-medium text-wa-text`}>{sector.name}</td>
      <td className={`${CELULA} max-w-[380px] text-wa-muted`}>
        <span className="block truncate" title={sector.aiHint || undefined}>
          {sector.aiHint || <span className="text-wa-meta">Sem orientação</span>}
        </span>
        {deleteError && <p className={`mt-2 ${waErrorClass}`}>{deleteError}</p>}
      </td>
      <td className={`${CELULA} whitespace-nowrap`}>
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={handleEditClick}>
            Editar
          </Button>
          <Button variant="danger" size="sm" onClick={handleDelete} loading={deleting}>
            Excluir
          </Button>
        </div>
        {confirmDialog}
      </td>
    </tr>
  );
}

// Controlado (a página passa `creating`): o cartão tem o botão "Adicionar setor"
// e o formulário abre num pop-up. Sem controle: o formulário fica inline embaixo.
function SectorsAdminTab({ creating: creatingProp, onCreatingChange } = {}) {
  const { sectors, status, refresh } = useSectors();
  const [internalCreating, setInternalCreating] = useState(false);
  const controlled = creatingProp !== undefined;
  const creating = controlled ? creatingProp : internalCreating;
  const setCreating = controlled ? onCreatingChange : setInternalCreating;

  return (
    <>
      <section
        aria-labelledby="sectors-card-title"
        className="overflow-clip"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 pb-4 pt-1">
          <div className="min-w-0">
            <h2 id="sectors-card-title" className="font-display text-[17px] font-semibold leading-[22px] text-wa-text">
              Setores
            </h2>
            <p className="mt-1 max-w-[60ch] text-[13.5px] leading-[19px] text-wa-muted">
              Os times para onde um atendimento pode ir. A orientação ajuda a IA a escolher o setor certo na triagem.
            </p>
          </div>
          {controlled && (
            <Button onClick={() => setCreating(true)} className="!py-2">
              Adicionar setor
            </Button>
          )}
        </div>

        <div className="settings-register-list overflow-hidden rounded-[15px] border border-wa-surface-line bg-wa-surface">
          <AsyncState status={status} isEmpty={sectors.length === 0} emptyMessage="Nenhum setor cadastrado ainda.">
            <DataTable>
                <thead>
                  <tr className="bg-black/[0.16]">
                    <th scope="col" className={CABECALHO}>
                      Nome
                    </th>
                    <th scope="col" className={CABECALHO}>
                      Orientação para a IA
                    </th>
                    <th scope="col" className={`${CABECALHO} text-right`}>
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sectors.map((sector) => (
                    <SectorRow key={sector.id} sector={sector} onSaved={refresh} onDeleted={refresh} />
                  ))}
                </tbody>
              </DataTable>
          </AsyncState>
        </div>

        <div className="px-1 py-3 text-[12.5px] text-wa-muted">
          {sectors.length} {sectors.length === 1 ? 'setor' : 'setores'}
        </div>
      </section>

      {controlled && creating && (
        <WaDialog variant="sector" title="Adicionar setor" onClose={() => setCreating(false)} size="max-w-md">
          <div className="px-6 pb-5 pt-2">
            <CreateSectorForm
              embedded
              onCreated={() => {
                refresh();
                setCreating(false);
              }}
              onCancel={() => setCreating(false)}
            />
          </div>
        </WaDialog>
      )}
      {!controlled && (
        <CreateSectorForm
          onCreated={() => {
            refresh();
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

export default SectorsAdminTab;
