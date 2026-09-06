import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TeamPanel from './TeamPanel';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';

vi.mock('../hooks/useAgents');
vi.mock('../hooks/usePresence');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TeamPanel', () => {
  test('shows a message when there are no agents', () => {
    useAgents.mockReturnValue([]);
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);
    expect(screen.getByText(/nenhum atendente cadastrado/i)).toBeInTheDocument();
  });

  test('lists online agents before offline agents, alphabetically within each group', () => {
    useAgents.mockReturnValue([
      { id: 'a1', name: 'Carlos' },
      { id: 'a2', name: 'Ana' },
      { id: 'a3', name: 'Bruno' },
    ]);
    usePresence.mockReturnValue(new Set(['a1', 'a2']));
    render(<TeamPanel />);

    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Ana', 'Carlos', 'Bruno']);
  });

  test('shows an online dot for a connected agent and an offline dot for a disconnected one', () => {
    useAgents.mockReturnValue([
      { id: 'a1', name: 'Ana' },
      { id: 'a2', name: 'Bruno' },
    ]);
    usePresence.mockReturnValue(new Set(['a1']));
    render(<TeamPanel />);

    expect(screen.getByTitle('Online')).toBeInTheDocument();
    expect(screen.getByTitle('Offline')).toBeInTheDocument();
  });
});
