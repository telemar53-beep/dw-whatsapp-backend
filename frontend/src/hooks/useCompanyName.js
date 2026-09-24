import { getPublicCompany } from '../services/api';
import { useAsyncResource } from './useAsyncResource';
import { useCompanyContext } from '../contexts/CompanyContext';

// O nome da empresa para QUALQUER tela: vem da rota pública, sem token.
// useCompanyConfig (GET /api/admin/company) é só do cartão de administração —
// um atendente comum leva 403 nele, e o nome nunca apareceria para quem mais
// usa o sistema. A rota fora do ar não derruba tela nenhuma: o nome só some.
//
// A forma devolvida é a mesma de sempre. O que mudou é de onde vem: com o
// <CompanyProvider> acima (é o caso do aplicativo), todas as chamadas leem a
// mesma cópia, e sai UMA requisição em vez de uma por consumidor.
//
// SEM provider acima, cai no comportamento antigo — um recurso próprio. Essa
// queda existe por um motivo concreto, não por gosto: oito arquivos de teste
// renderizam LoginPage, ConversationView, MessageInput e AppShell isolados,
// sem árvore de providers, e três deles trocam o valor mockado de
// `getPublicCompany` entre testes do mesmo arquivo — um chega a devolver uma
// promise que nunca resolve. Qualquer coisa compartilhada ou memoizada no
// nível do módulo faria um teste enxergar o valor que o anterior deixou.
//
// O preço dessa queda é que um provider esquecido não estoura: fica silencioso
// e só duplica requisição. Por isso a montagem é verificada POR MEDIÇÃO, e não
// por leitura — a contagem de requisições da tela de login está registrada na
// entrega desta branch.
export function useCompanyName() {
  const compartilhado = useCompanyContext();

  // Chamado sempre, para a ordem dos hooks não mudar entre renderizações.
  // `enabled` é o que impede a busca duplicada quando já existe o provider.
  const proprio = useAsyncResource(
    () => getPublicCompany().then((resposta) => (resposta && resposta.name) || ''),
    [],
    { initial: '', enabled: !compartilhado }
  );

  const fonte = compartilhado || {
    name: proprio.data,
    status: proprio.status,
    error: proprio.error,
    refresh: proprio.refresh,
  };

  return {
    name: fonte.name,
    status: fonte.status,
    error: fonte.error,
    loading: fonte.status === 'loading',
    refresh: fonte.refresh,
  };
}
