import { useState, useMemo, useCallback } from 'react';
import { usePlaces } from '../hooks/useCities';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../hooks/useConfirm';
import { deleteCity } from '../services/api';
import { WaError } from './WaDialog';
import { AsyncState, Button, CABECALHO, CELULA, DataTable } from './ui';
import { IconSearch, IconNewChat } from './icons/WaIcons';
import { descreverErro } from '../utils/errorMessages';
import { sobDemanda, useSobDemanda } from '../utils/sobDemanda';

// Nova cidade e Editar cadastro (Fatia S3) só chegam quando são abertos: o formulário, a
// base de diálogo de Configurações e a folha dela ficam fora do trecho da
// página. Criar e editar usam o mesmo trecho.
const FORMULARIO = sobDemanda(() => import('./CityForm'));

// Escala de raio da seção: cartão 16 > controle 12 > botão de linha 10.
const CONTROL =
  'h-10 rounded-[12px] border border-wa-border bg-wa-field text-[13.5px] text-wa-text outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-focus-ring/40';

const ROTULO_DE_TIPO = {
  city: 'Cidade / Município',
  locality: 'Povoado / Localidade',
  unclassified: 'Não classificado',
};

// "Não atendida" seria uma afirmação que o cadastro não sustenta: served=false
// significa cobertura NÃO CONFIRMADA, e o caminho certo é verificar viabilidade.
function rotuloDeCobertura(served) {
  return served ? 'Atendida' : 'A verificar';
}

function mensagemDeExclusao(err) {
  const corpo = (err && err.body) || {};
  if (err && err.status === 409 && corpo.error === 'place has localities') {
    const filhas = (corpo.dependencies || {}).filhas || 0;
    return `Não dá para excluir: ${filhas} localidades dependem deste município. Trate-as primeiro.`;
  }
  return descreverErro(err, 'Falha ao excluir');
}

function CityRow({ city, parentName, onEdit, onDeleted, onError }) {
  const { token } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const question = 'Excluir "' + city.name + '"?';
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
      onError(city.id, mensagemDeExclusao(err));
      setDeleting(false);
    }
  }

  return (
    <tr className="border-t border-wa-border">
      <td className={`${CELULA} text-[14px] font-medium text-wa-text`}>{city.name}</td>
      <td className={`${CELULA} whitespace-nowrap text-[13.5px] text-wa-muted`}>
        {ROTULO_DE_TIPO[city.kind] || city.kind}
      </td>
      <td className={`${CELULA} text-[14px] text-wa-muted`}>{parentName || '—'}</td>
      <td className={`${CELULA} text-[14px] text-wa-muted`}>{city.sgpPop || '—'}</td>
      <td className={`${CELULA} whitespace-nowrap text-[13.5px] text-wa-muted`}>
        {city.active ? 'Ativa' : 'Inativa'}
      </td>
      <td className={`${CELULA} whitespace-nowrap text-[13.5px] text-wa-muted`}>
        {rotuloDeCobertura(city.served)}
      </td>
      <td className={`${CELULA} whitespace-nowrap`}>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onEdit(city)}
            aria-label={`Editar ${city.name}`}
            title={`Editar ${city.name}`}
          >
            Editar
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleDelete}
            loading={deleting}
            aria-label={`Excluir ${city.name}`}
            title={`Excluir ${city.name}`}
          >
            Excluir
          </Button>
        </div>
        {confirmDialog}
      </td>
    </tr>
  );
}

