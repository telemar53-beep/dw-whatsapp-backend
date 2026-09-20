import { useState, useEffect, useRef, useMemo } from 'react';
import { useReasonsAdmin } from '../hooks/useReasonsAdmin';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../hooks/useConfirm';
import { updateReason } from '../services/api';
import CreateReasonForm from './CreateReasonForm';
import WaDialog, { waErrorClass } from './WaDialog';
import { AsyncState, Button, CABECALHO, CELULA, DataTable, ITEM_DE_MENU, RowMenu, inputClass } from './ui';
import { IconSearch, IconNewChat, IconMore, IconEdit } from './icons/WaIcons';

const STATUS_OPTIONS = [
  ['all', 'Todos os status'],
  ['active', 'Ativos'],
  ['inactive', 'Inativos'],
];

// Escala de raio da seção: cartão 16 > controle 12 > botão de linha 10 > item de menu 8.
const CONTROL =
  'h-10 rounded-[12px] border border-wa-border bg-wa-field text-[13.5px] text-wa-text outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/25';
const LINK_BTN =
  'inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2 text-[13px] font-medium text-chat-orange transition hover:bg-wa-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

function StatusBadge({ active }) {
  return (
    <span
      className={`inline-flex items-center rounded-[8px] px-2.5 py-[3px] text-[12.5px] font-medium ${
        active ? 'bg-[#1f8f4e] text-white' : 'bg-white/[0.08] text-wa-muted'
      }`}
    >
      {active ? 'Ativo' : 'Inativo'}
    </span>
  );
}

