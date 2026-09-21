import { useEffect } from 'react';
import { useCompanyName } from './useCompanyName';

// O título da aba era `DW Telecom - Atendimento`, escrito no index.html: fixo
// no build, para qualquer instalação. Agora vem do nome público da empresa,
// com um fallback neutro enquanto a resposta não chega ou se ela falhar.
//
// O nome vem de `GET /api/public/company`, que não exige token — por isso o
// título já fica certo na tela de entrada, antes do acesso.
export function useTituloDaAba() {
  const { name } = useCompanyName();

  useEffect(() => {
    document.title = name ? `${name} · Atendimento` : 'Atendimento';
  }, [name]);
}
