import { Icone } from './Icone';
import { historico, dadosCliente, recolher } from './desenhosDaConversa';

// Os ícones que a conversa usa em qualquer tela (o painel "Dados do cliente"
// e o acesso a ele no popup da Supervisão e dos Encerrados). Ficam fora do
// índice da família para o trecho da conversa levar só estes três; o índice
// os reexporta.
export function IconeHistorico(props) { return <Icone desenho={historico} {...props} />; }
export function IconeDadosCliente(props) { return <Icone desenho={dadosCliente} {...props} />; }
export function IconeRecolher(props) { return <Icone desenho={recolher} {...props} />; }
