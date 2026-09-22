import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentAvatar from './AgentAvatar';
import { useMediaToken } from '../contexts/MediaTokenContext';

vi.mock('../contexts/MediaTokenContext');

beforeEach(() => {
  useMediaToken.mockReturnValue({ obterToken: () => 'media-tok', pronto: true });
});

describe('AgentAvatar', () => {
  test('renders the photo with the authenticated avatar URL when avatarPath is set', () => {
    render(<AgentAvatar agentId="a1" avatarPath="avatars/a1.jpg" name="Carlos" />);
    const img = screen.getByRole('img');
    expect(img.src).toBe('http://localhost:3000/api/agents/a1/avatar?mediaToken=media-tok');
  });

  test('renders the first letter of the name when there is no avatarPath', () => {
    render(<AgentAvatar agentId="a1" avatarPath={null} name="Carlos" />);
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  test('renders a question mark fallback when there is no name either', () => {
    render(<AgentAvatar agentId="a1" avatarPath={null} name={null} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });
});
