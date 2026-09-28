import { Icone } from './Icone';
import * as desenhos from './desenhosSupervisao';

// Os ícones da visão geral da Supervisão, num módulo à parte da família: só a
// Supervisão os importará, e a mesa não leva os desenhos deles. Nesta rodada
// nenhuma tela os importa ainda (aprovação visual primeiro).
export function IconeFiltros(props) { return <Icone desenho={desenhos.filtros} {...props} />; }
export function IconeRemoverFiltro(props) { return <Icone desenho={desenhos.removerFiltro} {...props} />; }
export function IconeEspera(props) { return <Icone desenho={desenhos.espera} {...props} />; }
export function IconeAutomacao(props) { return <Icone desenho={desenhos.automacao} {...props} />; }
export function IconeSemResponsavel(props) { return <Icone desenho={desenhos.semResponsavel} {...props} />; }
