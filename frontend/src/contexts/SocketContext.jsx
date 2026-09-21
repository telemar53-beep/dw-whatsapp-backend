import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { API_BASE_URL } from '../services/api';

const SocketContext = createContext(null);
// Contexto separado de propósito: `useSocket()` continua devolvendo o socket
// puro, como todos os consumidores esperam hoje.
const SocketConnectionContext = createContext('idle');

export function SocketProvider({ children }) {
  const { token, logout } = useAuth();
  const [socket, setSocket] = useState(null);
  // Antes, uma queda de socket não aparecia em lugar nenhum: a lista congelava
  // e as mensagens simplesmente paravam de chegar, sem aviso, no meio do turno.
  const [connectionState, setConnectionState] = useState('idle');

  useEffect(() => {
    if (!token) {
      setSocket(null);
      setConnectionState('idle');
      return undefined;
    }
    const connection = io(API_BASE_URL, { auth: { token } });
    connection.on('connect_error', () => {
      // `active` distingue os dois erros no nivel do protocolo, sem depender
      // do texto — que aqui e sempre 'Unauthorized', para token ausente,
      // malformado, com assinatura ruim ou expirado.
      //
      // Recusa do middleware: o servidor manda um pacote CONNECT_ERROR e o
      // socket.io-client chama destroy() ANTES de avisar a aplicacao, o que
      // limpa as subscriptions ("clean subscriptions to avoid reconnections")
      // e fecha o Manager. Logo `active` ja e false aqui e o cliente nao vai
      // tentar de novo: e rejeicao definitiva da credencial.
      //
      // Falha de transporte (backend fora do ar, rede caindo): nenhum
      // destroy(), `active` continua true e o proprio socket.io segue o
      // cronograma de reconexao dele. Deslogar aqui derrubava a atendente no
      // meio do atendimento por um restart de servidor de poucos segundos.
      if (!connection.active) {
        logout();
        return;
      }
      setConnectionState('reconnecting');
    });
    connection.on('connect', () => setConnectionState('connected'));
    connection.on('disconnect', (reason) => {
      // 'io client disconnect' é a nossa própria saída (logout, troca de token,
      // desmontagem): não é queda e não deve virar aviso.
      setConnectionState(reason === 'io client disconnect' ? 'idle' : 'reconnecting');
    });
    setSocket(connection);
    return () => {
      connection.close();
    };
  }, [token, logout]);

  return (
    <SocketContext.Provider value={socket}>
      <SocketConnectionContext.Provider value={connectionState}>{children}</SocketConnectionContext.Provider>
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}

export function useSocketConnection() {
  return useContext(SocketConnectionContext);
}
