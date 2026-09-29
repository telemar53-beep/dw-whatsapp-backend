import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SegredoGeradoDialog } from './SegredoGeradoDialog';

// O jsdom não tem PointerEvent: o clique no fundo é descer e soltar no mesmo
// ponto, como no Dialog.test.jsx.
function ponteiro(alvo, tipo, x, y) {
  fireEvent(alvo, new MouseEvent(tipo, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
}

const PROPS = {
  open: true,
  titulo: 'Nova chave gerada',
  explicacao: 'Ela aparece só agora.',
  rotulo: 'Chave de API',
  segredo: 'chave-ficticia-123',
  rotuloCopiar: 'Copiar chave',
  confirmacaoCopia: 'Chave copiada.',
  rotuloFechar: 'Já guardei a chave',
};

function areaDeTransferencia(writeText) {
  Object.defineProperty(navigator, 'clipboard', { value: writeText ? { writeText } : undefined, configurable: true });
}

afterEach(() => {
  areaDeTransferencia(undefined);
});

describe('SegredoGeradoDialog', () => {
  test('mostra o segredo num campo só de leitura, com o nome do que ele é', () => {
    render(<SegredoGeradoDialog {...PROPS} onClose={vi.fn()} />);
    expect(screen.getByRole('alertdialog', { name: 'Nova chave gerada' })).toBeInTheDocument();
    const campo = screen.getByLabelText('Chave de API');
    expect(campo).toHaveValue('chave-ficticia-123');
    expect(campo).toHaveAttribute('readonly');
  });

  test('Escape e clique no fundo não fecham, e não existe "x"', () => {
    const onClose = vi.fn();
    render(<SegredoGeradoDialog {...PROPS} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    const fundo = screen.getByRole('alertdialog').parentElement;
    ponteiro(fundo, 'pointerdown', 10, 10);
    ponteiro(fundo, 'pointerup', 11, 11);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Chave de API')).toHaveValue('chave-ficticia-123');
    expect(screen.queryByRole('button', { name: /^fechar$/i })).not.toBeInTheDocument();
  });

  test('fecha só pela ação explícita', () => {
    const onClose = vi.fn();
    render(<SegredoGeradoDialog {...PROPS} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Já guardei a chave' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('copiar com sucesso avisa que copiou', async () => {
    const writeText = vi.fn().mockResolvedValue();
    areaDeTransferencia(writeText);
    render(<SegredoGeradoDialog {...PROPS} onClose={vi.fn()} />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copiar chave' })); });

    expect(writeText).toHaveBeenCalledWith('chave-ficticia-123');
    expect(screen.getByRole('status')).toHaveTextContent('Chave copiada.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('copiar com falha diz o que fazer e o segredo continua na tela', async () => {
    areaDeTransferencia(vi.fn().mockRejectedValue(new Error('negado')));
    render(<SegredoGeradoDialog {...PROPS} onClose={vi.fn()} />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copiar chave' })); });

    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível copiar/i);
    expect(screen.getByRole('status')).not.toHaveTextContent('Chave copiada.');
    expect(screen.getByLabelText('Chave de API')).toHaveValue('chave-ficticia-123');
  });

  test('sem área de transferência no navegador, também avisa em vez de falhar calado', async () => {
    areaDeTransferencia(undefined);
    render(<SegredoGeradoDialog {...PROPS} onClose={vi.fn()} />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copiar chave' })); });

    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível copiar/i);
  });

  test('fechado, não desenha nada', () => {
    render(<SegredoGeradoDialog {...PROPS} open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
