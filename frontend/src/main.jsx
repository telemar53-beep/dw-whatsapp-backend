import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './index.css';

// O boundary fica DENTRO do StrictMode e por fora de tudo o mais: o primeiro
// render dos provedores (Auth, Socket, MediaToken) é onde uma exceção custa
// mais, porque derruba a árvore antes de existir qualquer tela.
//
// O que ele NÃO alcança — erro ao carregar o próprio módulo, antes de o React
// existir — é coberto pelo script inline do index.html.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
