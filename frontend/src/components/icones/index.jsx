import { Icone } from './Icone';
import * as desenhos from './desenhos';

// Família de ícones DW. Um componente por ícone, e não `<Icone nome="…">`:
// assim o empacotador leva para cada trecho só os desenhos que ele usa.
export { Icone };

// Navegação
export function IconeAtendimento(props) { return <Icone desenho={desenhos.atendimento} {...props} />; }
export function IconeFilas(props) { return <Icone desenho={desenhos.filas} {...props} />; }
export function IconeEquipe(props) { return <Icone desenho={desenhos.equipe} {...props} />; }
export function IconeCanais(props) { return <Icone desenho={desenhos.canais} {...props} />; }
export function IconeCampanhas(props) { return <Icone desenho={desenhos.campanhas} {...props} />; }
export function IconeRelatorios(props) { return <Icone desenho={desenhos.relatorios} {...props} />; }
export function IconeConfiguracoes(props) { return <Icone desenho={desenhos.configuracoes} {...props} />; }

// Lista e cabeçalho
export function IconeNovaConversa(props) { return <Icone desenho={desenhos.novaConversa} {...props} />; }
export function IconeMaisOpcoes(props) { return <Icone desenho={desenhos.maisOpcoes} {...props} />; }
export function IconeBuscar(props) { return <Icone desenho={desenhos.buscar} {...props} />; }
export function IconeInformacoes(props) { return <Icone desenho={desenhos.informacoes} {...props} />; }
export function IconeConsultarSgp(props) { return <Icone desenho={desenhos.consultarSgp} {...props} />; }
export function IconeTransferir(props) { return <Icone desenho={desenhos.transferir} {...props} />; }
export function IconeEncerrar(props) { return <Icone desenho={desenhos.encerrar} {...props} />; }
export function IconeHistorico(props) { return <Icone desenho={desenhos.historico} {...props} />; }
export function IconeDadosCliente(props) { return <Icone desenho={desenhos.dadosCliente} {...props} />; }
export function IconeRecolher(props) { return <Icone desenho={desenhos.recolher} {...props} />; }
export function IconeAssumir(props) { return <Icone desenho={desenhos.assumir} {...props} />; }

// Compositor
export function IconeAnexar(props) { return <Icone desenho={desenhos.anexar} {...props} />; }
export function IconeRespostasRapidas(props) { return <Icone desenho={desenhos.respostasRapidas} {...props} />; }
export function IconeEmoji(props) { return <Icone desenho={desenhos.emoji} {...props} />; }
export function IconeMicrofone(props) { return <Icone desenho={desenhos.microfone} {...props} />; }
export function IconeEnviar(props) { return <Icone desenho={desenhos.enviar} {...props} />; }

// Utilidades
export function IconeSom(props) { return <Icone desenho={desenhos.som} {...props} />; }
export function IconeSomDesativado(props) { return <Icone desenho={desenhos.somDesativado} {...props} />; }
export function IconeEncerrados(props) { return <Icone desenho={desenhos.encerrados} {...props} />; }
export function IconeSair(props) { return <Icone desenho={desenhos.sair} {...props} />; }
export function IconeMenu(props) { return <Icone desenho={desenhos.menu} {...props} />; }
