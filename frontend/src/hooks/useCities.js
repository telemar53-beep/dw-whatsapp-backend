import { useAuth } from '../contexts/AuthContext';
import { listCities } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

function useListaDeLugares(options) {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(
    () => listCities(token, options),
    [token, Boolean(options && options.includeLocalities)],
    { initial: [], enabled: Boolean(token) }
  );
  return { cities: data, status, error, loading: status === 'loading', refresh };
}

// Municípios, como sempre foi. Localidade NÃO entra aqui: quem já consumia
// `useCities` continua vendo exatamente o mesmo conjunto.
export function useCities() {
  return useListaDeLugares(undefined);
}

// Hierarquia completa, pedida explicitamente: a tela de cadastro e o seletor
// encadeado do contato.
export function usePlaces() {
  const { cities, ...resto } = useListaDeLugares({ includeLocalities: true });
  return { places: cities, ...resto };
}