// Controlado (a página passa `creating`): o cartão tem o botão de cadastro e o
// formulário abre num pop-up. Sem controle: o formulário fica inline embaixo.
function CitiesAdminTab({ creating: creatingProp, onCreatingChange } = {}) {
  const { places, status, refresh } = usePlaces();
  const [errors, setErrors] = useState({});
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [internalCreating, setInternalCreating] = useState(false);
  const controlled = creatingProp !== undefined;
  const creating = controlled ? creatingProp : internalCreating;
  const setCreating = controlled ? onCreatingChange : setInternalCreating;
  const [falhaAoAbrir, setFalhaAoAbrir] = useState(null);
  const formularioNaoBaixou = useCallback(() => {
    setCreating(false);
    setEditing(null);
    setFalhaAoAbrir('Não foi possível abrir o cadastro de cidade. Verifique a conexão e tente de novo.');
  }, [setCreating]);
  // Sem controle, o formulário solto fica à mostra: é preciso desde já.
  const CityForm = useSobDemanda(FORMULARIO, (controlled ? creating : true) || Boolean(editing), formularioNaoBaixou);

  function abrirCriacao() {
    setFalhaAoAbrir(null);
    setCreating(true);
  }

  function abrirEdicao(city) {
    setFalhaAoAbrir(null);
    setEditing(city);
  }

  function setCityError(cityId, message) {
    setErrors((prev) => ({ ...prev, [cityId]: message }));
  }

  const nomePorId = useMemo(
    () => Object.fromEntries(places.map((p) => [p.id, p.name])),
    [places]
  );

  const errorMessages = Object.values(errors).filter(Boolean);
  const term = search.trim().toLowerCase();
  const visible = useMemo(
    () => places.filter((place) => {
      if (!term) return true;
      const pai = place.parentId ? nomePorId[place.parentId] || '' : '';
      // O pai entra na busca para "Candido" achar também os povoados dele.
      return `${place.name} ${pai} ${place.sgpPop || ''}`.toLowerCase().includes(term);
    }),
    [places, term, nomePorId]
  );
  const countLabel =
    visible.length !== places.length
      ? `${visible.length} de ${places.length} cadastros`
      : `${places.length} ${places.length === 1 ? 'cadastro' : 'cadastros'}`;

  return (
    <>
      <section aria-labelledby="cities-card-title" className="overflow-clip">
        <div className="settings-register-head flex flex-wrap items-start justify-between gap-3 pb-4 pt-1">
          <div className="min-w-0">
            <h2 id="cities-card-title" className="font-display text-[17px] font-semibold leading-[22px] text-wa-text">
              Cidades e localidades
            </h2>
            <p className="mt-1 max-w-[60ch] text-[13.5px] leading-[19px] text-wa-muted">
              Os municípios e os povoados do cadastro do cliente e dos avisos por região. Os nomes de
              município precisam ser iguais aos do SGP.
            </p>
          </div>
          {controlled && (
            <Button onClick={abrirCriacao} className="!py-2">
              <IconNewChat size={18} />
              Nova cidade
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
              placeholder="Buscar cidade ou localidade"
              aria-label="Buscar cidade ou localidade"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-wa-muted"
            />
          </label>
        </div>

        <div className="settings-register-summary text-wa-muted">{countLabel}</div>
        {falhaAoAbrir && <WaError className="mb-3">{falhaAoAbrir}</WaError>}
        <div className="settings-register-list overflow-hidden rounded-[15px] border border-wa-surface-line bg-wa-surface">
          <AsyncState status={status} isEmpty={places.length === 0} emptyMessage="Nenhuma cidade cadastrada ainda.">
            <DataTable label="Cidades e localidades" className="min-w-[760px]">
              <thead>
                <tr className="bg-black/[0.16]">
                  <th scope="col" className={CABECALHO}>Nome</th>
                  <th scope="col" className={CABECALHO}>Tipo</th>
                  <th scope="col" className={CABECALHO}>Município</th>
                  <th scope="col" className={CABECALHO}>POP</th>
                  <th scope="col" className={CABECALHO}>Situação</th>
                  <th scope="col" className={CABECALHO}>Cobertura</th>
                  <th scope="col" className={`${CABECALHO} text-right`}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr className="border-t border-wa-border">
                    <td colSpan={7} className="px-3 py-6 text-center text-[13.5px] text-wa-muted">
                      Nenhum cadastro com esse nome.
                    </td>
                  </tr>
                ) : (
                  visible.map((city) => (
                    <CityRow
                      key={city.id}
                      city={city}
                      parentName={city.parentId ? nomePorId[city.parentId] : null}
                      onEdit={abrirEdicao}
                      onDeleted={refresh}
                      onError={setCityError}
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

      {controlled && creating && (CityForm ? (
        <CityForm
          comoDialogo
          place={null}
          places={places}
          onSaved={() => {
            refresh();
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : <p role="status" className="sr-only">Abrindo o cadastro de cidade…</p>)}

      {editing && (CityForm ? (
        <CityForm
          comoDialogo
          place={editing}
          places={places}
          onSaved={() => {
            refresh();
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : <p role="status" className="sr-only">Abrindo o cadastro de cidade…</p>)}

      {!controlled && !editing && CityForm && (
        <CityForm
          place={null}
          places={places}
          onSaved={() => {
            refresh();
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

export default CitiesAdminTab;
