import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { fetchMediaToken } from '../services/api';

const MediaTokenContext = createContext(null);

// O token dura 30 minutos no servidor; pedimos outro aos 25 para a troca nunca
// acontecer em cima do vencimento.
const RENOVAR_EM_MS = 25 * 60 * 1000;
// Se a renovação falhar (rede caiu), tenta de novo em 1 minuto em vez de ficar
// sem token até o próximo ciclo de 25 minutos.
const TENTAR_DE_NOVO_EM_MS = 60 * 1000;

/**
 * Guarda o token de leitura de mídia.
 *
 * O ponto todo deste provider está em NÃO expor o token como valor reativo. Ele
 * vive numa ref, e quem precisa dele chama `obterToken()`. Se o token fosse
 * estado, cada renovação re-renderizaria a árvore inteira, o React reescreveria
 * o `src` de toda imagem, áudio e vídeo montado, e o resultado seria um
 * re-download em massa a cada 25 minutos — além de reiniciar áudio e vídeo em
 * reprodução e matar o Range em andamento.
 *
 * O único estado que sai daqui é `pronto`, que muda uma vez: de "ainda não
 * temos token" para "temos". É o que permite os componentes esperarem o
 * primeiro token antes de montar a URL.
 *
 * O token NUNCA é persistido. Ele vale 30 minutos e é barato de repedir; grava-
 * lo no localStorage só aumentaria a superfície, ao lado de um token de sessão
 * que já mora lá.
 */
export function MediaTokenProvider({ children }) {
  const { token } = useAuth();
  const tokenDeMidia = useRef(null);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    if (!token) {
      tokenDeMidia.current = null;
      setPronto(false);
      return undefined;
    }

    let cancelado = false;
    let timer = null;

    function agendar(ms) {
      timer = setTimeout(buscar, ms);
    }

    async function buscar() {
      try {
        const { mediaToken } = await fetchMediaToken(token);
        if (cancelado) return;
        tokenDeMidia.current = mediaToken;
        setPronto(true);
        agendar(RENOVAR_EM_MS);
      } catch (err) {
        if (cancelado) return;
        // Sem token novo, o antigo continua valendo até vencer: não apagamos o
        // que temos, senão a tela perderia as imagens antes da hora.
        agendar(TENTAR_DE_NOVO_EM_MS);
      }
    }

    buscar();
    return () => {
      cancelado = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  // Estável de propósito: se esta função mudasse de identidade, ela entraria
  // nas dependências dos componentes e desfaria todo o cuidado acima.
  const obterToken = useCallback(() => tokenDeMidia.current, []);
  const valor = useMemo(() => ({ obterToken, pronto }), [obterToken, pronto]);

  return <MediaTokenContext.Provider value={valor}>{children}</MediaTokenContext.Provider>;
}

export function useMediaToken() {
  const ctx = useContext(MediaTokenContext);
  // Fora do provider (testes de componente isolado), a tela degrada para o
  // caminho legado em vez de quebrar.
  if (!ctx) return { obterToken: () => null, pronto: true };
  return ctx;
}

export default MediaTokenContext;
