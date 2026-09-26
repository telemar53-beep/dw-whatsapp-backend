import { useState, useMemo, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePlaces } from '../hooks/useCities';
import { updateContact } from '../services/api';
import WaDialog, { waInputClass, waLabelClass, waPrimaryButtonClass, waGhostButtonClass, WaError } from './WaDialog';
import { descreverErro } from '../utils/errorMessages';

function EditContactModal({ conversation, onClose, onSaved }) {
  const { token } = useAuth();
  const { places, status: citiesStatus } = usePlaces();
  // Fotografia do que o modal recebeu ao abrir. Só vai ao servidor o campo que
  // mudou em relação a ela: a conversa pode ter vindo de uma lista
  // desatualizada, e reenviar um campo intocado — a nota, sobretudo — devolvia
  // ao servidor um valor que outra edição já tinha trocado. A rota aplica só
  // as chaves que chegam (ADR-011).
  const [inicial] = useState(() => ({
    displayName: conversation.contactDisplayName || '',
    cityId: conversation.contactCityId || '',
    localityId: conversation.contactLocalityId || '',
    internalNote: conversation.contactInternalNote || '',
  }));
  const [displayName, setDisplayName] = useState(inicial.displayName);
  const [cityId, setCityId] = useState(inicial.cityId);
  const [localityId, setLocalityId] = useState(inicial.localityId);
  const [internalNote, setInternalNote] = useState(inicial.internalNote);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // O modal pode fechar com o "Salvar" no caminho ("Cancelar", Esc, troca de
  // conversa). A resposta que chega depois ainda vai para o onSaved — ela é do
  // contato de onde saiu —, mas não fecha de novo: o onClose fecharia a edição
  // que estiver aberta agora, talvez a de outro cliente.
  const aberto = useRef(true);
  useEffect(() => {
    aberto.current = true;
    return () => {
      aberto.current = false;
    };
  }, []);

  // Município é o que NÃO é localidade: o registro legado ainda não
  // classificado continua aparecendo aqui, que é como os contatos dele foram
  // cadastrados. Povoado nunca ocupa o lugar de município.
  const municipios = useMemo(() => places.filter((p) => p.kind !== 'locality'), [places]);
  const localidades = useMemo(
    () => (cityId ? places.filter((p) => p.kind === 'locality' && p.parentId === cityId) : []),
    [places, cityId]
  );

  // Trocar de município zera a localidade no mesmo passo: manter a anterior
  // deixaria uma combinação que o servidor recusa, e que não quer dizer nada.
  function escolherMunicipio(novo) {
    setCityId(novo);
    setLocalityId('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    // Campo vazio continua virando null, como sempre: limpar de propósito
    // também é mudança.
    const alterado = {};
    if (displayName !== inicial.displayName) alterado.displayName = displayName;
    if (cityId !== inicial.cityId) alterado.cityId = cityId || null;
    if (localityId !== inicial.localityId) alterado.localityId = localityId || null;
    if (internalNote !== inicial.internalNote) alterado.internalNote = internalNote || null;
    // Nada mudou: não há o que salvar, e uma chamada vazia não diz nada.
    if (Object.keys(alterado).length === 0) {
      onClose();
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const updated = await updateContact(conversation.contactId, alterado, token);
      // A resposta é minimizada de propósito e traz só os ids; o nome sai da
      // lista que esta tela já tem em mãos.
      const nomeDe = (id) => (id ? places.find((p) => p.id === id)?.name || null : null);
      onSaved({
        displayName: updated.displayName,
        cityId: updated.cityId,
        cityName: nomeDe(updated.cityId),
        localityId: updated.localityId,
        localityName: nomeDe(updated.localityId),
        internalNote: updated.internalNote,
      });
      if (aberto.current) onClose();
    } catch (err) {
      if (aberto.current) setError(descreverErro(err, 'Falha ao salvar'));
    } finally {
      if (aberto.current) setSubmitting(false);
    }
  }

  const carregando = citiesStatus === 'loading';

  return (
    <WaDialog title="Editar cliente" onClose={onClose} size="max-w-2xl" variant="contact-edit">
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="dialog-contact-fields wa-scroll min-h-0 flex-1 overflow-y-auto px-6 py-3">
          <div>
            <label htmlFor="contact-name" className={waLabelClass}>
              Nome
            </label>
            <input
              id="contact-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={waInputClass}
            />
          </div>
          <div>
            <label htmlFor="contact-city" className={waLabelClass}>
              Município
            </label>
            <select
              id="contact-city"
              value={cityId}
              onChange={(e) => escolherMunicipio(e.target.value)}
              className={waInputClass}
              disabled={carregando}
            >
              <option value="">{carregando ? 'Carregando…' : 'Nenhum'}</option>
              {municipios.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="contact-locality" className={waLabelClass}>
              Localidade
            </label>
            <select
              id="contact-locality"
              value={localityId}
              onChange={(e) => setLocalityId(e.target.value)}
              className={waInputClass}
              disabled={carregando || !cityId}
            >
              <option value="">Nenhuma</option>
              {localidades.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="contact-internal-note" className={waLabelClass}>
              Nota interna
            </label>
            <textarea
              id="contact-internal-note"
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              rows={3}
              placeholder="Visível só para os atendentes"
              className={waInputClass}
            />
          </div>
          {error && <WaError>{error}</WaError>}
        </div>
        <div className="flex shrink-0 justify-end gap-2 px-4 py-3">
          <button type="button" onClick={onClose} className={waGhostButtonClass}>
            Cancelar
          </button>
          <button type="submit" disabled={submitting} className={waPrimaryButtonClass}>
            Salvar
          </button>
        </div>
      </form>
    </WaDialog>
  );
}

export default EditContactModal;
