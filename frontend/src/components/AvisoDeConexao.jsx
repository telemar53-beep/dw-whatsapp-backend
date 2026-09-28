import { useEffect, useRef, useState } from 'react';
import { useSocketConnection } from '../contexts/SocketContext';
import './aviso-de-conexao.css';

// O aviso ÚNICO de conexão (C7), no canto inferior direito da casca, em toda
// página. Antes eram dois para o mesmo estado: um balão de 3 s aqui e um
// indicador no menu — que no celular, com o menu em gaveta, não aparecia — e
// a volta da conexão surgia como um terceiro elemento, noutro lugar.
//
// Agora é um lugar só e um aviso por vez:
// - "Reconectando…" enquanto a conexão não volta (o estado todo, também no
//   celular);
// - no mesmo lugar, "Conexão restabelecida" por 3 s depois da volta — o mesmo
//   tempo de antes. Cair de novo nesses 3 s volta direto ao "Reconectando…".
//
// Nenhuma consulta nova: o estado é o do socket (SocketContext), pelos mesmos
// eventos. O anúncio vai para uma região viva sempre montada e sem papel (C7-3);
// o aviso visual é mudo, para não ser lido duas vezes.
const TEXTO = {
  caiu: 'Reconectando… as mensagens novas podem demorar a aparecer.',
  voltou: 'Conexão restabelecida.',
};
const TEMPO_DA_VOLTA = 3000;

function AvisoDeConexao() {
  const estado = useSocketConnection();
  const [aviso, setAviso] = useState(() => (estado === 'reconnecting' ? 'caiu' : null));
  const anteriorRef = useRef(estado);

  useEffect(() => {
    const anterior = anteriorRef.current;
    anteriorRef.current = estado;
    if (estado === 'reconnecting') {
      setAviso('caiu');
      return undefined;
    }
    if (estado === 'connected' && anterior === 'reconnecting') {
      setAviso('voltou');
      const relogio = setTimeout(() => setAviso(null), TEMPO_DA_VOLTA);
      return () => clearTimeout(relogio);
    }
    // Conectou sem ter caído (a primeira conexão) ou saiu da conta: nada.
    setAviso(null);
    return undefined;
  }, [estado]);

  return (
    <>
      <p aria-live="polite" data-aviso-conexao="" className="sr-only">{aviso ? TEXTO[aviso] : ''}</p>
      {aviso && (
        <div aria-hidden="true" className="aviso-conexao" data-estado={aviso}>
          <span className="aviso-conexao-ponto" />
          <span className="aviso-conexao-texto">{TEXTO[aviso]}</span>
        </div>
      )}
    </>
  );
}

export default AvisoDeConexao;
