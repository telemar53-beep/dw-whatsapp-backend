import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageAttachment from './MessageAttachment';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('MessageAttachment', () => {
  test('renders nothing for a plain text message', () => {
    const { container } = render(<MessageAttachment message={{ id: 'm1', messageType: 'text', mediaPath: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders an image with the authenticated media URL', () => {
    render(<MessageAttachment message={{ id: 'm2', messageType: 'image', mediaPath: 'foo.jpg', mediaFilename: null }} />);
    const img = screen.getByRole('img');
    expect(img.src).toBe('http://localhost:3000/api/media/m2?token=tok-123');
    expect(img.className).toContain('max-w-full');
  });

  test('renders a sticker the same way as an image', () => {
    render(<MessageAttachment message={{ id: 'm3', messageType: 'sticker', mediaPath: 'bar.webp' }} />);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  test('renders an audio player', () => {
    render(<MessageAttachment message={{ id: 'm4', messageType: 'audio', mediaPath: 'baz.ogg' }} />);
    expect(document.querySelector('audio')).toBeInTheDocument();
    expect(document.querySelector('audio').src).toBe('http://localhost:3000/api/media/m4?token=tok-123');
    expect(document.querySelector('audio').className).toContain('max-w-full');
  });

  test('renders a video player', () => {
    render(<MessageAttachment message={{ id: 'm5', messageType: 'video', mediaPath: 'qux.mp4' }} />);
    expect(document.querySelector('video')).toBeInTheDocument();
    expect(document.querySelector('video').className).toContain('max-w-full');
  });

  test('renders a document download link with the filename', () => {
    render(<MessageAttachment message={{ id: 'm6', messageType: 'document', mediaPath: 'doc.pdf', mediaFilename: 'comprovante.pdf' }} />);
    const link = screen.getByRole('link', { name: /comprovante\.pdf/i });
    expect(link.href).toBe('http://localhost:3000/api/media/m6?token=tok-123');
  });

  test('renders a Google Maps link for a location message', () => {
    render(
      <MessageAttachment
        message={{ id: 'm7', messageType: 'location', locationLatitude: -3.119, locationLongitude: -60.021 }}
      />
    );
    const link = screen.getByRole('link', { name: /ver localiza/i });
    expect(link.href).toBe('https://www.google.com/maps?q=-3.119,-60.021');
  });

  test('áudio sem transcrição renderiza só o player', () => {
    const { container } = render(<MessageAttachment message={{ id: 'm1', messageType: 'audio', mediaPath: 'a.ogg' }} />);
    expect(container.querySelector('audio')).toBeInTheDocument();
    expect(screen.queryByText(/transcrição por ia/i)).not.toBeInTheDocument();
  });

  test('mostra Transcrevendo enquanto processa', () => {
    render(<MessageAttachment message={{ id: 'm1', messageType: 'audio', mediaPath: 'a.ogg', transcriptionStatus: 'processing' }} />);
    expect(screen.getByText(/transcrevendo/i)).toBeInTheDocument();
  });

  test('mostra o texto e o rótulo quando concluída, sem tirar o player', () => {
    const { container } = render(<MessageAttachment message={{
      id: 'm1', messageType: 'audio', mediaPath: 'a.ogg',
      transcriptionStatus: 'completed', transcription: 'minha internet caiu',
    }} />);
    expect(screen.getByText(/transcrição por ia/i)).toBeInTheDocument();
    expect(screen.getByText('minha internet caiu')).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeInTheDocument();
  });

  test('mostra aviso na falha', () => {
    const { container } = render(<MessageAttachment message={{ id: 'm1', messageType: 'audio', mediaPath: 'a.ogg', transcriptionStatus: 'failed' }} />);
    expect(screen.getByText(/não foi possível transcrever/i)).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeInTheDocument();
  });

  test('mostra aviso quando pulada por limite', () => {
    const { container } = render(<MessageAttachment message={{ id: 'm1', messageType: 'audio', mediaPath: 'a.ogg', transcriptionStatus: 'skipped' }} />);
    expect(screen.getByText(/não foi possível transcrever/i)).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeInTheDocument();
  });

  test('o player sobrevive ao estado de processamento', () => {
    // O atendente precisa poder ouvir o áudio enquanto a máquina ainda transcreve.
    const { container } = render(<MessageAttachment message={{ id: 'm1', messageType: 'audio', mediaPath: 'a.ogg', transcriptionStatus: 'processing' }} />);
    expect(container.querySelector('audio')).toBeInTheDocument();
  });
});
