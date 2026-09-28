import { memo } from 'react';
import { IconeAtendimento, IconeEquipe, IconeRecolher } from '../icones';
import { IconeEspera, IconeAutomacao } from '../icones/supervisao';

// Os quatro números da operação ao vivo. Os três de estado são filtros de
// visão (aria-pressed): mostram só aquele grupo, e o segundo clique volta a
// mostrar tudo. "Equipe online" leva ao painel da equipe, que só existe ao
// lado da lista (no celular, o botão "Equipe" do cabeçalho faz esse papel).
//
// `null` é "não se sabe" (carregando ou erro) e aparece como "—": nenhum zero
// se passa por confirmado.

const ESTADOS = [
  { chave: 'espera', rotulo: 'Espera', Icone: IconeEspera },
  { chave: 'atendimento', rotulo: 'Em atendimento', Icone: IconeAtendimento },
  { chave: 'automacao', rotulo: 'Automação', Icone: IconeAutomacao },
];

const desconhecido = (valor) => valor === null || valor === undefined;
const mostrar = (valor) => (desconhecido(valor) ? '—' : valor);

function IndicadoresDaSupervisao({ espera, atendimento, automacao, online, visao, onVisao, onEquipe }) {
  const valores = { espera, atendimento, automacao };
  return (
    <div role="group" aria-label="Resumo da operação" className="sv-indicadores">
      {ESTADOS.map(({ chave, rotulo, Icone }) => (
        <button
          key={chave}
          type="button"
          className="sv-indicador"
          data-indicador={chave}
          aria-pressed={visao === chave}
          onClick={() => onVisao(chave)}
        >
          <Icone tamanho={20} className="sv-indicador-icone" />
          <span className="sv-indicador-rotulo">{rotulo}</span>
          <span className="sv-indicador-valor" data-desconhecido={desconhecido(valores[chave]) ? 'true' : undefined}>{mostrar(valores[chave])}</span>
          <IconeRecolher tamanho={16} className="sv-indicador-seta" />
        </button>
      ))}
      <button type="button" className="sv-indicador" data-indicador="equipe" onClick={onEquipe}>
        <IconeEquipe tamanho={20} className="sv-indicador-icone" />
        <span className="sv-indicador-rotulo">Equipe online</span>
        <span className="sv-indicador-valor" data-desconhecido={desconhecido(online) ? 'true' : undefined}>{mostrar(online)}</span>
        <IconeRecolher tamanho={16} className="sv-indicador-seta" />
      </button>
    </div>
  );
}

export default memo(IndicadoresDaSupervisao);
