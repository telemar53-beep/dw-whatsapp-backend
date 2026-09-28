import { memo, useId, useMemo, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { IconeBuscar, IconeEquipe } from '../icones';
import { agentInitial } from '../../utils/agentDisplayName';

// A equipe: quem está online e com quantas conversas. Clicar num atendente
// filtra a lista por ele (como antes). A carga vem do painel NÃO filtrado,
// de propósito: filtrar a tela não muda quantas conversas o atendente tem.
//
// No desktop é um painel ao lado da lista; abaixo de 1200 px some (CSS) e fica
// atrás do botão "Equipe", que abre o mesmo conteúdo numa folha. A lista vem
// sempre primeiro.
//
// Com o painel sem resposta, nenhum número se passa por confirmado: carga e
// online viram "—" (`dadosVisiveis`).

const semAcento = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const LinhaDoAtendente = memo(function LinhaDoAtendente({ id, rotulo, completo, online, carga, cargaMaxima, dadosVisiveis, selecionado, onAlternar }) {
  const largura = dadosVisiveis && cargaMaxima ? Math.round((carga / cargaMaxima) * 100) : 0;
  return (
    <li className="sv-equipe-item">
      <button type="button" className="sv-atendente" aria-pressed={selecionado} data-online={online ? 'true' : 'false'} onClick={() => onAlternar('atendente', id)}>
        <span className="sv-atendente-inicial" aria-hidden="true">{agentInitial(rotulo)}</span>
        <span className="sv-atendente-texto">
          <span className="sv-equipe-nome" title={completo}>{rotulo}</span>
          <span className="sv-atendente-presenca"><i aria-hidden="true" />{online ? 'Online' : 'Offline'}</span>
        </span>
        <span className="sv-atendente-carga" data-zero={dadosVisiveis && carga === 0 ? 'true' : undefined} data-desconhecido={dadosVisiveis ? undefined : 'true'}>
          {dadosVisiveis ? carga : '—'}
          <span className="sr-only"> {carga === 1 ? 'conversa' : 'conversas'} em atendimento</span>
        </span>
        <span className="sv-atendente-barra" aria-hidden="true"><span style={{ width: `${largura}%` }} /></span>
      </button>
    </li>
  );
});

// `equipe`: [{ id, rotulo, completo, online, carga }], já na ordem do painel.
export const PainelDaEquipe = memo(function PainelDaEquipe({ equipe, online, dadosVisiveis, estado, selecionados, onAlternar, tituloId, buscaId }) {
  const [busca, setBusca] = useState('');
  const cargaMaxima = useMemo(() => Math.max(1, ...equipe.map((e) => e.carga)), [equipe]);
  const visiveis = useMemo(() => {
    const termo = semAcento(busca.trim());
    return termo ? equipe.filter((e) => semAcento(e.completo).includes(termo)) : equipe;
  }, [equipe, busca]);

  return (
    <>
      <div className="sv-equipe-cabeca">
        <h2 id={tituloId} className="sv-cartao-titulo">Equipe</h2>
        <span className="sv-equipe-online" data-desconhecido={dadosVisiveis ? undefined : 'true'}><i aria-hidden="true" />{dadosVisiveis ? online : '—'} online</span>
      </div>
      <label className="sv-equipe-busca">
        <IconeBuscar tamanho={16} />
        <input id={buscaId} type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar atendente" aria-label="Buscar atendente" />
      </label>
      {estado === 'loading' && <p role="status" className="sv-equipe-aviso">Carregando equipe…</p>}
      {estado === 'error' && <p role="alert" className="sv-equipe-aviso is-erro">Não foi possível carregar a equipe.</p>}
      {estado === 'ready' && equipe.length === 0 && <p className="sv-equipe-aviso">Nenhum atendente cadastrado.</p>}
      {equipe.length > 0 && visiveis.length === 0 && <p className="sv-equipe-aviso">Nenhum atendente com esse nome.</p>}
      <ul className="sv-equipe-lista">
        {visiveis.map((e) => (
          <LinhaDoAtendente
            key={e.id}
            id={e.id}
            rotulo={e.rotulo}
            completo={e.completo}
            online={e.online}
            carga={e.carga}
            cargaMaxima={cargaMaxima}
            dadosVisiveis={dadosVisiveis}
            selecionado={selecionados.includes(e.id)}
            onAlternar={onAlternar}
          />
        ))}
      </ul>
    </>
  );
});

export const EquipeLateral = memo(function EquipeLateral(props) {
  const tituloId = useId();
  return (
    <aside className="sv-cartao sv-equipe-lateral" aria-labelledby={tituloId}>
      <PainelDaEquipe {...props} tituloId={tituloId} buscaId="sv-equipe-busca" />
    </aside>
  );
});

// Botão do celular e do tablet: "Equipe · N online", que abre a folha.
export const BotaoDaEquipe = memo(function BotaoDaEquipe({ online, dadosVisiveis, aberto, onAbrir }) {
  const numero = dadosVisiveis ? online : '—';
  return (
    <button type="button" className="sv-equipe-botao" aria-label={`Equipe, ${numero} online`} aria-haspopup="dialog" aria-expanded={aberto} onClick={onAbrir}>
      <IconeEquipe tamanho={18} />
      Equipe
      <span className="sv-equipe-botao-online" data-desconhecido={dadosVisiveis ? undefined : 'true'}><i aria-hidden="true" />{numero}</span>
    </button>
  );
});

// A folha: o mesmo painel, num diálogo claro que sobe do rodapé. Sem desfoque
// e sem animação (supervisao.css); fecha com Esc, com toque fora e em "Fechar",
// e o Dialog devolve o foco ao botão que a abriu.
export function FolhaDaEquipe({ onFechar, ...props }) {
  const tituloId = useId();
  return (
    // Foco no próprio diálogo, e não na busca: no celular, focar o campo
    // abria o teclado por cima da equipe assim que a folha subia.
    <Dialog variant="supervisao-equipe" labelledBy={tituloId} onClose={onFechar} dismissible={false} closeOnBackdrop initialFocus="dialog" size="max-w-lg">
      <div className="sv-equipe-folha">
        <PainelDaEquipe {...props} tituloId={tituloId} />
        <div className="sv-equipe-folha-rodape">
          <button type="button" className="sv-botao-secundario" onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </Dialog>
  );
}
