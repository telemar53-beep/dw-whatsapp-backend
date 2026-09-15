import { useState } from 'react';
import ReasonsAdminTab from '../../../components/ReasonsAdminTab';
import { useAiConfig } from '../../../hooks/useAiConfig';

// O cartão é dono do botão "Novo motivo" e dos filtros; o título e as abas
// vêm do RegistersLayout.
function ReasonsPage() {
  const [creating, setCreating] = useState(false);
  const { config } = useAiConfig();
  return (
    <ReasonsAdminTab creating={creating} onCreatingChange={setCreating} aiResolvedReasonId={config.triageResolvedReasonId || null} />
  );
}

export default ReasonsPage;
