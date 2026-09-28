import { useEffect, useState } from 'react';

// Um trecho que só chega quando é aberto (a transferência na mesa, o
// encerramento na conversa). É o carregador da Supervisão (SupervisionPage.jsx),
// aqui para quem mais precisar dele:
//
// sem React.lazy de propósito — o lazy suspende no primeiro render mesmo com o
// módulo já em memória, e o React 18 segura a troca do fallback pelo conteúdo
// por até 500 ms (medido em 27/09). Com o trecho em memória, o diálogo abre no
// mesmo render do clique; se o trecho não baixar, quem abriu avisa em vez de a
// falha subir até a rota. Nenhum trecho é pedido antes de ser preciso.
export function sobDemanda(carregar) {
  const modulo = { componente: null, pedido: null };
  modulo.carregar = () => {
    if (!modulo.pedido) {
      modulo.pedido = carregar()
        .then((m) => { modulo.componente = m.default; return m.default; })
        .catch((erro) => { modulo.pedido = null; throw erro; });
    }
    return modulo.pedido;
  };
  return modulo;
}

// O componente do módulo quando ele é preciso; enquanto o trecho baixa, null.
// `aoFalhar` precisa ser estável (useCallback): é dependência do efeito.
export function useSobDemanda(modulo, preciso, aoFalhar) {
  const [, setCarregado] = useState(0);
  useEffect(() => {
    if (!preciso || modulo.componente) return undefined;
    let valendo = true;
    modulo.carregar().then(
      () => { if (valendo) setCarregado((n) => n + 1); },
      () => { if (valendo) aoFalhar(); }
    );
    return () => { valendo = false; };
  }, [preciso, modulo, aoFalhar]);
  return preciso ? modulo.componente : null;
}
