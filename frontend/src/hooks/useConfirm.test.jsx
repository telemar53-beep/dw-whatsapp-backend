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
});
