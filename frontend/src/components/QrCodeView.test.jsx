import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QrCodeView from './QrCodeView';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

const canal = { id: 'ch1', name: 'Berg', status: 'awaiting_qr' };
const IMAGEM = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok' });
});

function falha(motivo) {
  return Object.assign(new Error(motivo), { motivo });
}

describe('QrCodeView', () => {
  test('desenha a imagem do QR no tema, sem iframe', async () => {
    api.fetchChannelQrImage.mockResolvedValue(IMAGEM);
    const { container } = render(<QrCodeView channel={canal} onRefresh={vi.fn()} />);

    const img = await screen.findByRole('img', { name: /qr code para conectar berg/i });
    expect(img).toHaveAttribute('src', IMAGEM);
    expect(container.querySelector('iframe')).toBeNull();
  });

  // O token do administrador ia na query string do iframe antigo. A tela nova
  // autentica pelo header; nada de token em URL nenhuma.
  test('busca com o token pelo header, nunca pela URL', async () => {
    api.fetchChannelQrImage.mockResolvedValue(IMAGEM);
    const { container } = render(<QrCodeView channel={canal} onRefresh={vi.fn()} />);
    await screen.findByRole('img', { name: /qr code/i });

    expect(api.fetchChannelQrImage).toHaveBeenCalledWith('ch1', 'tok');
    const comUrl = [...container.querySelectorAll('[src],[href]')]
      .map((el) => el.getAttribute('src') || el.getAttribute('href'))
      .filter(Boolean);
    expect(comUrl.some((url) => url.includes('token='))).toBe(false);
  });

  test('enquanto busca, diz que está gerando', () => {
    api.fetchChannelQrImage.mockReturnValue(new Promise(() => {}));
    render(<QrCodeView channel={canal} onRefresh={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/gerando qr code/i);
  });

  test('404 vira "nenhum QR disponível", com caminho para gerar outro', async () => {
    api.fetchChannelQrImage.mockRejectedValue(falha('indisponivel'));
    render(<QrCodeView channel={canal} onRefresh={vi.fn()} />);

    expect(await screen.findByText(/nenhum qr code disponível agora/i)).toBeInTheDocument();
    expect(screen.getByText(/reconectar/i)).toBeInTheDocument();
  });

  test('403 diz que falta permissão e não oferece tentar de novo', async () => {
    api.fetchChannelQrImage.mockRejectedValue(falha('semPermissao'));
    render(<QrCodeView channel={canal} onRefresh={vi.fn()} />);

    expect(await screen.findByText(/não tem acesso às credenciais/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tentar de novo/i })).not.toBeInTheDocument();
  });

  test('falha de rede vira erro com "Tentar de novo"', async () => {
    api.fetchChannelQrImage.mockRejectedValue(falha('erro'));
    render(<QrCodeView channel={canal} onRefresh={vi.fn()} />);

    expect(await screen.findByText(/não foi possível buscar o qr code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument();
  });

  // Regra da Etapa 5.7: se o HTML do endpoint mudar de formato, a tela falha
  // ALTO. Nada de voltar em silêncio para o iframe com token na URL.
  test('formato inesperado falha visível, sem cair para o iframe antigo', async () => {
    api.fetchChannelQrImage.mockRejectedValue(falha('formatoInesperado'));
    const { container } = render(<QrCodeView channel={canal} onRefresh={vi.fn()} />);

    expect(await screen.findByText(/formato que esta tela não reconhece/i)).toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument();
  });

  test('tentar de novo busca outra vez', async () => {
    api.fetchChannelQrImage.mockRejectedValueOnce(falha('erro')).mockResolvedValue(IMAGEM);
    render(<QrCodeView channel={canal} onRefresh={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: /tentar de novo/i }));
    await waitFor(() => expect(screen.getByRole('img', { name: /qr code/i })).toBeInTheDocument());
  });

  // Não existe tempo restante nem validade: o Baileys troca a string em memória
  // sem timestamp. A tela não pode inventar contagem.
  test('não mostra contagem, validade nem "expirado"', async () => {
    api.fetchChannelQrImage.mockResolvedValue(IMAGEM);
    const { container } = render(<QrCodeView channel={canal} onRefresh={vi.fn()} />);
    await screen.findByRole('img', { name: /qr code/i });

    expect(container.textContent).not.toMatch(/expir|segundos|válido até|restante/i);
  });

  test('canal conectado não desenha QR nenhum', () => {
    const { container } = render(<QrCodeView channel={{ ...canal, status: 'connected' }} onRefresh={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(api.fetchChannelQrImage).not.toHaveBeenCalled();
  });
});
