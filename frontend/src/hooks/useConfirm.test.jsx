import { describe, test, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useConfirm } from './useConfirm';

function Demo() {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const ok = await confirm('Excluir o canal "X"?', { danger: true, confirmLabel: 'Excluir' });
          document.title = ok ? 'sim' : 'nao';
        }}
      >
        Abrir
      </button>
      {confirmDialog}
    </div>
  );
}

function DemoConcurrent() {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const [a, b] = await Promise.all([
            confirm('Primeiro diálogo?', { confirmLabel: 'Ok' }),
            confirm('Segundo diálogo?', { confirmLabel: 'Ok' }),
          ]);
          document.title = `${a}-${b}`;
        }}
      >
        Abrir dois
      </button>
      {confirmDialog}
    </div>
  );
}

describe('useConfirm', () => {
  test('confirmar resolve true e devolve o foco ao botão de origem', async () => {
    render(<Demo />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await userEvent.click(opener);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Excluir o canal "X"?');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(document.title).toBe('sim'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
  test('Esc cancela e resolve false', async () => {
    render(<Demo />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.title).toBe('nao'));
  });
  test('segundo confirm() enquanto o primeiro está pendente resolve false imediatamente e não toca o diálogo aberto', async () => {
    render(<DemoConcurrent />);
    const opener = screen.getByRole('button', { name: 'Abrir dois' });
    await userEvent.click(opener);
    // Verifica que o diálogo mostra a primeira mensagem (não foi sobrescrito pela segunda)
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Primeiro diálogo?');
    // Clica no botão Ok do primeiro diálogo - isso fará a primeira promise resolver true
    // e a segunda já deve estar resolvida como false
    await userEvent.click(screen.getByRole('button', { name: 'Ok' }));
    // Aguarda o título ser atualizado (true da primeira, false da segunda)
    await waitFor(() => expect(document.title).toBe('true-false'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
