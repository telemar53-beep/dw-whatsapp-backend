import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AsyncState } from './AsyncState';

describe('AsyncState', () => {
  test('loading mostra esqueleto e não mostra o texto de vazio', () => {
    render(<AsyncState status="loading" isEmpty emptyMessage="Nenhum setor cadastrado."><p>lista</p></AsyncState>);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum setor cadastrado.')).not.toBeInTheDocument();
    expect(screen.queryByText('lista')).not.toBeInTheDocument();
  });
  test('ready e vazio mostra o texto de vazio', () => {
    render(<AsyncState status="ready" isEmpty emptyMessage="Nenhum setor cadastrado."><p>lista</p></AsyncState>);
    expect(screen.getByText('Nenhum setor cadastrado.')).toBeInTheDocument();
  });
  test('ready com dados mostra os filhos', () => {
    render(<AsyncState status="ready" isEmpty={false} emptyMessage="x"><p>lista</p></AsyncState>);
    expect(screen.getByText('lista')).toBeInTheDocument();
  });
  test('error mostra a mensagem e tentar de novo', async () => {
    const onRetry = vi.fn();
    render(<AsyncState status="error" error="Falha de rede" onRetry={onRetry}><p>lista</p></AsyncState>);
    expect(screen.getByRole('alert')).toHaveTextContent('Falha de rede');
    await userEvent.click(screen.getByRole('button', { name: /tentar de novo/i }));
    expect(onRetry).toHaveBeenCalled();
  });
  test('forbidden explica a falta de permissão', () => {
    render(<AsyncState status="forbidden"><p>lista</p></AsyncState>);
    expect(screen.getByText(/não tem permissão/i)).toBeInTheDocument();
  });
});
