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
    const [textArg, fileArg] = onSend.mock.calls[0];
    expect(textArg).toBe('');
    expect(fileArg).toBeInstanceOf(File);
    expect(fileArg.type).toMatch(/audio/);
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

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Oi', null));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
});
