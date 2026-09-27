import { memo, useId, useMemo } from 'react';
import LinhaDaSupervisao from './LinhaDaSupervisao';
import { Colunas } from './ListaDaSupervisao';

// "Últimas 24 h": os encerrados da janela do servidor (24 h, não "hoje"). A
// busca só acontece quando esta aba abre (SupervisionPage).
//
// A contagem diz de onde vem: sem filtro, do painel ao vivo; com canal,
// atendente ou setor, do total que o servidor calcula para o recorte; com o
// atendente "IA" (que o servidor não conhece), do que já foi carregado — e aí
// o aviso diz que é parcial em vez de se passar por total.

function EncerradosDaSupervisao({
  visiveis, carregado, erro, temMais, carregandoMais, contagem, aviso, vazio,
  rotulos, onAbrir, onCarregarMais, onTentarDeNovo,
}) {
  const tituloId = useId();
  return (
    <section className="sv-cartao sv-conversas" aria-labelledby={tituloId}>
      <h2 id={tituloId} className="sv-cartao-titulo">
        Encerrados nas últimas 24 h
        {contagem !== null && <span className="sv-cartao-contagem"> ({contagem})</span>}
      </h2>
      {erro && (
        <div role="alert" className="sv-estado is-erro">
          <span>{erro.mensagem}</span>
          <button type="button" className="sv-botao-texto" onClick={onTentarDeNovo}>Tentar de novo</button>
        </div>
      )}
      {!carregado && !erro && <p role="status" className="sv-estado">Carregando encerrados…</p>}
      {aviso && <p className="sv-aviso">{aviso}</p>}
      {visiveis.length > 0 && (
        <>
          <Colunas tempo="Encerrado" />
          <ul className="sv-grupo-lista">
            {visiveis.map((conversa) => (
              <LinhaDaSupervisao key={conversa.id} conversa={conversa} rotulos={rotulos} onAbrir={onAbrir} />
            ))}
          </ul>
        </>
      )}
      {carregado && !erro && visiveis.length === 0 && <p className="sv-estado">{vazio}</p>}
      {temMais && (
        <div className="sv-mais">
          <button type="button" className="sv-botao-secundario" onClick={onCarregarMais} disabled={carregandoMais}>
            {carregandoMais ? 'Carregando…' : 'Carregar mais'}
          </button>
        </div>
      )}
    </section>
  );
}

export default memo(EncerradosDaSupervisao);

// Resultado da busca por telefone: todos os atendimentos do cliente, de
// qualquer estado — por isso a linha diz o estado de cada um.
export const ResultadoDoTelefone = memo(function ResultadoDoTelefone({ resultado, rotulos, onAbrir, onLimpar }) {
  const tituloId = useId();
  const nome = resultado.contact.displayName || resultado.contact.phoneNumber;
  // Campanha silenciosa só existe para a operação quando o cliente responde:
  // aqui também fica de fora (e da contagem).
  const conversas = useMemo(() => resultado.conversations.filter((c) => c.status !== 'silent'), [resultado]);
  const total = conversas.length;
  return (
    <section className="sv-cartao sv-conversas" aria-labelledby={tituloId}>
      <div className="sv-cartao-cabeca">
        <h2 id={tituloId} className="sv-cartao-titulo">
          Atendimentos de {nome}
          <span className="sv-cartao-contagem"> ({total})</span>
        </h2>
        <button type="button" className="sv-botao-texto" onClick={onLimpar}>Limpar busca</button>
      </div>
      {total === 0 ? (
        <p className="sv-estado">Esse cliente ainda não teve nenhum atendimento.</p>
      ) : (
        <>
          <Colunas tempo="Estado e tempo" />
          <ul className="sv-grupo-lista">
            {conversas.map((conversa) => (
              <LinhaDaSupervisao key={conversa.id} conversa={conversa} rotulos={rotulos} onAbrir={onAbrir} mostrarEstado />
            ))}
          </ul>
        </>
      )}
    </section>
  );
});
