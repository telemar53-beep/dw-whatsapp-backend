import { useState, useCallback } from 'react';
import { AlertDialog } from '../components/ui/AlertDialog';

// Par do `useConfirm`, para avisos que antes eram `window.alert`. Quem chama
// renderiza `{alertDialog}` — o diálogo vai para o portal, então pode ser
// renderizado de qualquer lugar da árvore.
export function useAlert() {
  const [aviso, setAviso] = useState(null);

  const avisar = useCallback((mensagem, opcoes = {}) => {
    setAviso({ mensagem, ...opcoes });
  }, []);

  const alertDialog = (
    <AlertDialog
      open={Boolean(aviso)}
      title={aviso && aviso.title}
      message={aviso && aviso.mensagem}
      confirmLabel={aviso && aviso.confirmLabel}
      onClose={() => setAviso(null)}
    />
  );

  // Quem troca de contexto sem remontar (a ConversationView) fecha o aviso
  // pendente — senão o "não foi possível" de A aparecia sobre B (N9, CLASSE-01).
  const dispensar = useCallback(() => setAviso(null), []);

  return { avisar, alertDialog, dispensar };
}
