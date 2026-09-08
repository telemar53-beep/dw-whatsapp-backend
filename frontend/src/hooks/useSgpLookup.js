import { useState, useCallback } from 'react';
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

  const search = useCallback(
    (cpf) => {
      setLoading(true);
      setError(null);
      setErrorMessage(null);
      setClient(null);
      setContracts([]);
      setDuplicateState({});
      return lookupSgpClient(cpf, token)
        .then((data) => {
          setClient(data.client);
          setContracts(data.contracts);
          setLoading(false);
        })
        .catch((err) => {
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
      setDuplicateState((prev) => ({ ...prev, [contratoId]: { loading: true, error: null } }));
      return generateSgpDuplicateInvoice(contratoId, token)
        .then((data) => {
          setDuplicateState((prev) => ({ ...prev, [contratoId]: { loading: false, error: null, ...data } }));
        })
        .catch((err) => {
          setDuplicateState((prev) => ({ ...prev, [contratoId]: { loading: false, error: 'error', errorMessage: err.message } }));
        });
    },
    [token]
  );

  return { client, contracts, loading, error, errorMessage, search, fetchDuplicate, duplicateState };
}
