import { getPublicCompany } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

// O nome da empresa para QUALQUER tela: vem da rota pública, sem token.
// useCompanyConfig (GET /api/admin/company) é só do cartão de administração —
// um atendente comum leva 403 nele, e o nome nunca apareceria para quem mais
// usa o sistema. A rota fora do ar não derruba tela nenhuma: o nome só some.
export function useCompanyName() {
  const { data, status, error, refresh } = useAsyncResource(
    () => getPublicCompany().then((data) => (data && data.name) || ''),
    [],
    { initial: '' }
  );
  return { name: data, status, error, loading: status === 'loading', refresh };
}