// Botão de reticências com um pop-up de ações; fecha ao clicar fora, no Esc ou ao escolher.
function ReasonRow({ reason, usedByAi, onSaved }) {
  const { token } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(reason.name);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState(null);

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await updateReason(reason.id, { name }, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  function handleEditClick() {
    setName(reason.name);
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setName(reason.name);
    setError(null);
    setEditing(false);
  }

  async function handleToggleActive() {
    if (reason.active && usedByAi) {
      const ok = await confirm('A IA vai parar de encerrar sozinha até outro motivo ser escolhido. Desativar mesmo assim?', {
        danger: true,
        confirmLabel: 'Desativar mesmo assim',
      });
      if (!ok) return;
    }
    setToggling(true);
    setToggleError(null);
    try {
      await updateReason(reason.id, { active: !reason.active }, token);
      onSaved();
    } catch (err) {
      setToggleError((err.body && err.body.error) || 'Falha ao atualizar o motivo');
    } finally {
      setToggling(false);
    }
  }

  return (
    <>
      <tr className={`border-t border-wa-border ${reason.active ? '' : 'opacity-80'} ${usedByAi ? 'bg-chat-orange/[0.06]' : ''}`}>
        <td className={`${CELULA} text-[14px] font-medium text-wa-text`}>
          {reason.name}
          {toggleError && <p className={`mt-2 ${waErrorClass}`}>{toggleError}</p>}
        </td>
        <td className={`${CELULA} whitespace-nowrap`}>
          <StatusBadge active={reason.active} />
        </td>
        <td className={`${CELULA} whitespace-nowrap`}>
          {usedByAi ? (
            <span className="inline-flex items-center rounded-[8px] border border-chat-orange/40 bg-chat-orange/[0.14] px-2.5 py-[3px] text-[12.5px] font-medium text-chat-orange">
              Encerramento pela IA
            </span>
          ) : (
            <span className="text-[13.5px] text-wa-muted">Encerramento</span>
          )}
        </td>
        <td className={`${CELULA} whitespace-nowrap`}>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={handleEditClick} aria-expanded={editing}>
              <IconEdit size={15} />
              Editar
            </Button>
            <RowMenu label={`Mais ações para ${reason.name}`}>
              <button type="button" onClick={handleToggleActive} disabled={toggling} className={ITEM_DE_MENU}>
                {reason.active ? 'Desativar' : 'Ativar'}
              </button>
            </RowMenu>
          </div>
          {confirmDialog}
        </td>
      </tr>
      {editing && (
        <tr className="bg-black/[0.12]">
          <td colSpan={4} className="px-4 pb-4 pt-3">
            <form onSubmit={handleSave} className="flex max-w-[560px] flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <label htmlFor={`reason-name-${reason.id}`} className="mb-1.5 block text-[13px] font-medium text-wa-muted">
                  Nome do motivo
                </label>
                <input id={`reason-name-${reason.id}`} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
              </div>
              <Button type="submit" loading={submitting} className="!py-2">
                Salvar
              </Button>
              <Button variant="secondary" onClick={handleCancel} className="!py-2">
                Cancelar
              </Button>
              {error && <p className={`w-full ${waErrorClass}`}>{error}</p>}
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

function ReasonsAdminTab({ creating: creatingProp, onCreatingChange, aiResolvedReasonId = null } = {}) {
  const { reasons, status, refresh } = useReasonsAdmin();
  const [internalCreating, setInternalCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [situation, setSituation] = useState('all');
  const controlled = creatingProp !== undefined;
  const creatingReason = controlled ? creatingProp : internalCreating;
  const setCreatingReason = controlled ? onCreatingChange : setInternalCreating;

  const term = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      reasons.filter((reason) => {
        if (situation === 'active' && !reason.active) return false;
        if (situation === 'inactive' && reason.active) return false;
        return !term || String(reason.name || '').toLowerCase().includes(term);
      }),
    [reasons, situation, term]
  );
  const countLabel =
    visible.length !== reasons.length
      ? `${visible.length} de ${reasons.length} motivos`
      : `${reasons.length} ${reasons.length === 1 ? 'motivo' : 'motivos'}`;

  return (
    <>
      <section
        aria-labelledby="reasons-card-title"
        className="overflow-clip"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 pt-1">
          <h2 id="reasons-card-title" className="font-display text-[17px] font-semibold leading-[22px] text-wa-text">
            Motivos de atendimento
          </h2>
          <Button onClick={() => setCreatingReason(true)} className="!py-2">
            <IconNewChat size={18} />
            Novo motivo
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 pb-4">
          <label
            className={`${CONTROL} flex min-w-[220px] flex-1 items-center gap-2.5 px-3.5 focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/25`}
          >
            <span className="shrink-0 text-wa-muted">
              <IconSearch size={17} />
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar motivo"
              aria-label="Buscar motivo"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-wa-muted"
            />
          </label>
          <select
            aria-label="Status"
            value={situation}
            onChange={(event) => setSituation(event.target.value)}
            className={`${CONTROL} px-3 pr-8`}
          >
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-register-summary flex flex-wrap items-center justify-between gap-2 px-1 py-3 text-[12.5px] text-wa-muted">
          <span>{countLabel}</span>
          <span>O motivo fica registrado no histórico e agrupado em Relatórios.</span>
        </div>
        <div className="settings-register-list overflow-hidden rounded-[15px] border border-wa-surface-line bg-wa-surface">
          <AsyncState status={status} isEmpty={reasons.length === 0} emptyMessage="Nenhum motivo cadastrado ainda.">
            <DataTable>
                <thead>
                  <tr className="bg-black/[0.16]">
                    <th scope="col" className={CABECALHO}>
                      Motivo
                    </th>
                    <th scope="col" className={CABECALHO}>
                      Situação
                    </th>
                    <th scope="col" className={CABECALHO}>
                      Uso
                    </th>
                    <th scope="col" className={`${CABECALHO} text-right`}>
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr className="border-t border-wa-border">
                      <td colSpan={4} className="px-3 py-6 text-center text-[13.5px] text-wa-muted">
                        Nenhum motivo com esse filtro.
                      </td>
                    </tr>
                  ) : (
                    visible.map((reason) => (
                      <ReasonRow key={reason.id} reason={reason} usedByAi={reason.id === aiResolvedReasonId} onSaved={refresh} />
                    ))
                  )}
                </tbody>
              </DataTable>
          </AsyncState>
        </div>


      </section>

      {creatingReason && (
        <WaDialog variant="reason" title="Novo motivo" onClose={() => setCreatingReason(false)} size="max-w-md">
          <div className="px-6 pb-5 pt-2">
            <CreateReasonForm
              embedded
              onCreated={() => {
                refresh();
                setCreatingReason(false);
              }}
              onCancel={() => setCreatingReason(false)}
            />
          </div>
        </WaDialog>
      )}
    </>
  );
}

export default ReasonsAdminTab;
