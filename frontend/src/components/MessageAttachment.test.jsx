import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  test('renders a native Pix card for a pix message, instead of the raw code', () => {
    render(
      <MessageAttachment
        message={{
          id: 'm8',
          messageType: 'pix',
          content: '000201ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
          metadata: { value: 135, dueDate: '2026-09-15' },
        }}
      />
    );
    expect(screen.getByText('Pix da fatura')).toBeInTheDocument();
    expect(screen.queryByText(/0123456789/)).not.toBeInTheDocument();
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

  test('mostra Transcrevendo enquanto pendente, mantendo o player', () => {
    const { container } = render(<MessageAttachment message={{ id: 'm1', messageType: 'audio', mediaPath: 'a.ogg', transcriptionStatus: 'pending' }} />);
    expect(screen.getByText(/transcrevendo/i)).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeInTheDocument();
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

// Comprovante do banco e print de erro chegam altos e estreitos: cabiam
// inteiros na tela e ficavam ilegiveis, e a atendente tinha que baixar o
// arquivo so para conseguir ler.
describe('visualizador de imagem com zoom', () => {
  const MENSAGEM = { id: 'm-zoom', messageType: 'image', mediaPath: 'comprovante.jpg', mediaFilename: 'comprovante.jpg' };

  async function abrirVisualizador() {
    render(<MessageAttachment message={MENSAGEM} />);
    await userEvent.click(screen.getByRole('button', { name: /abrir imagem em tela cheia/i }));
    return screen.getByRole('dialog');
  }

  test('a miniatura na conversa mostra a imagem inteira, sem cortar', () => {
    render(<MessageAttachment message={MENSAGEM} />);
    expect(screen.getByAltText('comprovante.jpg')).toHaveClass('object-contain');
  });

  test('shows a readable state when an audio file fails to load', () => {
    const { container } = render(<MessageAttachment message={{ id: 'm4', messageType: 'audio', mediaPath: 'missing.ogg' }} />);
    fireEvent.error(container.querySelector('audio'));
    expect(screen.getByRole('status')).toHaveTextContent('Áudio indisponível');
    expect(screen.queryByRole('button', { name: 'Reproduzir áudio' })).not.toBeInTheDocument();
  });

  test('shows a readable fallback if the stored image cannot be loaded', () => {
    render(<MessageAttachment message={{ id: 'm2', messageType: 'image', mediaPath: 'missing.jpg' }} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img', { name: 'Imagem indisponível' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir imagem em tela cheia' })).not.toBeInTheDocument();
  });

  test('abre com a imagem ajustada a tela', async () => {
    await abrirVisualizador();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  test('aumenta e diminui o zoom pelos botoes', async () => {
    await abrirVisualizador();

    await userEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }));
    expect(screen.getByText('125%')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /diminuir zoom/i }));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  test('nao diminui abaixo do tamanho ajustado', async () => {
    await abrirVisualizador();

    await userEvent.click(screen.getByRole('button', { name: /diminuir zoom/i }));
    await userEvent.click(screen.getByRole('button', { name: /diminuir zoom/i }));

    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  test('ajustar volta a imagem ao tamanho da tela', async () => {
    await abrirVisualizador();
    await userEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }));
    await userEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }));

    await userEvent.click(screen.getByRole('button', { name: /^ajustar$/i }));

    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  test('a roda do mouse amplia sem precisar de tecla nenhuma', async () => {
    const dialog = await abrirVisualizador();

    fireEvent.wheel(dialog, { deltaY: -100 });

    expect(screen.getByText('125%')).toBeInTheDocument();
  });

  test('oferece baixar a imagem', async () => {
    await abrirVisualizador();
    const baixar = screen.getByRole('link', { name: /baixar/i });
    expect(baixar).toHaveAttribute('download', 'comprovante.jpg');
  });

  // Sem isto, dar zoom num comprovante longo nao serve para nada: a pessoa
  // fica presa no meio da imagem, sem alcancar o topo nem o rodape.
  test('permite arrastar a imagem quando ela esta ampliada', async () => {
    const dialog = await abrirVisualizador();
    await userEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }));
    const imagem = within(dialog).getByAltText('comprovante.jpg');

    fireEvent.mouseDown(imagem, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 120 });
    fireEvent.mouseUp(window);

    expect(imagem.style.transform).toContain('translate');
    expect(imagem.style.transform).not.toContain('translate(0px, 0px)');
  });

  test('fechar e abrir de novo comeca do tamanho ajustado', async () => {
    await abrirVisualizador();
    await userEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }));
    await userEvent.click(screen.getByRole('button', { name: /fechar imagem/i }));

    await userEvent.click(screen.getByRole('button', { name: /abrir imagem em tela cheia/i }));

    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  test('clicar no fundo fecha, mas arrastar a imagem nao', async () => {
    const dialog = await abrirVisualizador();
    await userEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }));
    const imagem = within(dialog).getByAltText('comprovante.jpg');

    fireEvent.mouseDown(imagem, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 300 });
    fireEvent.mouseUp(window);
    fireEvent.click(dialog);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

