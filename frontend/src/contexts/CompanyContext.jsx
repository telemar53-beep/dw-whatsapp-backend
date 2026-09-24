import { createContext, useContext, useMemo } from 'react';
import { getPublicCompany } from '../services/api';
import { useAsyncResource } from '../hooks/useAsyncResource';

const CompanyContext = createContext(null);

// Uma cópia só do nome público da empresa para a sessão inteira.
//
// Antes, cada `useCompanyName()` era um recurso privado. No caminho do login
// isso rendia DUAS chamadas simultâneas a `GET /api/public/company` — uma do
// `<TituloDaAba />`, que fica fora do `<Routes>`, e outra da própria
// `LoginPage` — e cada uma arrastava o seu preflight, somando quatro idas à
// rede onde uma bastava. Na tela de Atendimento eram três cópias
// (`SideNav`, `DashboardPage` e `ConversationView`).
//
// Fica FORA do `AuthProvider` de propósito: a rota é pública e não depende de
// token nenhum. É a primeira coisa de que a tela de entrada precisa.
export function CompanyProvider({ children }) {
  const { data, status, error, refresh } = useAsyncResource(
    () => getPublicCompany().then((resposta) => (resposta && resposta.name) || ''),
    [],
    { initial: '' }
  );

  const valor = useMemo(() => ({ name: data, status, error, refresh }), [data, status, error, refresh]);

  return <CompanyContext.Provider value={valor}>{children}</CompanyContext.Provider>;
}

// Devolve `null` quando não há provider acima, e isso é deliberado: ver a
// explicação da queda para o comportamento antigo em hooks/useCompanyName.js.
export function useCompanyContext() {
  return useContext(CompanyContext);
}

export default CompanyContext;
