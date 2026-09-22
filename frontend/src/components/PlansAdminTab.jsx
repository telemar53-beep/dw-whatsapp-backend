import { useState, useMemo } from 'react';
import { usePlans } from '../hooks/usePlans';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../hooks/useConfirm';
import { deletePlan } from '../services/api';
import PlanForm from './PlanForm';
import WaDialog, { WaError } from './WaDialog';
import { AsyncState, Button, CABECALHO, CELULA, DataTable } from './ui';
import { IconSearch, IconNewChat } from './icons/WaIcons';
import { descreverErro } from '../utils/errorMessages';

// Escala de raio da seção: cartão 16 > controle 12 > botão de linha 10.
const CONTROL =
  'h-10 rounded-[12px] border border-wa-border bg-wa-field text-[13.5px] text-wa-text outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-focus-ring/40';

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatarPreco(valor) {
  return MOEDA.format(Number(valor || 0));
}

// Travessão, nunca "0 Mbps": plano sem velocidade não tem velocidade zero.
function formatarVelocidade(mbps) {
  return mbps ? `${mbps} Mbps` : '—';
}

function PlanRow({ plan, onEdit, onDeleted, onError }) {
  const { token } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const question = 'Excluir o plano "' + plan.name + '"?';
    const ok = await confirm(question, { danger: true, confirmLabel: 'Excluir' });
    if (!ok) {
      return;
    }
    onError(plan.id, null);
    setDeleting(true);
    try {
      await deletePlan(plan.id, token);
      onDeleted();
    } catch (err) {
      onError(plan.id, descreverErro(err, 'Falha ao excluir'));
      setDeleting(false);
    }
  }

  return (
    <tr className="border-t border-wa-border">
      <td className={`${CELULA} text-[14px] font-medium text-wa-text`}>{plan.name}</td>
      <td className={`${CELULA} whitespace-nowrap text-[14px] text-wa-muted`}>{formatarVelocidade(plan.speedMbps)}</td>
      <td className={`${CELULA} whitespace-nowrap text-[14px] text-wa-text`}>{formatarPreco(plan.monthlyPrice)}</td>
      <td className={`${CELULA} text-[14px] text-wa-muted`}>{plan.installCondition || '—'}</td>
      <td className={`${CELULA} whitespace-nowrap text-[13.5px] text-wa-muted`}>
        {plan.active ? 'Ativo' : 'Inativo'}
      </td>
      <td className={`${CELULA} whitespace-nowrap`}>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onEdit(plan)}
            aria-label={`Editar ${plan.name}`}
            title={`Editar ${plan.name}`}
          >
            Editar
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleDelete}
            loading={deleting}
            aria-label={`Excluir ${plan.name}`}
            title={`Excluir ${plan.name}`}
          >
            Excluir
          </Button>
        </div>
        {confirmDialog}
      </td>
    </tr>
  );
}

// Controlado (a página passa `creating`): o cartão tem o botão "Novo plano" e o
// formulário abre num pop-up. Sem controle: o formulário fica inline embaixo.
function PlansAdminTab({ creating: creatingProp, onCreatingChange } = {}) {
  const { plans, status, refresh } = usePlans();
  const [errors, setErrors] = useState({});
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [internalCreating, setInternalCreating] = useState(false);
  const controlled = creatingProp !== undefined;
  const creating = controlled ? creatingProp : internalCreating;
  const setCreating = controlled ? onCreatingChange : setInternalCreating;

  function setPlanError(planId, message) {
    setErrors((prev) => ({ ...prev, [planId]: message }));
  }

  const errorMessages = Object.values(errors).filter(Boolean);
  const term = search.trim().toLowerCase();
  const visible = useMemo(
    () => plans.filter((plan) => !term || String(plan.name || '').toLowerCase().includes(term)),
    [plans, term]
  );
  const countLabel =
    visible.length !== plans.length
      ? `${visible.length} de ${plans.length} planos`
      : `${plans.length} ${plans.length === 1 ? 'plano' : 'planos'}`;

  return (
    <>
      <section aria-labelledby="plans-card-title" className="overflow-clip">
        <div className="settings-register-head flex flex-wrap items-start justify-between gap-3 pb-4 pt-1">
          <div className="min-w-0">
            <h2 id="plans-card-title" className="font-display text-[17px] font-semibold leading-[22px] text-wa-text">
              Planos
            </h2>
            <p className="mt-1 max-w-[60ch] text-[13.5px] leading-[19px] text-wa-muted">
              Os planos comerciais oferecidos: velocidade, mensalidade e condição de instalação.
            </p>
          </div>
          {controlled && (
            <Button onClick={() => setCreating(true)} className="!py-2">
              <IconNewChat size={18} />
              Novo plano
            </Button>
          )}
        </div>

        <div className="settings-register-toolbar flex flex-wrap items-center gap-3 pb-4">
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
              placeholder="Buscar plano"
              aria-label="Buscar plano"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-wa-muted"
            />
          </label>
        </div>

        <div className="settings-register-summary text-wa-muted">{countLabel}</div>
        <div className="settings-register-list overflow-hidden rounded-[15px] border border-wa-surface-line bg-wa-surface">
          <AsyncState status={status} isEmpty={plans.length === 0} emptyMessage="Nenhum plano cadastrado ainda.">
            <DataTable label="Planos" className="min-w-[640px]">
              <thead>
                <tr className="bg-black/[0.16]">
                  <th scope="col" className={CABECALHO}>Plano</th>
                  <th scope="col" className={CABECALHO}>Velocidade</th>
                  <th scope="col" className={CABECALHO}>Mensalidade</th>
                  <th scope="col" className={CABECALHO}>Instalação</th>
                  <th scope="col" className={CABECALHO}>Situação</th>
                  <th scope="col" className={`${CABECALHO} text-right`}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr className="border-t border-wa-border">
                    <td colSpan={6} className="px-3 py-6 text-center text-[13.5px] text-wa-muted">
                      Nenhum plano com esse nome.
                    </td>
                  </tr>
                ) : (
                  visible.map((plan) => (
                    <PlanRow
                      key={plan.id}
                      plan={plan}
                      onEdit={setEditing}
                      onDeleted={refresh}
                      onError={setPlanError}
                    />
                  ))
                )}
              </tbody>
            </DataTable>
          </AsyncState>
          {errorMessages.map((message, index) => (
            <WaError key={index} className="mb-3">
              {message}
            </WaError>
          ))}
        </div>
      </section>

      {controlled && creating && (
        <WaDialog title="Novo plano" onClose={() => setCreating(false)} size="max-w-lg">
          <div className="px-6 pb-5 pt-2">
            <PlanForm
              embedded
              plan={null}
              onSaved={() => {
                refresh();
                setCreating(false);
              }}
              onCancel={() => setCreating(false)}
            />
          </div>
        </WaDialog>
      )}

      {editing && (
        <WaDialog title="Editar plano" onClose={() => setEditing(null)} size="max-w-lg">
          <div className="px-6 pb-5 pt-2">
            <PlanForm
              embedded
              plan={editing}
              onSaved={() => {
                refresh();
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          </div>
        </WaDialog>
      )}

      {!controlled && !editing && (
        <PlanForm
          plan={null}
          onSaved={() => {
            refresh();
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

export default PlansAdminTab;
