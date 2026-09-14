import { useState, useEffect } from 'react';
import { getPublicCompany } from '../services/api';

// O nome da empresa para QUALQUER tela: vem da rota pública, sem token.
// useCompanyConfig (GET /api/admin/company) é só do cartão de administração —
// um atendente comum leva 403 nele, e o nome nunca apareceria para quem mais
// usa o sistema. A rota fora do ar não derruba tela nenhuma: o nome só some.
export function useCompanyName() {
  const [name, setName] = useState('');

  useEffect(() => {
    let ativo = true;
    getPublicCompany()
      .then((data) => {
        if (ativo) setName((data && data.name) || '');
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);

  return { name };
}
