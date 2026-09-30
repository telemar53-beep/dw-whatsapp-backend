import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import QrDoCanal, { INTERVALO_DO_QR_MS } from './QrDoCanal';
import { useAuth } from '../../../contexts/AuthContext';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../services/api');

// Dados fictícios.
const vendas = { id: 'c-vendas', type: 'baileys', name: 'Canal Vendas', phoneNumber: '+5500900000002', status: 'awaiting_qr' };
const IMG = (n) => `data:image/png;base64,QR${n}`;

function adiado() {
  let resolver;
  let rejeitar;
  const promessa = new Promise((res, rej) => { resolver = res; rejeitar = rej; });
  return { promessa, resolver, rejeitar };
}

function definirVisibilidade(estado) {
  Object.defineProperty(document, 'visibilityState', { value: estado, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
  let n = 0;
  // Reset (e não só clear): um "Once" que sobre de outro teste não vaza.
  api.fetchChannelQrImage.mockReset();
  api.fetchChannelQrImage.mockImplementation(() => Promise.resolve(IMG(++n)));
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  delete window.IntersectionObserver;
});

async function montar(props = {}) {
  const utils = render(<QrDoCanal channel={vendas} onRefresh={vi.fn()} {...props} />);
  await act(async () => {});
  return utils;
}

describe('QR do Baileys: busca e desenho', () => {
  test('busca com o token no cabeçalho (nunca na URL) e desenha a imagem', async () => {
    await montar();
    expect(api.fetchChannelQrImage).toHaveBeenCalledWith('c-vendas', 'tok');
    expect(screen.getByRole('img', { name: 'QR code para conectar Canal Vendas' })).toHaveAttribute('src', IMG(1));
    expect(screen.getByRole('heading', { name: 'Leia este código no WhatsApp' })).toBeInTheDocument();
  });

  test('não inventa contagem, validade nem "expirado"', async () => {
    await montar();
    expect(document.body).not.toHaveTextContent(/expira|expirado|validade|restam/i);
    expect(screen.getByText(/código renovado automaticamente/i)).toBeInTheDocument();
  });

  test('canal que não aguarda QR não desenha nada nem pede nada', async () => {
    await montar({ channel: { ...vendas, status: 'connected' } });
    expect(api.fetchChannelQrImage).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('QR do Baileys: renovação enquanto está visível', () => {
  test(`renova a cada ${INTERVALO_DO_QR_MS / 1000} s e troca a imagem`, async () => {
    await montar();
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_DO_QR_MS); });
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_DO_QR_MS); });
    expect(api.fetchChannelQrImage).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('img', { name: /QR code/ })).toHaveAttribute('src', IMG(3));
  });

  test('pausa com a aba do navegador oculta e retoma na hora ao voltar', async () => {
    await montar();
    act(() => definirVisibilidade('hidden'));
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_DO_QR_MS * 4); });
    expect(api.fetchChannelQrImage).toHaveBeenCalledTimes(1);
    await act(async () => { definirVisibilidade('visible'); await vi.advanceTimersByTimeAsync(0); });
    expect(api.fetchChannelQrImage).toHaveBeenCalledTimes(2);
  });

  test('não renova quando o QR está fora da tela', async () => {
    const observadores = [];
    window.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; observadores.push(this); }
      observe() { this.cb([{ isIntersecting: false }]); }
      disconnect() {}
    };
    await montar();
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_DO_QR_MS * 3); });
    // A primeira busca acontece ao montar; fora da tela, nenhuma renovação.
    expect(api.fetchChannelQrImage).toHaveBeenCalledTimes(1);
    await act(async () => { observadores[0].cb([{ isIntersecting: true }]); await vi.advanceTimersByTimeAsync(0); });
    expect(api.fetchChannelQrImage).toHaveBeenCalledTimes(2);
  });

  test('para na hora ao sair da tela', async () => {
    const { unmount } = await montar();
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_DO_QR_MS * 3); });
    expect(api.fetchChannelQrImage).toHaveBeenCalledTimes(1);
  });

  test('para na hora quando o canal conecta', async () => {
    const { rerender } = await montar();
    rerender(<QrDoCanal channel={{ ...vendas, status: 'connected' }} onRefresh={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_DO_QR_MS * 3); });
    expect(api.fetchChannelQrImage).toHaveBeenCalledTimes(1);
  });

  test('sem QR (404), relê o canal para descobrir se ele conectou', async () => {
    api.fetchChannelQrImage.mockRejectedValue(Object.assign(new Error('x'), { motivo: 'indisponivel' }));
    const onRefresh = vi.fn();
    await montar({ onRefresh });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/o código ainda não chegou/i)).toBeInTheDocument();
  });
});

describe('QR do Baileys: concorrência', () => {
  test('não dispara uma busca nova enquanto a anterior não respondeu', async () => {
    const lento = adiado();
    api.fetchChannelQrImage.mockImplementation(() => lento.promessa);
    await montar();
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_DO_QR_MS * 3); });
    expect(api.fetchChannelQrImage).toHaveBeenCalledTimes(1);
  });

  test('uma resposta atrasada não sobrescreve um código mais novo', async () => {
    const renovacao = adiado();
    const manual = adiado();
    api.fetchChannelQrImage
      .mockReturnValueOnce(Promise.resolve(IMG('inicial')))
      .mockReturnValueOnce(renovacao.promessa)
      .mockReturnValueOnce(manual.promessa);
    await montar();
    // A renovação automática sai e demora; "Atualizar agora" pede de novo.
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_DO_QR_MS); });
    await act(async () => { screen.getByRole('button', { name: 'Atualizar agora' }).click(); });
    await act(async () => { manual.resolver(IMG('nova')); });
    await act(async () => { renovacao.resolver(IMG('velha')); });
    expect(screen.getByRole('img', { name: /QR code/ })).toHaveAttribute('src', IMG('nova'));
  });
});

describe('QR do Baileys: falhas', () => {
  test('falha de rede diz o que houve, com "Tentar agora"', async () => {
    api.fetchChannelQrImage.mockRejectedValue(Object.assign(new Error('rede'), { motivo: 'erro' }));
    await montar();
    expect(screen.getByText(/não foi possível buscar o qr code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar agora' })).toBeInTheDocument();
  });

  test('sem permissão, não oferece tentar de novo e não fica pedindo', async () => {
    api.fetchChannelQrImage.mockRejectedValue(Object.assign(new Error('403'), { motivo: 'semPermissao' }));
    await montar();
    expect(screen.getByText(/sua conta não tem acesso/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tentar/i })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_DO_QR_MS * 3); });
    expect(api.fetchChannelQrImage).toHaveBeenCalledTimes(1);
  });
});
