import { Icone } from './Icone';
import * as desenhos from './desenhosConfiguracoes';

// Os ícones de Configurações (Fatia S1), num módulo à parte da família: só a
// área de Configurações os importa, e a mesa não leva os desenhos deles.
// Um componente por ícone, e não `<Icone nome="…">`: o empacotador leva só os
// desenhos usados.

// Atendimento
export function IconeRegrasEHorarios(props) { return <Icone desenho={desenhos.regrasEHorarios} {...props} />; }
export function IconeHorario(props) { return <Icone desenho={desenhos.horario} {...props} />; }
export function IconeMensagens(props) { return <Icone desenho={desenhos.mensagens} {...props} />; }
export function IconeBoasVindas(props) { return <Icone desenho={desenhos.boasVindas} {...props} />; }
export function IconeAberturaEncerramento(props) { return <Icone desenho={desenhos.aberturaEncerramento} {...props} />; }
export function IconeAvisosPorCidade(props) { return <Icone desenho={desenhos.avisosPorCidade} {...props} />; }
export function IconeTemplates(props) { return <Icone desenho={desenhos.templates} {...props} />; }

// Automação
export function IconeTriagemPorMenu(props) { return <Icone desenho={desenhos.triagemPorMenu} {...props} />; }
export function IconeIdentificacao(props) { return <Icone desenho={desenhos.identificacao} {...props} />; }
export function IconeTranscricao(props) { return <Icone desenho={desenhos.transcricao} {...props} />; }
export function IconeAtendimentoNoturno(props) { return <Icone desenho={desenhos.atendimentoNoturno} {...props} />; }
export function IconeAcoesDaIa(props) { return <Icone desenho={desenhos.acoesDaIa} {...props} />; }
export function IconeIntegracoes(props) { return <Icone desenho={desenhos.integracoes} {...props} />; }
export function IconePixEBoleto(props) { return <Icone desenho={desenhos.pixEBoleto} {...props} />; }

// Administração
export function IconeSetores(props) { return <Icone desenho={desenhos.setores} {...props} />; }
export function IconePerfis(props) { return <Icone desenho={desenhos.perfis} {...props} />; }
export function IconeCadastros(props) { return <Icone desenho={desenhos.cadastros} {...props} />; }
export function IconeMotivos(props) { return <Icone desenho={desenhos.motivos} {...props} />; }
export function IconeCidades(props) { return <Icone desenho={desenhos.cidades} {...props} />; }
export function IconeEmpresa(props) { return <Icone desenho={desenhos.empresa} {...props} />; }

// Estado
export function IconeSemAcesso(props) { return <Icone desenho={desenhos.semAcesso} {...props} />; }
