import { createContext, useContext, useEffect, useState } from 'react';
import { textoDoTempo, horaDoEncerramento } from './regras';

// Um relógio só para a página inteira, que anda de minuto em minuto. Quem lê a
// hora é o texto do tempo de cada linha (consumidor do contexto), e não a
// linha: a cada minuto só esses textos redesenham — as linhas, memo, não.
const AgoraContext = createContext(0);

export function RelogioDaSupervisao({ children }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return <AgoraContext.Provider value={agora}>{children}</AgoraContext.Provider>;
}

export function TempoDecorrido({ desde }) {
  const agora = useContext(AgoraContext);
  return textoDoTempo(desde, agora || Date.now());
}

export function HoraDoEncerramento({ em }) {
  const agora = useContext(AgoraContext);
  return horaDoEncerramento(em, agora || Date.now());
}
