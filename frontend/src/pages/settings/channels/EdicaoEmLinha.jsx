import { useEffect, useRef, useState } from 'react';

// Edição em linha do detalhe do canal (nome e WABA ID), Fatia S2.
//
// Enquanto salva: "Salvando…" e nada de segundo envio. Se falha, o editor
// continua aberto com o que foi digitado, o motivo em português aparece logo
// abaixo e o foco volta ao campo. Se dá certo, fecha e o foco volta ao
// "Editar". `pedidoDeAbertura` (um número que muda) abre o editor de fora —
// é o "Renomear" das Ações do canal.
export function EdicaoEmLinha({ idDoCampo, rotulo, rotuloDoCampo, rotuloEditar, rotuloSalvar, valor, vazio, onSalvar, pedidoDeAbertura = 0 }) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(valor || '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const campoRef = useRef(null);
  const editarRef = useRef(null);
  const devolverFoco = useRef(false);
  const focarCampo = useRef(false);

  // O valor mudou por fora (outro canal, releitura): o rascunho acompanha.
  useEffect(() => {
    setRascunho(valor || '');
    setEditando(false);
    setErro(null);
  }, [valor]);

  useEffect(() => {
    if (pedidoDeAbertura > 0) setEditando(true);
  }, [pedidoDeAbertura]);

  useEffect(() => {
    if (editando && campoRef.current) campoRef.current.focus();
    if (!editando && devolverFoco.current && editarRef.current) {
      devolverFoco.current = false;
      editarRef.current.focus();
    }
  }, [editando]);

  // Depois da falha: o campo só aceita o foco quando deixa de estar desativado.
  useEffect(() => {
    if (!salvando && focarCampo.current && campoRef.current) {
      focarCampo.current = false;
      campoRef.current.focus();
    }
  }, [salvando, erro]);

  function abrir() {
    setRascunho(valor || '');
    setErro(null);
    setEditando(true);
  }

  function cancelar() {
    if (salvando) return;
    setErro(null);
    devolverFoco.current = true;
    setEditando(false);
  }

  async function salvar(evento) {
    evento.preventDefault();
    const limpo = rascunho.trim();
    if (salvando || !limpo) return;
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar(limpo);
      setSalvando(false);
      devolverFoco.current = true;
      setEditando(false);
    } catch (falha) {
      focarCampo.current = true;
      setSalvando(false);
      setErro(falha.message);
    }
  }

  if (!editando) {
    return (
      <div className="cfg-linha">
        <dt>{rotulo}</dt>
        <dd>
          <span className="cfg-linha-valor">{valor || <span className="cfg-linha-vazio">{vazio}</span>}</span>
          <button type="button" ref={editarRef} className="cfg-linha-acao" aria-label={rotuloEditar} onClick={abrir}>
            Editar
          </button>
        </dd>
      </div>
    );
  }

  return (
    <div className="cfg-linha is-editando">
      <dt className="cfg-visualmente-oculto">{rotulo}</dt>
      <dd>
        <form className="cfg-edicao" onSubmit={salvar}>
          <label htmlFor={idDoCampo}>{rotuloDoCampo}</label>
          <input
            id={idDoCampo}
            ref={campoRef}
            className="cfg-entrada"
            value={rascunho}
            onChange={(evento) => setRascunho(evento.target.value)}
            disabled={salvando}
            aria-invalid={erro ? 'true' : undefined}
            aria-describedby={erro ? `${idDoCampo}-erro` : undefined}
            autoComplete="off"
          />
          <div className="cfg-edicao-acoes">
            <button type="button" className="cfg-botao" onClick={cancelar} disabled={salvando}>Cancelar</button>
            <button type="submit" className="cfg-botao is-principal" disabled={salvando || !rascunho.trim()}>
              {salvando ? 'Salvando…' : rotuloSalvar}
            </button>
          </div>
          {erro && <p id={`${idDoCampo}-erro`} role="alert" className="cfg-edicao-erro">{erro}</p>}
        </form>
      </dd>
    </div>
  );
}
