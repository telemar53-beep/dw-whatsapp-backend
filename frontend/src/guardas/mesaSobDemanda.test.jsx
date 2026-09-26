import { describe, test, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useCompanyName } from '../hooks/useCompanyName';

// Guarda do isolamento da mesa (fatia 1 do novo atendimento).
//
// A casca (AppShell) e o menu (SideNav) estão em TODA página autenticada. O
// que é só da mesa — o trilho, os ícones DW, o botão "Equipe", o CSS do
// trilho e a linha da lista — não pode entrar nesse caminho, senão viaja para
// Supervisão, Configurações, Relatórios e Campanhas. O app continuaria
// funcionando igual; só ficaria mais pesado.
//
// O caminho certo é o da página: a mesa (DashboardPage, rota sob demanda)
// importa o trilho e o desenha no encaixe que a casca reserva.
//
// Duas provas, como em rotasLazy.test.jsx:
//  1. LEITURA: nada do que é da mesa entra por import — estático ou
//     dinâmico — na casca, no menu e no ConversationListItem (que a Supervisão
//     também usa); e é a página da mesa que importa o trilho.
//  2. EFEITO: montar a casca, em qualquer rota, não avalia o módulo do trilho
//     nem o dos ícones.

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
function imports(relativo) {
  const fonte = readFileSync(join(RAIZ, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const estaticos = [...fonte.matchAll(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  const dinamicos = [...fonte.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  return [...estaticos, ...dinamicos];
}
const DA_MESA = /TrilhoDaMesa|\/icones|TeamPanel|trilho-mesa\.css|LinhaDaMesa|mesa\.css|ConversaDaMesa|conversa-mesa\.css/;

const avaliados = vi.hoisted(() => new Set());

vi.mock('../components/TrilhoDaMesa', async (original) => {
  avaliados.add('TrilhoDaMesa');
  return original();
});
vi.mock('../components/icones', async (original) => {
  avaliados.add('icones');
  return original();
});
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useCompanyName');
vi.mock('../components/ProfileModal', () => ({ default: () => null }));

function montarCasca(rota) {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<p>mesa</p>} />
          <Route path="/supervisao" element={<p>supervisão</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useAuth.mockReturnValue({ agent: { id: 'a1', name: 'Atendente A', role: 'admin' }, logout: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
  useCompanyName.mockReturnValue({ name: 'Empresa', status: 'ready' });
});

describe('a mesa não viaja com a casca', () => {
  // A conversa e o compositor também: são compartilhados com o modal da
  // Supervisão e dos Encerrados, e o cabeçalho e os ícones da mesa chegam pela
  // variante que a página passa (ConversaDaMesa.jsx).
  test.each(['components/AppShell.jsx', 'components/SideNav.jsx', 'components/ConversationListItem.jsx', 'components/ConversationView.jsx', 'components/MessageInput.jsx'])(
    '%s não importa nada que seja só da mesa',
    (arquivo) => {
      expect(imports(arquivo).filter((origem) => DA_MESA.test(origem))).toEqual([]);
    }
  );

  test('quem importa o trilho e a conversa da mesa é a página da mesa', () => {
    expect(imports('pages/DashboardPage.jsx')).toEqual(expect.arrayContaining(['../components/TrilhoDaMesa', '../components/ConversaDaMesa']));
  });

  // Importar o SideNav no trilho tiraria o menu do trecho da casca e criaria
  // um trecho compartilhado — um arquivo a mais em toda página.
  test('o trilho não importa o menu das outras páginas', () => {
    expect(imports('components/TrilhoDaMesa.jsx').filter((origem) => /SideNav|side-nav/.test(origem))).toEqual([]);
  });

  test.each([['/supervisao', 'supervisão'], ['/', 'mesa']])('a casca em %s não avalia o trilho nem os ícones DW', (rota, texto) => {
    montarCasca(rota);
    expect(screen.getByText(texto)).toBeInTheDocument();
    expect(avaliados.has('TrilhoDaMesa')).toBe(false);
    expect(avaliados.has('icones')).toBe(false);
  });
});
