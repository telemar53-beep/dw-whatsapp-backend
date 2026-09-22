import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ContactAvatar from './ContactAvatar';
import { useMediaToken } from '../contexts/MediaTokenContext';

vi.mock('../contexts/MediaTokenContext');

beforeEach(() => {
  vi.clearAllMocks();
  useMediaToken.mockReturnValue({ obterToken: () => 'media-tok', pronto: true });
});

describe('ContactAvatar', () => {
  test('renders the photo with the authenticated avatar URL when avatarPath is set', () => {
    render(<ContactAvatar contactId="c1" avatarPath="avatars/c1.jpg" displayName="Carlos" phoneNumber="+5511999990000" />);
    const img = screen.getByRole('img');
    expect(img.src).toBe('http://localhost:3000/api/contacts/c1/avatar?mediaToken=media-tok&v=avatars%2Fc1.jpg');
  });

  test('shows initials when a stored photo cannot be loaded', () => {
    render(<ContactAvatar contactId="c1" avatarPath="missing.jpg" displayName="Carlos Lima" />);
    // A primeira falha refaz a URL uma vez com o token atual - a foto pode ter
    // falhado so porque o token da URL venceu. So a segunda desiste.
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img')).toBeInTheDocument();
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('CL')).toBeInTheDocument();
  });

  test('changes the image URL when the avatarPath changes, so the browser does not reuse the cached photo', () => {
    const { rerender } = render(<ContactAvatar contactId="c1" avatarPath="one.jpg" displayName="Carlos" phoneNumber="+5511999990000" />);
    const before = screen.getByRole('img').src;
    rerender(<ContactAvatar contactId="c1" avatarPath="two.jpg" displayName="Carlos" phoneNumber="+5511999990000" />);
    const after = screen.getByRole('img').src;
    expect(after).not.toBe(before);
    expect(after).toContain('v=two.jpg');
  });

  test('renders the first letter of the display name when there is no avatarPath', () => {
    render(<ContactAvatar contactId="c1" avatarPath={null} displayName="Carlos" phoneNumber="+5511999990000" />);
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('falls back to the first digit of the phone number when there is no display name', () => {
    render(<ContactAvatar contactId="c1" avatarPath={null} displayName={null} phoneNumber="+5511999990000" />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  test('falls back to a question mark when there is neither a display name nor a phone number', () => {
    render(<ContactAvatar contactId="c1" avatarPath={null} displayName={null} phoneNumber={null} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  test('falls back to a question mark when the phone number has no digits after stripping', () => {
    render(<ContactAvatar contactId="c1" avatarPath={null} displayName={null} phoneNumber="+" />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  test('falls back past a whitespace-only display name to the phone digit', () => {
    render(<ContactAvatar contactId="c1" avatarPath={null} displayName="   " phoneNumber="+5511999990000" />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});

// O legado ?token=<JWT de sessao> saiu. O intervalo entre abrir o app e o
// primeiro media token chegar era justamente o que ele sustentava - e precisa
// continuar sem requisicao sem credencial, sem foto quebrada e sem retry.
describe('antes do primeiro media token', () => {
  beforeEach(() => {
    useMediaToken.mockReturnValue({ obterToken: () => null, pronto: false });
  });

  test('nao monta <img> nenhum: nada e requisitado sem credencial', () => {
    render(<ContactAvatar contactId="c1" avatarPath="avatars/c1.jpg" displayName="Carlos" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('mostra as iniciais, nao uma foto quebrada', () => {
    render(<ContactAvatar contactId="c1" avatarPath="avatars/c1.jpg" displayName="Carlos Lima" />);

    expect(screen.getByText('CL')).toBeInTheDocument();
  });

  test('quando o token chega, a foto aparece com mediaToken e sem JWT de sessao', () => {
    const { rerender } = render(<ContactAvatar contactId="c1" avatarPath="avatars/c1.jpg" displayName="Carlos" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    useMediaToken.mockReturnValue({ obterToken: () => 'media-tok', pronto: true });
    rerender(<ContactAvatar contactId="c1" avatarPath="avatars/c1.jpg" displayName="Carlos" />);

    const img = screen.getByRole('img');
    expect(img.src).toContain('mediaToken=media-tok');
    expect(img.src).not.toMatch(/[?&]token=/);
  });
});
