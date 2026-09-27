import { useState, useMemo, useRef, useEffect, useId } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePlaces } from '../hooks/useCities';
import { updateContact } from '../services/api';
import WaDialog from './WaDialog';
import { descreverErro, detalheTecnicoDoErro } from '../utils/errorMessages';
import './editar-cliente.css';

// Nada técnico chega ao atendente: só a mensagem que o mapa de erros traduziu.
// O resto — frase do servidor sem tradução, queda de rede — vira esta.
const ERRO_AO_SALVAR = 'Não foi possível salvar as alterações. Tente novamente.';
function mensagemDoErro(erro) {
  return detalheTecnicoDoErro(erro) ? descreverErro(erro) : ERRO_AO_SALVAR;
}

function EditContactModal({ conversation, onClose, onSaved }) {
  const { token } = useAuth();
  const { places, status: citiesStatus, refresh: recarregarLugares } = usePlaces();
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
  // O estado só muda no próximo render: dois "Enter" no mesmo instante
  // passariam os dois pela checagem de `submitting`. A ref barra o segundo.
  const salvandoRef = useRef(false);
  // O modal pode fechar com o "Salvar" no caminho (troca de conversa). A
  // resposta que chega depois ainda vai para o onSaved — ela é do contato de
  // onde saiu —, mas não fecha de novo: o onClose fecharia a edição que estiver
  // aberta agora, talvez a de outro cliente.
  const aberto = useRef(true);
  useEffect(() => {
    aberto.current = true;
    return () => {
      aberto.current = false;
    };
  }, []);

  const ids = {
    identificacao: useId(),
    localizacao: useId(),
    nota: useId(),
    apoioDaNota: useId(),
    dicaDaLocalidade: useId(),
  };

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
    if (salvandoRef.current) return;
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
    salvandoRef.current = true;
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
      if (aberto.current) setError(mensagemDoErro(err));
    } finally {
      salvandoRef.current = false;
      if (aberto.current) setSubmitting(false);
    }
  }

  const carregando = citiesStatus === 'loading';
  const falhaNosLugares = citiesStatus === 'error' || citiesStatus === 'forbidden';

  // "Tentar novamente" some junto com o aviso: o foco cairia no <body> e o Tab
  // escaparia do modal. Fica no diálogo enquanto carrega e passa ao Município
  // quando a lista chega.
  const municipioRef = useRef(null);
  const focarMunicipio = useRef(false);
  function tentarDeNovo(event) {
    event.currentTarget.closest('[role="dialog"]')?.focus();
    focarMunicipio.current = true;
    recarregarLugares();
  }
  useEffect(() => {
    if (!focarMunicipio.current || carregando) return;
    focarMunicipio.current = false;
    if (!falhaNosLugares) municipioRef.current?.focus();
  }, [carregando, falhaNosLugares]);
  // A localidade depende do município — e diz por que está travada.
  const semLocalidades = Boolean(cityId) && !carregando && !falhaNosLugares && localidades.length === 0;
  const localidadeTravada = carregando || falhaNosLugares || !cityId || semLocalidades;
  const dicaDaLocalidade = !cityId && !carregando && !falhaNosLugares
    ? 'Escolha um município para ver as localidades.'
    : semLocalidades
      ? 'Este município não tem localidades cadastradas.'
      : null;
  // Sem a lista, o seletor mostraria a primeira opção — "Nenhum" — para um
  // contato que tem município: diria que o cadastro está vazio. Carregando ou
  // em falha, ele diz isso mesmo.
  const semLista = carregando ? 'Carregando…' : falhaNosLugares ? 'Indisponível' : null;

  return (
    <WaDialog
      title="Editar cliente"
      description="Atualize as informações usadas no atendimento"
      onClose={onClose}
      size="max-w-[640px]"
      variant="contact-edit"
      // Salvando: nada abandona a gravação pela metade — nem o "×", nem o Esc.
      closeOnEsc={!submitting}
      closeDisabled={submitting}
    >
      <form onSubmit={handleSubmit} className="ec-form" noValidate>
        <div className="ec-corpo">
          <section className="ec-secao">
            <h3 id={ids.identificacao} className="ec-titulo">Identificação</h3>
            <div className="ec-campo">
              <label htmlFor="contact-name" className="ec-rotulo">Nome</label>
              <input
                id="contact-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="off"
                className="ec-controle"
              />
            </div>
          </section>

          <section className="ec-secao">
            <h3 id={ids.localizacao} className="ec-titulo">Localização</h3>
            {falhaNosLugares && (
              <div role="alert" className="ec-aviso">
                <span>Não foi possível carregar os municípios.</span>
                <button type="button" onClick={tentarDeNovo} className="ec-aviso-acao">
                  Tentar novamente
                </button>
              </div>
            )}
            <div className="ec-linha">
              <div className="ec-campo">
                <label htmlFor="contact-city" className="ec-rotulo">Município</label>
                <select
                  id="contact-city"
                  ref={municipioRef}
                  value={cityId}
                  onChange={(e) => escolherMunicipio(e.target.value)}
                  className="ec-controle"
                  disabled={carregando || falhaNosLugares}
                >
                  <option value="">{carregando ? 'Carregando municípios…' : semLista || 'Nenhum'}</option>
                  {municipios.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ec-campo">
                <label htmlFor="contact-locality" className="ec-rotulo">Localidade</label>
                <select
                  id="contact-locality"
                  value={localityId}
                  onChange={(e) => setLocalityId(e.target.value)}
                  className="ec-controle"
                  disabled={localidadeTravada}
                  aria-describedby={dicaDaLocalidade ? ids.dicaDaLocalidade : undefined}
                >
                  <option value="">{semLista || (semLocalidades ? 'Nenhuma localidade cadastrada' : 'Nenhuma')}</option>
                  {localidades.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.name}
                    </option>
                  ))}
                </select>
                {dicaDaLocalidade && <p id={ids.dicaDaLocalidade} className="ec-dica">{dicaDaLocalidade}</p>}
              </div>
            </div>
          </section>

          <section className="ec-secao">
            <h3 id={ids.nota} className="ec-titulo">Nota interna</h3>
            <p id={ids.apoioDaNota} className="ec-apoio">Visível apenas para a equipe</p>
            <textarea
              id="contact-internal-note"
              aria-labelledby={ids.nota}
              aria-describedby={ids.apoioDaNota}
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              rows={3}
              className="ec-controle is-texto"
            />
          </section>
        </div>

        {error && <p role="alert" className="ec-erro">{error}</p>}

        <div className="ec-rodape">
          <button type="button" onClick={onClose} disabled={submitting} className="ec-botao is-secundario">
            Cancelar
          </button>
          {/* Salvando, fica indisponível sem `disabled`: o botão focado que
              vira `disabled` joga o foco no <body>, e o Tab escaparia para a
              página atrás. O segundo envio quem barra é a salvandoRef. */}
          <button type="submit" aria-disabled={submitting || undefined} className="ec-botao is-principal">
            {submitting ? 'Salvando…' : 'Salvar alterações'}
          </button>
        </div>
      </form>
    </WaDialog>
  );
}

export default EditContactModal;
