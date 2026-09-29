import { Icone } from './Icone';
import { automacao } from './desenhoAutomacao';

// Sozinho no arquivo pelo mesmo motivo do desenho: a Supervisão e Configurações
// o usam, e nenhuma das duas leva os outros ícones da outra.
export function IconeAutomacao(props) { return <Icone desenho={automacao} {...props} />; }
