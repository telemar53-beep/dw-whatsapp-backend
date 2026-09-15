import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom';
import { vi } from 'vitest';

// Sonda para testes que precisam ver a query string atual (ex.: filtros
// escritos na URL) sem precisar de um mock de useNavigate/useSearchParams.
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-search">{location.search}</span>;
}

export function renderInShell(ui, { path = '/', initialEntries = [path], context = {} } = {}) {
  const ctx = { openProfile: vi.fn(), closeMobileNav: vi.fn(), profileVersion: 0, setConversationOpen: vi.fn(), ...context };
  return {
    ctx,
    ...render(
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route
            element={
              <>
                <Outlet context={ctx} />
                <LocationProbe />
              </>
            }
          >
            <Route path={path} element={ui} />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  };
}
