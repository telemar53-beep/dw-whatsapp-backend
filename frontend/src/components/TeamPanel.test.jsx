import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TeamPanel from './TeamPanel';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../hooks/useAgents');
vi.mock('../hooks/usePresence');
vi.mock('../contexts/AuthContext');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
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
      { id: 'a1', name: 'Carlos', avatarPath: null },
      { id: 'a2', name: 'Ana', avatarPath: null },
      { id: 'a3', name: 'Bruno', avatarPath: null },
    ]);
    usePresence.mockReturnValue(new Set(['a1', 'a2']));
    render(<TeamPanel />);

    const items = screen.getAllByRole('listitem').map((li) => li.querySelector('.truncate').textContent);
    expect(items).toEqual(['Ana', 'Carlos', 'Bruno']);
  });

  test('shows an online dot for a connected agent and an offline dot for a disconnected one', () => {
    useAgents.mockReturnValue([
      { id: 'a1', name: 'Ana', avatarPath: null },
      { id: 'a2', name: 'Bruno', avatarPath: null },
    ]);
    usePresence.mockReturnValue(new Set(['a1']));
    render(<TeamPanel />);

    expect(screen.getByTitle('Online')).toBeInTheDocument();
    expect(screen.getByTitle('Offline')).toBeInTheDocument();
  });

  test('shows each teammate\'s avatar', () => {
    useAgents.mockReturnValue([
      { id: 'a1', name: 'Ana', avatarPath: 'avatars/a1.jpg' },
      { id: 'a2', name: 'Bruno', avatarPath: null },
    ]);
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);

    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByText('B')).toBeInTheDocument();
  });
});
