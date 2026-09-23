import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from './ErrorBoundary';

function Explode({ mensagem = 'boom' }) {
  throw new Error(mensagem);
}

beforeEach(() => {
  // O React escreve a exceção no console mesmo com o boundary tratando; e o
  // próprio boundary loga. Silenciado para o relatório do teste ficar legível.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  test('sem erro, não aparece e renderiza o filho', () => {
    render(
      <ErrorBoundary>
        <p>conteúdo normal</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('conteúdo normal')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // O ponto da entrega: hoje isto é tela branca, sem uma palavra.
  test('com erro, mostra a frase humana em vez de tela vazia', () => {
    render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/não foi possível abrir/i)).toBeInTheDocument();
  });

  test('a mensagem técnica fica atrás de "ver detalhes", mas está na página', async () => {
    render(
      <ErrorBoundary>
        <Explode mensagem="falha-de-teste-xyz" />
      </ErrorBoundary>
    );
    const detalhes = screen.getByText(/ver detalhes técnicos/i);
    expect(detalhes.closest('details')).not.toHaveAttribute('open');

    await userEvent.click(detalhes);
    expect(detalhes.closest('details')).toHaveAttribute('open');
    expect(screen.getByText(/falha-de-teste-xyz/)).toBeInTheDocument();
  });

  test('copiar leva o texto do erro para a área de transferência', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(
      <ErrorBoundary>
        <Explode mensagem="erro-copiavel" />
      </ErrorBoundary>
    );
    await userEvent.click(screen.getByRole('button', { name: /copiar detalhes/i }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('erro-copiavel'));
  });

  // Uma tela de erro que quebra ao ser usada é pior do que não ter tela de erro.
  test('sem área de transferência, copiar não derruba a tela', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>
    );
    await userEvent.click(screen.getByRole('button', { name: /copiar detalhes/i }));

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  // Se a folha de estilo for o que quebrou, classe utilitária não pinta nada.
  test('a tela não depende do CSS da aplicação', () => {
    render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>
    );
    const alerta = screen.getByRole('alert');
    expect(alerta).not.toHaveAttribute('class');
    expect(alerta.getAttribute('style')).toMatch(/background/);
  });
});
