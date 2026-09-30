import './aviso-de-sucesso.css';
import { useEffect } from 'react';

// Sucesso discreto depois de uma ação de canal (Fatia S2): "Canal excluído",
// "Canal adicionado"… A região `role="status"` fica sempre montada — o leitor
// de tela só anuncia o que muda dentro de uma região que já existia — e o
// texto some sozinho depois de alguns segundos, ou em "Fechar".
const DURACAO_MS = 6000;

export function AvisoDeSucesso({ aviso, onFechar }) {
  useEffect(() => {
    if (!aviso) return undefined;
    const relogio = setTimeout(onFechar, DURACAO_MS);
    return () => clearTimeout(relogio);
  }, [aviso, onFechar]);

  return (
    <div role="status" className={`cfg-aviso-sucesso${aviso ? ' is-visivel' : ''}`}>
      {aviso && (
        <div className="cfg-aviso-sucesso-caixa">
          <div>
            <strong>{aviso.titulo}</strong>
            {aviso.texto && <span>{aviso.texto}</span>}
          </div>
          <button type="button" onClick={onFechar}>Fechar</button>
        </div>
      )}
    </div>
  );
}
