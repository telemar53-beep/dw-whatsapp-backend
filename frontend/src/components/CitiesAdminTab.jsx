import { useState, useMemo } from 'react';
import { useCities } from '../hooks/useCities';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../hooks/useConfirm';
import { deleteCity } from '../services/api';
import CreateCityForm from './CreateCityForm';
import WaDialog, { waErrorClass } from './WaDialog';
import { AsyncState, Button } from './ui';
import { IconSearch, IconNewChat } from './icons/WaIcons';

// Escala de raio da seção: cartão 16 > controle 12 > botão de linha 10.
const CELL = 'px-3 py-3 align-middle';
const HEAD = 'px-3 py-2.5 text-left text-[12.5px] font-medium text-wa-muted';
const CONTROL =
  'h-10 rounded-[12px] border border-wa-border bg-wa-field text-[13.5px] text-wa-text outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/25';
const DANGER_BTN =
  'inline-flex h-8 shrink-0 items-center justify-center rounded-[10px] border border-wa-error-text/30 bg-wa-error-bg px-3 text-[13px] font-medium text-wa-error-text transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-50';

function CityRow({ city, onDeleted, onError }) {
  const { token } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const question = 'Excluir a cidade "' + city.name + '"?';
    const ok = await confirm(question, { danger: true, confirmLabel: 'Excluir' });
    if (!ok) {
      return;
    }
    onError(city.id, null);
    setDeleting(true);
    try {
      await deleteCity(city.id, token);
      onDeleted();
    } catch (err) {
      onError(city.id, (err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  return (
    <tr className="border-t border-wa-border">
      <td className={`${CELL} text-[14px] font-medium text-wa-text`}>{city.name}</td>
      <td className={`${CELL} whitespace-nowrap`}>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            aria-label={`Excluir ${city.name}`}
            title={`Excluir ${city.name}`}
            className={DANGER_BTN}
          >
            Excluir
          </button>
        </div>
        {confirmDialog}
      </td>
    </tr>
  );
}

// Controlado (a página passa `creating`): o cartão tem o botão "Nova cidade" e
// o formulário abre num pop-up. Sem controle: o formulário fica inline embaixo.
function CitiesAdminTab({ creating: creatingProp, onCreatingChange } = {}) {
  const { cities, status, refresh } = useCities();
  const [errors, setErrors] = useState({});
  const [search, setSearch] = useState('');
  const [internalCreating, setInternalCreating] = useState(false);
  const controlled = creatingProp !== undefined;
  const creating = controlled ? creatingProp : internalCreating;
  const setCreating = controlled ? onCreatingChange : setInternalCreating;

  function setCityError(cityId, message) {
    setErrors((prev) => ({ ...prev, [cityId]: message }));
  }

  const errorMessages = Object.values(errors).filter(Boolean);
  const term = search.trim().toLowerCase();
  const visible = useMemo(
    () => cities.filter((city) => !term || String(city.name || '').toLowerCase().includes(term)),
    [cities, term]
  );
  const countLabel =
    visible.length !== cities.length
      ? `${visible.length} de ${cities.length} cidades`
      : `${cities.length} ${cities.length === 1 ? 'cidade' : 'cidades'}`;

  return (
    <>
      <section
        aria-labelledby="cities-card-title"
        className="overflow-clip"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 pb-4 pt-1">
          <div className="min-w-0">
            <h2 id="cities-card-title" className="font-display text-[17px] font-semibold leading-[22px] text-wa-text">
              Cidades
            </h2>
            <p className="mt-1 max-w-[60ch] text-[13.5px] leading-[19px] text-wa-muted">
              As cidades do cadastro do cliente e dos avisos por região. Os nomes precisam ser iguais aos do SGP.
            </p>
          </div>
          {controlled && (
            <Button onClick={() => setCreating(true)} className="!py-2">
              <IconNewChat size={18} />
              Nova cidade
            </Button>
          )}
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
              placeholder="Buscar cidade"
              aria-label="Buscar cidade"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-wa-muted"
            />
          </label>
        </div>

        <div className="settings-register-summary text-wa-muted">{countLabel}</div>
        <div className="settings-register-list overflow-hidden rounded-[15px] border border-wa-surface-line bg-wa-surface">
          <AsyncState status={status} isEmpty={cities.length === 0} emptyMessage="Nenhuma cidade cadastrada ainda.">
            <div className="chat-scroll overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-[13.5px]">
                <thead>
                  <tr className="bg-black/[0.16]">
                    <th scope="col" className={HEAD}>
                      Cidade
                    </th>
                    <th scope="col" className={`${HEAD} text-right`}>
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr className="border-t border-wa-border">
                      <td colSpan={2} className="px-3 py-6 text-center text-[13.5px] text-wa-muted">
                        Nenhuma cidade com esse nome.
                      </td>
                    </tr>
                  ) : (
                    visible.map((city) => <CityRow key={city.id} city={city} onDeleted={refresh} onError={setCityError} />)
                  )}
                </tbody>
              </table>
            </div>
          </AsyncState>
          {errorMessages.map((message, index) => (
            <p key={index} className={`mb-3 ${waErrorClass}`}>
              {message}
            </p>
          ))}
        </div>

      </section>

      {controlled && creating && (
        <WaDialog variant="city" title="Nova cidade" onClose={() => setCreating(false)} size="max-w-md">
          <div className="px-6 pb-5 pt-2">
            <CreateCityForm
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
        <CreateCityForm
          onCreated={() => {
            refresh();
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

export default CitiesAdminTab;
