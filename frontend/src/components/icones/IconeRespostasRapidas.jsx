import { Icone } from './Icone';
import { respostasRapidas } from './desenhoRespostasRapidas';

// Respostas rápidas é o único ícone DW que o compositor usa em qualquer tela.
// Fica fora do índice da família para que o trecho da conversa (que a
// Supervisão também baixa) leve só ele; o índice o reexporta.
export function IconeRespostasRapidas(props) { return <Icone desenho={respostasRapidas} {...props} />; }
