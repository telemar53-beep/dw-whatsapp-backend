import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createCity, updateCity } from '../services/api';
import { Button } from './ui';
import { WaError } from './WaDialog';
import { descreverErro } from '../utils/errorMessages';

const CAMPO =
  'h-10 w-full rounded-[10px] border border-wa-border bg-wa-field px-3.5 text-[14px] text-wa-text placeholder-wa-muted outline-none transition focus:border-accent/60';
const ROTULO = 'mb-1.5 block text-[13px] font-medium text-wa-muted';
const AJUDA = 'mt-1 text-[12.5px] leading-[17px] text-wa-muted';

// 'unclassified' e um registro legado que ninguem classificou ainda. Ele nunca
// e uma OPCAO do formulario: aparece como estado atual e obriga a escolher um
// tipo de verdade antes de salvar. A rota tambem recusa, de todo modo.
function tipoInicial(place) {
  if (!place) return 'city';
  return place.kind === 'unclassified' ? '' : place.kind;
}

function descreverBloqueio(dependencies) {
  const partes = [];
  if (dependencies.contatosComoLocalidade) {
    partes.push(`${dependencies.contatosComoLocalidade} contatos usam este povoado`);
  }
  if (dependencies.contatosComoMunicipio) {
    partes.push(`${dependencies.contatosComoMunicipio} contatos usam este município`);
  }
  if (dependencies.filhas) {
    partes.push(`${dependencies.filhas} localidades dependem dele`);
  }
  if (dependencies.avisos) {
    partes.push(`${dependencies.avisos} avisos apontam para ele`);
  }
  const lista = partes.length ? partes.join('; ') : 'há vínculos em uso';
  return `Não dá para mudar a estrutura agora: ${lista}. Trate esses vínculos primeiro.`;
}

function mensagemDeFalha(err, padrao) {
  const corpo = (err && err.body) || {};
  if (err && err.status === 409 && corpo.error === 'structural change blocked') {
    return descreverBloqueio(corpo.dependencies || {});
  }
  if (err && err.status === 409 && corpo.error === 'sgpPop already in use') {
    return 'Esse POP do SGP já está em uso por outro lugar. Cada POP pertence a um único cadastro.';
  }
  return descreverErro(err, padrao);
}

// `embedded`: dentro de um pop-up que já tem título e moldura — sem borda nem h3.
function CityForm({ place = null, places = [], onSaved, onCancel, embedded = false }) {
  const { token } = useAuth();
  const editando = Boolean(place);

  const [name, setName] = useState(place?.name || '');
  const [kind, setKind] = useState(tipoInicial(place));
  const [parentId, setParentId] = useState(place?.parentId || '');
  const [sgpPop, setSgpPop] = useState(place?.sgpPop || '');
  const [active, setActive] = useState(place ? place.active : true);
  const [served, setServed] = useState(place ? place.served : false);
  const [note, setNote] = useState(place?.note || '');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Localidade só pode pendurar em município: a hierarquia tem dois níveis.
  const municipios = places.filter((p) => p.kind !== 'locality' && p.id !== (place && place.id));

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    if (!kind) {
      setError('Escolha se este cadastro é uma cidade ou uma localidade.');
      return;
    }
    if (kind === 'locality' && !parentId) {
      setError('Uma localidade precisa pertencer a um município.');
      return;
    }

    const payload = {
      name: name.trim(),
      kind,
      parentId: kind === 'locality' ? parentId : null,
      // Ausência é null, nunca string vazia: com '' o índice único tornaria
      // impossível existirem dois cadastros sem POP.
      sgpPop: sgpPop.trim() || null,
      active,
      served,
      note: note.trim(),
    };

    setSubmitting(true);
    try {
      if (editando) {
        await updateCity(place.id, payload, token);
      } else {
        await createCity(payload, token);
      }
      onSaved();
    } catch (err) {
      setError(mensagemDeFalha(err, editando ? 'Falha ao salvar' : 'Falha ao cadastrar'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={embedded ? '' : 'rounded-[16px] border border-wa-border bg-wa-surface p-4'}>
      {!embedded && (
        <h3 className="mb-2.5 text-[13.5px] font-medium text-wa-text">
          {editando ? 'Editar cadastro' : 'Cadastrar nova cidade ou localidade'}
        </h3>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label htmlFor="city-name" className={ROTULO}>Nome</label>
          <input
            id="city-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cândido Mendes"
            className={CAMPO}
            required
          />
          <p className={AJUDA}>Como aparece no sistema. Para município, use o nome igual ao do SGP.</p>
        </div>

        <div className="flex flex-wrap gap-3.5">
          <div className="min-w-[180px] flex-1">
            <label htmlFor="city-kind" className={ROTULO}>Tipo</label>
            <select
              id="city-kind"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                if (e.target.value !== 'locality') setParentId('');
              }}
              className={CAMPO}
            >
              {!kind && <option value="">Não classificado</option>}
              <option value="city">Cidade / Município</option>
              <option value="locality">Povoado / Localidade</option>
            </select>
            {!kind && (
              <p className={AJUDA}>
                Cadastro antigo, ainda <strong>não classificado</strong>. Escolha o tipo para continuar.
              </p>
            )}
          </div>

          {kind === 'locality' && (
            <div className="min-w-[180px] flex-1">
              <label htmlFor="city-parent" className={ROTULO}>Município</label>
              <select
                id="city-parent"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className={CAMPO}
              >
                <option value="">Selecione…</option>
                {municipios.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div>
          <label htmlFor="city-pop" className={ROTULO}>POP do SGP</label>
          <input
            id="city-pop"
            value={sgpPop}
            onChange={(e) => setSgpPop(e.target.value)}
            placeholder="Barão"
            className={CAMPO}
          />
          <p className={AJUDA}>
            Opcional. Exatamente como o SGP devolve — é por ele que a localidade do cliente é reconhecida.
          </p>
        </div>

        <div>
          <label htmlFor="city-note" className={ROTULO}>Observação</label>
          <textarea
            id="city-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={`${CAMPO} h-auto py-2.5`}
          />
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label htmlFor="city-active" className="flex items-center gap-2.5 text-[14px] text-wa-text">
            <input
              id="city-active"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
            Ativa
          </label>
          <label htmlFor="city-served" className="flex items-center gap-2.5 text-[14px] text-wa-text">
            <input
              id="city-served"
              type="checkbox"
              checked={served}
              onChange={(e) => setServed(e.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
            Atendida
          </label>
        </div>
        <p className={AJUDA}>
          &quot;Atendida&quot; significa cobertura confirmada. Sem essa marca, a equipe verifica a viabilidade
          em vez de dizer que não atendemos.
        </p>

        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button variant="secondary" onClick={onCancel} type="button">
              Cancelar
            </Button>
          )}
          <Button type="submit" loading={submitting} disabled={!kind}>
            Salvar
          </Button>
        </div>
      </form>
      {error && <WaError className="mt-2">{error}</WaError>}
    </div>
  );
}

export default CityForm;
