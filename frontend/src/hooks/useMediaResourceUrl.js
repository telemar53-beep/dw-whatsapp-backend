import { useCallback, useRef, useState } from 'react';
import { useMediaToken } from '../contexts/MediaTokenContext';

/**
 * A URL de um recurso protegido (mídia ou avatar), congelada no primeiro render.
 *
 * `useState` com função inicializadora roda uma vez só: a URL nasce com o token
 * que existia no mount e NÃO se refaz quando o token é renovado. É isso que
 * impede o re-download em massa, o reinício de áudio/vídeo e a perda do Range
 * a cada 25 minutos.
 *
 * O preço é que uma URL montada agora pode vencer daqui a 30 minutos. Daí o
 * `tentarDeNovo`: quando o elemento falha, refazemos a URL UMA vez com o token
 * atual. Uma só — sem isso, um arquivo que sumiu de verdade entraria em laço.
 */
export function useMediaResourceUrl(construir) {
  const { obterToken, pronto } = useMediaToken();
  const jaTentou = useRef(false);
  const construirAnterior = useRef(construir);
  const [url, setUrl] = useState(() => (pronto ? construir(obterToken()) : null));

  // Enquanto o primeiro token não chega, `url` é null e o chamador mostra o
  // fallback. Assim que chega, monta uma vez.
  if (url === null && pronto) {
    setUrl(construir(obterToken()));
  }

  // O RECURSO mudou (outra foto, outra mensagem): aí a URL precisa mudar, senão
  // o navegador reusaria a imagem antiga do cache — é o que o `&v=<avatarPath>`
  // existe para evitar. Note que o token de mídia NÃO entra nas dependências de
  // `construir`: ele chega como argumento, vindo da ref do provider. Por isso
  // renovar o token não passa por aqui, e só a troca de recurso refaz a URL.
  if (construirAnterior.current !== construir) {
    construirAnterior.current = construir;
    jaTentou.current = false;
    if (pronto) setUrl(construir(obterToken()));
  }

  const tentarDeNovo = useCallback(() => {
    if (jaTentou.current) return false;
    jaTentou.current = true;
    setUrl(construir(obterToken()));
    return true;
  }, [construir, obterToken]);

  // Para link de download e abrir em nova aba: o usuário clica quando clica, e
  // um link parado 40 minutos no DOM não pode abrir com token vencido.
  const urlAgora = useCallback(() => construir(obterToken()), [construir, obterToken]);

  return { url, tentarDeNovo, urlAgora, pronto };
}

export default useMediaResourceUrl;
