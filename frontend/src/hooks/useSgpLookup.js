import { useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { lookupSgpClient, generateSgpDuplicateInvoice, ApiError } from '../services/api';

export function useSgpLookup() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [client, setClient] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [duplicateState, setDuplicateState] = useState({});
  // Só a busca mais recente escreve no estado. Uma busca lenta que volta depois
  // da seguinte mostrava o cliente anterior — e os botões de Pix/boleto
  // mandavam o contrato dele para a conversa aberta. A segunda via pertence à
  // busca em que foi pedida, pelo mesmo motivo.
  const buscaAtualRef = useRef(0);

  const search = useCallback(
    (cpf) => {
      buscaAtualRef.current += 1;
      const busca = buscaAtualRef.current;
      setLoading(true);
      setError(null);
      setErrorMessage(null);
      setClient(null);
      setContracts([]);
      setDuplicateState({});
      return lookupSgpClient(cpf, token)
        .then((data) => {
          if (buscaAtualRef.current !== busca) return;
          setClient(data.client);
          setContracts(data.contracts);
          setLoading(false);
        })
        .catch((err) => {
          if (buscaAtualRef.current !== busca) return;
          const notFound = err instanceof ApiError && err.status === 404;
          setError(notFound ? 'not_found' : 'error');
          setErrorMessage(notFound ? null : err.message);
          setLoading(false);
        });
    },
    [token]
  );

  const fetchDuplicate = useCallback(
    (contratoId) => {
      const busca = buscaAtualRef.current;
      setDuplicateState((prev) => ({ ...prev, [contratoId]: { loading: true, error: null } }));
      return generateSgpDuplicateInvoice(contratoId, token)
        .then((data) => {
          if (buscaAtualRef.current !== busca) return;
          setDuplicateState((prev) => ({ ...prev, [contratoId]: { loading: false, error: null, ...data } }));
        })
        .catch((err) => {
          if (buscaAtualRef.current !== busca) return;
          setDuplicateState((prev) => ({ ...prev, [contratoId]: { loading: false, error: 'error', errorMessage: err.message } }));
        });
    },
    [token]
  );

  return { client, contracts, loading, error, errorMessage, search, fetchDuplicate, duplicateState };
}