// A triagem ja analisava comprovante; o atendente humano nao tinha como pedir a
// mesma coisa sem devolver a conversa para a IA.
describe('analisar comprovante pelo chat', () => {
  const IMAGEM = { id: 'm-1', messageType: 'image', mediaPath: 'c.jpg', mediaFilename: 'comprovante.jpg', direction: 'inbound' };

  test('nao oferece o botao sem a acao disponivel', () => {
    render(<MessageAttachment message={IMAGEM} />);
    expect(screen.queryByRole('button', { name: /analisar comprovante/i })).not.toBeInTheDocument();
  });

  test('oferece o botao numa imagem recebida do cliente', () => {
    render(<MessageAttachment message={IMAGEM} onAnalyzeReceipt={vi.fn()} />);
    expect(screen.getByRole('button', { name: /analisar comprovante/i })).toBeInTheDocument();
  });

  // Comprovante e o que o CLIENTE manda; analisar o que nos enviamos nao faz
  // sentido e so poluiria a conversa.
  test('nao oferece numa imagem que nos enviamos', () => {
    render(<MessageAttachment message={{ ...IMAGEM, direction: 'outbound' }} onAnalyzeReceipt={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /analisar comprovante/i })).not.toBeInTheDocument();
  });

  // Em PDF o botao nem aparece: melhor ausente do que presente e sem resposta.
  test('nao oferece num documento', () => {
    render(
      <MessageAttachment
        message={{ id: 'm-2', messageType: 'document', mediaPath: 'c.pdf', mediaFilename: 'c.pdf', direction: 'inbound' }}
        onAnalyzeReceipt={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /analisar comprovante/i })).not.toBeInTheDocument();
  });

  test('mostra o veredito depois de analisar', async () => {
    const onAnalyzeReceipt = vi.fn().mockResolvedValue({ analisado: true, valido: true, valor: 100, motivos: [] });
    render(<MessageAttachment message={IMAGEM} onAnalyzeReceipt={onAnalyzeReceipt} />);

    await userEvent.click(screen.getByRole('button', { name: /analisar comprovante/i }));

    expect(onAnalyzeReceipt).toHaveBeenCalledWith('m-1');
    expect(await screen.findByText(/o comprovante confere/i)).toBeInTheDocument();
  });

  test('destaca o comprovante ja usado', async () => {
    const onAnalyzeReceipt = vi.fn().mockResolvedValue({ analisado: true, valido: true, jaUtilizado: true, motivos: [] });
    render(<MessageAttachment message={IMAGEM} onAnalyzeReceipt={onAnalyzeReceipt} />);

    await userEvent.click(screen.getByRole('button', { name: /analisar comprovante/i }));

    expect(await screen.findByText(/ja foi usado antes|já foi usado antes/i)).toBeInTheDocument();
  });

  test('mostra o motivo quando a analise falha', async () => {
    const onAnalyzeReceipt = vi.fn().mockRejectedValue({ body: { error: 'A OpenAI não está configurada; não é possível ler o comprovante.' } });
    render(<MessageAttachment message={IMAGEM} onAnalyzeReceipt={onAnalyzeReceipt} />);

    await userEvent.click(screen.getByRole('button', { name: /analisar comprovante/i }));

    expect(await screen.findByText(/OpenAI não está configurada/i)).toBeInTheDocument();
  });
});

// Arquivo com mais de 12 meses e apagado, mas a MENSAGEM fica. Sem este aviso a
// bolha sumiria sem explicacao e o historico ficaria com buracos.
describe('arquivo removido pela retencao', () => {
  test('imagem sem arquivo vira aviso, nao bolha vazia', () => {
    render(<MessageAttachment message={{ id: 'm-1', messageType: 'image', mediaPath: null, direction: 'inbound' }} />);

    expect(screen.getByText(/arquivo removido/i)).toBeInTheDocument();
  });

  test('video sem arquivo tambem avisa', () => {
    render(<MessageAttachment message={{ id: 'm-2', messageType: 'video', mediaPath: null, direction: 'inbound' }} />);

    expect(screen.getByText(/arquivo removido/i)).toBeInTheDocument();
  });

  test('mensagem de texto nao mostra aviso nenhum', () => {
    const { container } = render(<MessageAttachment message={{ id: 'm-3', messageType: 'text', mediaPath: null }} />);

    expect(container).toBeEmptyDOMElement();
  });

  test('nao oferece analisar comprovante num arquivo que ja saiu', () => {
    render(<MessageAttachment message={{ id: 'm-4', messageType: 'image', mediaPath: null, direction: 'inbound' }} onAnalyzeReceipt={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /analisar comprovante/i })).not.toBeInTheDocument();
  });
});
