import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getMyClosedConversations } from '../services/api';
import { aplicarContatoSalvo } from '../utils/contatoSalvo';

const PAGE_SIZE = 20;

export function useMyClosedConversations() {
  const { token } = useAuth();
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('loading');
  // Antes o erro do "Carregar mais" voltava calado (CVM-ENC-11).
  const [erroAoCarregarMais, setErroAoCarregarMais] = useState(false);
  // Cada recomeço da lista (1ª carga, "Tentar de novo") é uma geração nova: a
  // página de um "Carregar mais" que chegar depois é da lista anterior e não
  // entra — senão ela seria colada no fim da lista nova.
  const geracaoRef = useRef(0);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    geracaoRef.current += 1;
    const geracao = geracaoRef.current;
    setLoading(true);
    setStatus('loading');
    setErroAoCarregarMais(false);
    return getMyClosedConversations({ offset: 0, limit: PAGE_SIZE }, token)
      .then((data) => {
        if (geracao !== geracaoRef.current) return;
        setItems(data.items);
        setHasMore(data.hasMore);
        setLoading(false);
        setStatus('ready');
      })
      .catch((err) => {
        if (geracao !== geracaoRef.current) return;
        setLoading(false);
        setStatus(err && err.status === 403 ? 'forbidden' : 'error');
      });
  }, [token]);

  const loadMore = useCallback(() => {
    if (!token) return Promise.resolve();
    const geracao = geracaoRef.current;
    setLoading(true);
    setErroAoCarregarMais(false);
    return getMyClosedConversations({ offset: items.length, limit: PAGE_SIZE }, token)
      .then((data) => {
        if (geracao !== geracaoRef.current) return;
        setItems((prev) => [...prev, ...data.items]);
        setHasMore(data.hasMore);
        setLoading(false);
      })
      .catch(() => {
        if (geracao !== geracaoRef.current) return;
        setLoading(false);
        setErroAoCarregarMais(true);
      });
  }, [token, items.length]);

  useEffect(() => {
    refresh();
    // Only ever refetch from the start when the token itself changes, not on every
    // items-length change loadMore already causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // "Editar cliente" salvou num atendimento encerrado, e a rota não emite
  // evento: a lista guarda o que voltou do servidor, só nas conversas daquele
  // contato — reabrir o atendimento não traz a nota antiga.
  const aplicarContatoSalvoNaLista = useCallback((salvo) => {
    setItems((prev) => aplicarContatoSalvo(prev, salvo));
  }, []);

  return { items, hasMore, loading, status, loadMore, refresh, erroAoCarregarMais, aplicarContatoSalvo: aplicarContatoSalvoNaLista };
}
