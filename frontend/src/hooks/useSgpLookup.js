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
  // Pedido igual ao que ainda está no caminho não sai de novo: dois cliques em
  // "Buscar" com o mesmo documento, ou em "Consultar 2ª via" no mesmo contrato,
  // viravam duas chamadas ao SGP — e a 2ª via pode gerar Pix lá.
  const emAndamentoRef = useRef({ documento: null, contratos: new Set() });

  const search = useCallback(
    (cpf) => {
      const emAndamento = emAndamentoRef.current;
      if (emAndamento.documento === cpf) return undefined;
      emAndamento.documento = cpf;
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
        })
        .finally(() => {
          if (emAndamento.documento === cpf) emAndamento.documento = null;
        });
    },
    [token]
  );

  const fetchDuplicate = useCallback(
    (contratoId) => {
      const emAndamento = emAndamentoRef.current;
      if (emAndamento.contratos.has(contratoId)) return undefined;
      emAndamento.contratos.add(contratoId);
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
        })
        .finally(() => {
          emAndamento.contratos.delete(contratoId);
        });
    },
    [token]
  );

  return { client, contracts, loading, error, errorMessage, search, fetchDuplicate, duplicateState };
}
