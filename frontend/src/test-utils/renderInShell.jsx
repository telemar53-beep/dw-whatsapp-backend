import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { vi } from 'vitest';

export function renderInShell(ui, { path = '/', initialEntries = [path], context = {} } = {}) {
  const ctx = { openProfile: vi.fn(), closeMobileNav: vi.fn(), profileVersion: 0, setConversationOpen: vi.fn(), ...context };
  return {
    ctx,
    ...render(
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route element={<Outlet context={ctx} />}>
            <Route path={path} element={ui} />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  };
}
