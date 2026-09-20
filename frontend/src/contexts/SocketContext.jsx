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
      logout();
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
