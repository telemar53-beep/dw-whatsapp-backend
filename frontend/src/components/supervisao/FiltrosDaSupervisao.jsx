import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { IconeFiltros, IconeRemoverFiltro } from '../icones/supervisao';

// Os três filtros de antes (Canal, Atendente e Setor) num popover só, e os
// ativos em chips removíveis. Os significados não mudaram: atendente "IA" é o
// que a IA encerrou, concluiu ou ainda está triando.
//
// Popover, e não diálogo modal: não prende o foco. Fecha com Esc (e devolve o
// foco ao botão), com clique fora e com o Tab que sai dele.

const ID_DO_BOTAO = 'sv-filtros-botao';

export const GRUPOS_DE_FILTRO = [
  { chave: 'canal', titulo: 'Canal' },
  { chave: 'atendente', titulo: 'Atendente' },
  { chave: 'setor', titulo: 'Setor' },
];

function Popover({ opcoes, selecionados, onAlternar, onFechar, botaoRef }) {
  const painelRef = useRef(null);

  useEffect(() => {
    const primeiro = painelRef.current?.querySelector('input');
    if (primeiro) primeiro.focus();
  }, []);

  useEffect(() => {
    function aoDescer(evento) {
      const painel = painelRef.current;
      if (!painel || painel.contains(evento.target)) return;
      // O fundo do celular fecha no próprio clique: fechar já no mousedown o
      // tiraria da tela antes do clique, que cairia na linha de baixo.
      if (evento.target.classList && evento.target.classList.contains('sv-filtros-fundo')) return;
      if (botaoRef.current && botaoRef.current.contains(evento.target)) return;
      onFechar(false);
    }
    function aoTeclar(evento) {
      if (evento.key !== 'Escape') return;
      evento.stopPropagation();
      onFechar(true);
    }
    // O Tab que sai do popover (para a frente ou para trás) o fecha: aberto
    // atrás do foco, ele ficaria por cima da lista sem ninguém nele.
    function aoFocar(evento) {
      const painel = painelRef.current;
      if (!painel || painel.contains(evento.target)) return;
      if (botaoRef.current && botaoRef.current.contains(evento.target)) return;
      onFechar(false);
    }
    document.addEventListener('mousedown', aoDescer);
    document.addEventListener('keydown', aoTeclar);
    document.addEventListener('focusin', aoFocar);
    return () => {
      document.removeEventListener('mousedown', aoDescer);
      document.removeEventListener('keydown', aoTeclar);
      document.removeEventListener('focusin', aoFocar);
    };
  }, [onFechar, botaoRef]);

  return (
    <div ref={painelRef} role="dialog" aria-label="Filtros" className="sv-filtros-painel">
      {GRUPOS_DE_FILTRO.map(({ chave, titulo }) => (
        <fieldset key={chave} className="sv-filtros-grupo">
          <legend className="sv-filtros-legenda">{titulo}</legend>
          {opcoes[chave].length === 0 ? (
            <p className="sv-filtros-nada">Nenhuma opção</p>
          ) : (
            opcoes[chave].map((opcao) => (
              <label key={opcao.value} className="sv-filtros-opcao">
                <input
                  type="checkbox"
                  checked={selecionados[chave].includes(opcao.value)}
                  onChange={() => onAlternar(chave, opcao.value)}
                />
                <span className="sv-filtros-rotulo">{opcao.label}</span>
              </label>
            ))
          )}
        </fieldset>
      ))}
    </div>
  );
}

function FiltrosDaSupervisao({ opcoes, selecionados, onAlternar }) {
  const [aberto, setAberto] = useState(false);
  const botaoRef = useRef(null);
  const painelId = useId();
  const ativos = selecionados.canal.length + selecionados.atendente.length + selecionados.setor.length;

  // Estável: o popover o usa nos ouvintes do documento.
  const fechar = useCallback((devolverFoco) => {
    setAberto(false);
    if (devolverFoco) botaoRef.current?.focus();
  }, []);

  return (
    <div className="sv-filtros">
      <button
        ref={botaoRef}
        id={ID_DO_BOTAO}
        type="button"
        className="sv-filtros-botao"
        aria-expanded={aberto}
        aria-controls={aberto ? painelId : undefined}
        onClick={() => setAberto((v) => !v)}
      >
        <IconeFiltros tamanho={18} />
        Filtros
        {ativos > 0 && (
          <span className="sv-filtros-contagem">
            {ativos}
            <span className="sr-only"> {ativos === 1 ? 'ativo' : 'ativos'}</span>
          </span>
        )}
      </button>
      {aberto && (
        <>
          {/* Recebe o clique "fora", que sem ele caía na linha de baixo e
              abria a conversa ao fechar os filtros. Transparente: sem
              escurecer e sem desfoque. */}
          <div className="sv-filtros-fundo" aria-hidden="true" onClick={() => fechar(false)} />
          <div id={painelId}>
            <Popover opcoes={opcoes} selecionados={selecionados} onAlternar={onAlternar} onFechar={fechar} botaoRef={botaoRef} />
          </div>
        </>
      )}
    </div>
  );
}

export default memo(FiltrosDaSupervisao);

// Os filtros ativos, um chip por valor. O × de cada chip tira só aquele valor;
// "Limpar filtros" tira os três grupos e deixa a aba onde está. Os dois
// botões somem no próprio clique: o foco vai para o botão Filtros, e não se
// perde no body.
const focarFiltros = () => document.getElementById(ID_DO_BOTAO)?.focus();

export const ChipsDosFiltros = memo(function ChipsDosFiltros({ chips, onRemover, onLimpar }) {
  if (chips.length === 0) return null;
  return (
    <div className="sv-chips">
      <ul className="sv-chips-lista" aria-label="Filtros ativos">
        {chips.map((chip) => (
          <li key={`${chip.chave}:${chip.valor}`} className="sv-chip">
            <span className="sv-chip-texto" title={`${chip.titulo}: ${chip.rotulo}`}>{chip.titulo}: {chip.rotulo}</span>
            <button
              type="button"
              className="sv-chip-remover"
              aria-label={`Remover filtro ${chip.titulo}: ${chip.rotulo}`}
              onClick={() => { onRemover(chip.chave, chip.valor); focarFiltros(); }}
            >
              <IconeRemoverFiltro tamanho={16} />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="sv-botao-texto sv-chips-limpar" onClick={() => { onLimpar(); focarFiltros(); }}>Limpar filtros</button>
    </div>
  );
});
