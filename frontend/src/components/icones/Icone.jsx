import { createElement } from 'react';

// Moldura única da família DW: grade de 24, traço de 1,75, pontas e junções
// redondas, sem preenchimento, na cor do texto em volta (currentColor).
//
// Os atributos da família vêm DEPOIS das props, de propósito: quem usa o ícone
// escolhe tamanho e classe, nunca a espessura, a cor ou a grade. É isso que
// impede um ícone de sair da família numa tela qualquer.
//
// Decorativo por padrão — quem nomeia é o botão em volta, como no resto da
// aplicação. Com `titulo`, vira imagem com nome acessível, para o ícone que
// aparece sozinho.
//
// Um traço marcado 'cheio' no desenho (só a marca Pix, que é um sólido) sai
// preenchido na cor do texto e sem contorno. A cor continua sendo da moldura.
const CHEIO = { fill: 'currentColor', stroke: 'none' };

export function Icone({ desenho, tamanho = 20, titulo, className, ...resto }) {
  const acessibilidade = titulo
    ? { role: 'img', 'aria-label': titulo }
    : { 'aria-hidden': 'true', focusable: 'false' };
  return (
    <svg
      {...resto}
      {...acessibilidade}
      className={className}
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {desenho.map(([elemento, geometria, preenchimento], indice) =>
        createElement(elemento, preenchimento === 'cheio' ? { key: indice, ...geometria, ...CHEIO } : { key: indice, ...geometria })
      )}
    </svg>
  );
}
