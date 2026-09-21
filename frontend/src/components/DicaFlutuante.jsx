import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

// A dica que mostra o nome da conversa no rail (lista colapsada em 72px).
//
// Antes ela era um `<span>` absoluto dentro da própria linha, posicionado em
// `left: calc(100% + 8px)` — ou seja, FORA do rail de propósito. Só que três
// ancestrais a recortavam (`.chat-workspace-list` com `overflow:clip`, as
// colunas e a raiz com `overflow:hidden`), então ela nunca chegava à tela: em
// modo rail o atendente via uma coluna de avatares sem nome nenhum, e o
// comentário do código dizia "o nome fica na dica".
//
// Tirar o `overflow` dos ancestrais quebraria a mesa — é ele que segura as
// três colunas. A saída é a dica não morar mais lá dentro: ela é portada para
// o `body` e posicionada por coordenada de tela a partir do retângulo do
// gatilho. `position: fixed` num portal do body não tem ancestral que recorte.
//
// A largura do rail e a da lista não mudam: nada é inserido no fluxo.
export function useDicaFlutuante() {
  const alvo = useRef(null);
  const [caixa, setCaixa] = useState(null);

  const mostrar = useCallback(() => {
    const el = alvo.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCaixa({ left: Math.round(r.right + 8), top: Math.round(r.top + r.height / 2) });
  }, []);

  const esconder = useCallback(() => setCaixa(null), []);

  // Rolar a lista com a dica aberta deixaria a coordenada velha, apontando
  // para a linha errada. Some em qualquer rolagem ou redimensionamento.
  useEffect(() => {
    if (!caixa) return undefined;
    window.addEventListener('scroll', esconder, true);
    window.addEventListener('resize', esconder);
    return () => {
      window.removeEventListener('scroll', esconder, true);
      window.removeEventListener('resize', esconder);
    };
  }, [caixa, esconder]);

  // `onFocus`/`onBlur` sobem no React, então o teclado abre a dica igual ao
  // ponteiro — era outro requisito que o `title` nativo não cumpre.
  const gatilho = {
    ref: alvo,
    onMouseEnter: mostrar,
    onMouseLeave: esconder,
    onFocus: mostrar,
    onBlur: esconder,
  };

  return { gatilho, caixa };
}

// `aria-hidden` porque quem anuncia o nome é o `aria-label` da própria linha —
// sem isso o leitor de tela falaria o nome duas vezes. E `pointer-events:none`
// no CSS: a dica nunca intercepta um clique do que estiver embaixo dela.
export function DicaFlutuante({ caixa, children }) {
  if (!caixa || typeof document === 'undefined') return null;
  return createPortal(
    <span className="chat-theme chat-rail-tip" aria-hidden="true" style={{ left: caixa.left, top: caixa.top }}>
      {children}
    </span>,
    document.body
  );
}
