import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import SideNav from './components/SideNav';
import './index.css';

// Esta origem local (porta 5174) contém somente a prévia do menu. Sem token,
// nenhuma conexão de atendimento é iniciada.
localStorage.removeItem('dw_token');
localStorage.setItem('dw_agent', JSON.stringify({ id: 'preview', name: 'Lucas Silva', role: 'admin' }));

const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  if (String(input) === 'http://localhost:3000/api/public/company') {
    return Promise.resolve(new Response(JSON.stringify({ name: 'DW Telecom' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  }
  return originalFetch(input, init);
};

function MenuPreview() {
  const [mobileOpen, setMobileOpen] = useState(() => window.innerWidth < 768);

  return (
    <div className="chat-theme flex h-dvh overflow-hidden bg-[#20272d] font-sans text-chat-text">
      <div className="flex min-h-0 min-w-0 flex-1 gap-3 p-0 md:p-3">
        <SideNav onProfileClick={() => {}} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
        <main className="flex min-w-0 flex-1 flex-col items-start justify-center px-6 md:px-12">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="mb-8 rounded-xl border border-white/20 px-4 py-2 text-sm md:hidden"
          >
            Abrir menu
          </button>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#f4a36a]">Prévia local</p>
          <h1 className="mt-3 font-display text-3xl font-semibold">Menu principal</h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-[#b9c4cb]">
            Este é o componente real do menu com um perfil demonstrativo. As demais áreas do sistema não foram carregadas nesta prévia.
          </p>
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/']}>
    <AuthProvider>
      <SocketProvider>
        <MenuPreview />
      </SocketProvider>
    </AuthProvider>
  </MemoryRouter>
);
