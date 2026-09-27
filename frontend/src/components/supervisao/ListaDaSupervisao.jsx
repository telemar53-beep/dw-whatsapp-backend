import { memo, useId } from 'react';
import { IconeAtendimento } from '../icones';
import { IconeEspera, IconeAutomacao } from '../icones/supervisao';
import LinhaDaSupervisao from './LinhaDaSupervisao';

// O cartão "Conversas": três grupos na ordem em que o supervisor age — quem
// está sem ninguém (Espera) primeiro, depois quem está sendo atendido, e por
// último o que a automação ainda está conduzindo.

export const GRUPOS = [
  { chave: 'espera', titulo: 'Espera', vazio: 'Nenhuma conversa em espera', Icone: IconeEspera },
  { chave: 'atendimento', titulo: 'Em atendimento', vazio: 'Nenhuma conversa em atendimento', Icone: IconeAtendimento },
  { chave: 'automacao', titulo: 'Automação', vazio: 'Nenhuma conversa em automação', Icone: IconeAutomacao },
];

// Os rótulos das colunas descrevem as linhas: só aparecem quando há linha.
export const Colunas = memo(function Colunas({ tempo = 'Tempo' }) {
  return (
    <div className="sv-colunas" aria-hidden="true">
      <span />
      <span>Cliente e última mensagem</span>
      <span>Setor e motivo</span>
      <span>Responsável</span>
      <span>{tempo}</span>
      <span />
    </div>
  );
});

const Grupo = memo(function Grupo({ chave, titulo, Icone, conversas, vazio, rotulos, onAbrir }) {
  const id = useId();
  return (
    <section className="sv-grupo" data-grupo={chave} aria-labelledby={id}>
      <div className="sv-grupo-cabeca">
        <h3 id={id} className="sv-grupo-titulo">
          <Icone tamanho={18} className="sv-grupo-icone" />
          {titulo}
        </h3>
        <span className="sv-grupo-contagem">
          {conversas.length}
          <span className="sr-only"> {conversas.length === 1 ? 'conversa' : 'conversas'}</span>
        </span>
      </div>
      {conversas.length === 0 ? (
        <p className="sv-grupo-vazio">{vazio}</p>
      ) : (
        <ul className="sv-grupo-lista">
          {conversas.map((conversa) => (
            <LinhaDaSupervisao key={conversa.id} conversa={conversa} rotulos={rotulos} onAbrir={onAbrir} />
          ))}
        </ul>
      )}
    </section>
  );
});

// `grupos`: { espera, atendimento, automacao } já filtrados e ordenados; cada
// lista só troca de referência quando o que ela mostra muda.
function ListaDaSupervisao({ estado, grupos, visao, total, sufixoDoVazio, rotulos, onAbrir, onTentarDeNovo }) {
  const tituloId = useId();
  const visiveis = GRUPOS.filter((g) => visao === 'todos' || visao === g.chave);
  return (
    <section className="sv-cartao sv-conversas" data-lista="ao-vivo" aria-labelledby={tituloId}>
      <h2 id={tituloId} className="sv-cartao-titulo">
        Conversas{estado === 'pronto' && <span className="sv-cartao-contagem"> ({total})</span>}
      </h2>
      {estado === 'carregando' && <p role="status" className="sv-estado">Carregando conversas…</p>}
      {estado === 'sem-acesso' && <p role="alert" className="sv-estado is-erro">Você não tem acesso ao painel de atendimentos.</p>}
      {estado === 'erro' && (
        <div role="alert" className="sv-estado is-erro">
          <span>Não foi possível carregar as conversas.</span>
          <button type="button" className="sv-botao-texto" onClick={onTentarDeNovo}>Tentar de novo</button>
        </div>
      )}
      {estado === 'pronto' && (
        <>
          {total > 0 && <Colunas />}
          {visiveis.map((g) => (
            <Grupo
              key={g.chave}
              chave={g.chave}
              titulo={g.titulo}
              Icone={g.Icone}
              conversas={grupos[g.chave]}
              vazio={`${g.vazio}${sufixoDoVazio}`}
              rotulos={rotulos}
              onAbrir={onAbrir}
            />
          ))}
        </>
      )}
    </section>
  );
}

export default memo(ListaDaSupervisao);
