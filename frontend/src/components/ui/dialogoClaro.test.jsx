import { describe, test, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { AlertDialog } from './AlertDialog';
import { useConfirm } from '../../hooks/useConfirm';
import { useAlert } from '../../hooks/useAlert';

// Base clara das confirmações e dos avisos (Bloco 1, 28/09). Sólida, sem o
// desfoque, a animação e o ícone em ladrilho da base escura; o destrutivo diz
// o que faz no rótulo (não só na cor); a confirmação que tem uma ação espera a
// resposta e mostra o erro sem fechar (A4-4).

const AQUI = dirname(fileURLToPath(import.meta.url));

function Pergunta({ acao, aoResponder }) {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <>
      <button
        type="button"
        onClick={async () => aoResponder(await confirm('O atendimento de Cliente 101 será finalizado sem motivo.', {
          title: 'Finalizar sem motivo?', danger: true, confirmLabel: 'Finalizar', busyLabel: 'Finalizando…', acao,
        }))}
      >
        Abrir
      </button>
      {confirmDialog}
    </>
  );
}

describe('confirmação clara', () => {
  test('sólida e sem ícone da família antiga: título, mensagem e as duas saídas', () => {
    render(<ConfirmDialog open title="Descartar alterações?" message="O que você digitou será perdido." danger confirmLabel="Descartar" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const dialogo = screen.getByRole('alertdialog', { name: 'Descartar alterações?' });
    expect(dialogo).toHaveAccessibleDescription('O que você digitou será perdido.');
    expect(dialogo).toHaveClass('mc');
    expect(dialogo).not.toHaveClass('animate-wa-pop');
    expect(dialogo.className).not.toMatch(/backdrop-blur|shadow-\[/);
    expect(dialogo.parentElement.className).not.toMatch(/backdrop-blur/);
    expect(dialogo.querySelector('svg')).toBeNull();
    // O destrutivo nomeia a ação; a cor só reforça.
    expect(screen.getByRole('button', { name: 'Descartar' })).toHaveClass('is-perigo');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  test('Escape cancela e o foco volta a quem abriu', async () => {
    const user = userEvent.setup();
    const aoResponder = vi.fn();
    render(<Pergunta aoResponder={aoResponder} />);
    const abrir = screen.getByRole('button', { name: 'Abrir' });
    await user.click(abrir);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(aoResponder).toHaveBeenCalledWith(false));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(abrir).toHaveFocus();
  });

  test('sem ação: confirmar resolve true na hora', async () => {
    const user = userEvent.setup();
    const aoResponder = vi.fn();
    render(<Pergunta aoResponder={aoResponder} />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.click(screen.getByRole('button', { name: 'Finalizar' }));
    await waitFor(() => expect(aoResponder).toHaveBeenCalledWith(true));
  });

  test('com ação: espera a resposta, trava as saídas e o segundo clique', async () => {
    const user = userEvent.setup();
    let concluir;
    const acao = vi.fn(() => new Promise((resolve) => { concluir = resolve; }));
    const aoResponder = vi.fn();
    render(<Pergunta acao={acao} aoResponder={aoResponder} />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const finalizar = screen.getByRole('button', { name: 'Finalizar' });
    await user.click(finalizar);
    await user.click(finalizar);
    expect(acao).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Finalizando…' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    concluir();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(aoResponder).toHaveBeenCalledWith(true);
  });

  test('com ação que falha: o erro fica no diálogo, que continua aberto e permite tentar de novo', async () => {
    const user = userEvent.setup();
    const acao = vi.fn()
      .mockRejectedValueOnce({ body: { error: 'Conversation is closed' } })
      .mockResolvedValueOnce(undefined);
    const aoResponder = vi.fn();
    render(<Pergunta acao={acao} aoResponder={aoResponder} />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.click(screen.getByRole('button', { name: 'Finalizar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Este atendimento já foi encerrado.');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(aoResponder).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Finalizar' }));
    await waitFor(() => expect(aoResponder).toHaveBeenCalledWith(true));
    expect(acao).toHaveBeenCalledTimes(2);
  });

  test('com ação que falha, Cancelar resolve false', async () => {
    const user = userEvent.setup();
    const aoResponder = vi.fn();
    render(<Pergunta acao={() => Promise.reject(new Error('x'))} aoResponder={aoResponder} />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.click(screen.getByRole('button', { name: 'Finalizar' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(aoResponder).toHaveBeenCalledWith(false));
  });
});

function Aviso({ tom }) {
  const { avisar, alertDialog } = useAlert();
  const [n, setN] = useState(0);
  return (
    <>
      <button type="button" onClick={() => { setN(n + 1); avisar('Não foi possível abrir a transferência.', { tom }); }}>Avisar</button>
      {alertDialog}
    </>
  );
}

describe('aviso claro', () => {
  test.each([['informativo'], ['sucesso'], ['erro']])('tom %s: título, texto, "Entendi" com o foco e devolução do foco', async (tom) => {
    const user = userEvent.setup();
    render(<Aviso tom={tom} />);
    const abrir = screen.getByRole('button', { name: 'Avisar' });
    await user.click(abrir);
    const dialogo = screen.getByRole('alertdialog', { name: 'Aviso' });
    expect(dialogo).toHaveAccessibleDescription('Não foi possível abrir a transferência.');
    expect(dialogo.querySelector('[data-tom]')).toHaveAttribute('data-tom', tom);
    expect(dialogo.querySelector('svg')).toBeNull();
    const entendi = screen.getByRole('button', { name: 'Entendi' });
    expect(entendi).toHaveFocus();
    await user.click(entendi);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(abrir).toHaveFocus();
  });

  test('sem tom, é informativo; Escape fecha', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AlertDialog open message="Template enviado." onClose={onClose} />);
    expect(screen.getByRole('alertdialog').querySelector('[data-tom]')).toHaveAttribute('data-tom', 'informativo');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('folha da base clara', () => {
  test('nada de desfoque, animação, gradiente, brilho ou laranja; celular em tela cheia e campos de 16 px', () => {
    const folha = readFileSync(join(AQUI, 'dialogo-claro.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(folha).not.toMatch(/blur\(/);
    expect(folha).not.toMatch(/backdrop-filter:(?!\s*none)/);
    expect(folha).not.toMatch(/animation:(?!\s*none)/);
    expect(folha).not.toMatch(/gradient\(/);
    expect(folha).not.toMatch(/#(e5a16d|ff8d40|f5a524|d5a176|c39b75)/i);
    expect(folha).toMatch(/\.mc\.is-celular\s*\{[^}]*height:\s*100dvh/);
    expect(folha).toMatch(/\.is-celular[^{]*\.mc-entrada[^{]*\{[^}]*font-size:\s*16px/);
    expect(folha).not.toMatch(/overflow-x:\s*(auto|scroll)/);
  });
});
