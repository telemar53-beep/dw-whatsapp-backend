import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ContactAvatar from './ContactAvatar';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('ContactAvatar', () => {
  test('renders the photo with the authenticated avatar URL when avatarPath is set', () => {
    render(<ContactAvatar contactId="c1" avatarPath="avatars/c1.jpg" displayName="Carlos" phoneNumber="+5511999990000" />);
    const img = screen.getByRole('img');
    expect(img.src).toBe('http://localhost:3000/api/contacts/c1/avatar?token=tok-123');
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
