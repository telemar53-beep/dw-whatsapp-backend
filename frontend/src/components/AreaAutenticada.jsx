import { SocketProvider } from '../contexts/SocketContext';
import { AgentsProvider } from '../contexts/AgentsContext';
import { MediaTokenProvider } from '../contexts/MediaTokenContext';
import AppShell from './AppShell';

// Os provedores que só existem com sessão, junto da casca. Chegam sob demanda,
// no mesmo trecho da AppShell: quem abre /login sem sessão não baixa nem
// avalia o socket.io-client, o token de mídia nem a lista de atendentes.
//
// Ficam por DENTRO do ProtectedRoute (App.jsx): nenhum socket abre antes do
// token. A troca entre a casca normal e a densa não remonta este componente
// (mesma posição na árvore), então a conexão sobrevive à navegação.
function AreaAutenticada({ dense = false }) {
  return (
    // Dentro do AuthProvider porque precisa do JWT da sessão para pedir o
    // token de mídia; fora do SocketProvider porque não depende dele — a
    // emissão é uma chamada HTTP a cada 25 minutos, não um evento.
    <MediaTokenProvider>
      <SocketProvider>
        {/* Uma cópia só da lista de atendentes para a sessão. Não busca nada
            enquanto nenhum useAgents() estiver montado. */}
        <AgentsProvider>
          <AppShell dense={dense} />
        </AgentsProvider>
      </SocketProvider>
    </MediaTokenProvider>
  );
}

export default AreaAutenticada;
