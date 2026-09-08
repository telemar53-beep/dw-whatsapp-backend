import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageInput from './MessageInput';

class FakeMediaRecorder {
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.mimeType = options && options.mimeType;
    FakeMediaRecorder.instances.push(this);
  }
  start() {}
  stop() {
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(['fake-audio-bytes'], { type: this.mimeType || 'audio/webm' }) });
    }
    if (this.onstop) this.onstop();
  }
}
FakeMediaRecorder.isTypeSupported = vi.fn().mockReturnValue(true);
FakeMediaRecorder.instances = [];

beforeEach(() => {
  vi.clearAllMocks();
  FakeMediaRecorder.instances = [];
  global.MediaRecorder = FakeMediaRecorder;
  const fakeTrack = { stop: vi.fn() };
  global.navigator.mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [fakeTrack] }),
  };
});

describe('MessageInput', () => {
  test('records audio via the microphone button and sends it as a file', async () => {
    const onSend = vi.fn().mockResolvedValue({});
    render(<MessageInput onSend={onSend} />);

    await userEvent.click(screen.getByRole('button', { name: /gravar áudio/i }));
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true }));
    expect(screen.getByText(/gravando/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /parar gravação/i }));

    await waitFor(() => expect(screen.getByText(/gravação de áudio/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    const [textArg, fileArg, , isVoiceNoteArg] = onSend.mock.calls[0];
    expect(textArg).toBe('');
    expect(fileArg).toBeInstanceOf(File);
    expect(fileArg.type).toMatch(/audio/);
    // Flags it as a voice note, so WhatsApp renders a voice message and fetches it on
    // arrival instead of leaving the download to the recipient's auto-download settings.
    expect(isVoiceNoteArg).toBe(true);
  });

  test('does not flag a file picked from disk as a voice note', async () => {
    const onSend = vi.fn().mockResolvedValue({});
    const { container } = render(<MessageInput onSend={onSend} />);

    const input = container.querySelector('input[type="file"]');
    await userEvent.upload(input, new File(['musica'], 'musica.mp3', { type: 'audio/mpeg' }));
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][3]).toBe(false);
  });

  test('shows an error when microphone access is denied', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(new Error('Permission denied'));
    render(<MessageInput onSend={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /gravar áudio/i }));

    await waitFor(() => expect(screen.getByText(/não foi possível acessar o microfone/i)).toBeInTheDocument());
  });

  test('lets the attendant remove an attached recording before sending', async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    await userEvent.click(screen.getByRole('button', { name: /gravar áudio/i }));
    await waitFor(() => expect(screen.getByText(/gravando/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /parar gravação/i }));
    await waitFor(() => expect(screen.getByText(/gravação de áudio/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /remover/i }));

    expect(screen.queryByText(/gravação de áudio/i)).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  test('stops the microphone tracks after recording ends', async () => {
    const fakeTrack = { stop: vi.fn() };
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [fakeTrack] });
    render(<MessageInput onSend={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /gravar áudio/i }));
    await waitFor(() => expect(screen.getByText(/gravando/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /parar gravação/i }));

    await waitFor(() => expect(fakeTrack.stop).toHaveBeenCalled());
  });

  test('still sends plain text messages without touching the microphone', async () => {
    const onSend = vi.fn().mockResolvedValue({});
    render(<MessageInput onSend={onSend} />);

    await userEvent.type(screen.getByPlaceholderText(/digite uma mensagem/i), 'Oi');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Oi', null, null, false));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  test('selecting a quick reply fills the message field, replacing what was typed', async () => {
    const onSend = vi.fn();
    const quickReplies = [
      { id: 'qr-1', title: 'Boas-vindas', content: 'Olá! Como posso ajudar?' },
      { id: 'qr-2', title: 'Encerramento', content: 'Foi um prazer atender você!' },
    ];
    render(<MessageInput onSend={onSend} quickReplies={quickReplies} />);

    await userEvent.type(screen.getByPlaceholderText(/digite uma mensagem/i), 'rascunho');
    await userEvent.click(screen.getByRole('button', { name: /respostas rápidas/i }));
    await userEvent.click(screen.getByText('Boas-vindas'));

    expect(screen.getByPlaceholderText(/digite uma mensagem/i)).toHaveValue('Olá! Como posso ajudar?');
    expect(screen.queryByText('Encerramento')).not.toBeInTheDocument();
  });

  test('shows a message when there are no quick replies registered', async () => {
    render(<MessageInput onSend={vi.fn()} quickReplies={[]} />);

    await userEvent.click(screen.getByRole('button', { name: /respostas rápidas/i }));

    expect(screen.getByText(/nenhuma resposta cadastrada/i)).toBeInTheDocument();
  });

  test('shows a reply preview bar when replyingTo is set', () => {
    render(<MessageInput onSend={vi.fn()} replyingTo={{ id: 'msg-1', content: 'Qual o valor da fatura?', direction: 'inbound' }} onCancelReply={vi.fn()} />);
    expect(screen.getByText('Qual o valor da fatura?')).toBeInTheDocument();
  });

  test('shows no reply preview bar when replyingTo is null', () => {
    render(<MessageInput onSend={vi.fn()} replyingTo={null} onCancelReply={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /cancelar resposta/i })).not.toBeInTheDocument();
  });

  test('cancelling the reply preview calls onCancelReply', async () => {
    const onCancelReply = vi.fn();
    render(<MessageInput onSend={vi.fn()} replyingTo={{ id: 'msg-1', content: 'Qual o valor?', direction: 'inbound' }} onCancelReply={onCancelReply} />);

    await userEvent.click(screen.getByRole('button', { name: /cancelar resposta/i }));

    expect(onCancelReply).toHaveBeenCalled();
  });

  test('sends the repliedToMessageId as the third argument to onSend when replying', async () => {
    const onSend = vi.fn().mockResolvedValue({});
    render(<MessageInput onSend={onSend} replyingTo={{ id: 'msg-1', content: 'Qual o valor?', direction: 'inbound' }} onCancelReply={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/digite uma mensagem/i), 'R$150,00');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('R$150,00', null, 'msg-1', false));
  });
});
