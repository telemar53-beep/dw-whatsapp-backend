import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanForm from './PlanForm';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('PlanForm', () => {
  test('envia o preco como numero, aceitando virgula decimal', async () => {
    api.createPlan.mockResolvedValue({});
    render(<PlanForm plan={null} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Nome'), '500 Mega');
    await userEvent.type(screen.getByLabelText('Velocidade (Mbps)'), '500');
    await userEvent.type(screen.getByLabelText('Mensalidade (R$)'), '100,50');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(api.createPlan).toHaveBeenCalledWith(
        expect.objectContaining({ name: '500 Mega', speedMbps: 500, monthlyPrice: 100.5 }),
        'tok-123'
      )
    );
  });

  test('velocidade em branco vira null, nunca zero', async () => {
    api.createPlan.mockResolvedValue({});
    render(<PlanForm plan={null} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Nome'), 'TV');
    await userEvent.type(screen.getByLabelText('Mensalidade (R$)'), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(api.createPlan).toHaveBeenCalledWith(expect.objectContaining({ speedMbps: null }), 'tok-123')
    );
  });

  test('recusa mensalidade em branco sem chamar a API', async () => {
    render(<PlanForm plan={null} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Nome'), 'Sem preco');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/mensalidade/i);
    expect(api.createPlan).not.toHaveBeenCalled();
  });

  test('editar manda PATCH com o id e nao cria outro plano', async () => {
    api.updatePlan.mockResolvedValue({});
    const plano = {
      id: 'p1', name: '600 Mega', speedMbps: 600, monthlyPrice: 130,
      installCondition: 'Gratis', active: true, sortOrder: 1, note: 'interno',
    };
    render(<PlanForm plan={plano} onSaved={vi.fn()} onCancel={vi.fn()} />);

    const preco = screen.getByLabelText('Mensalidade (R$)');
    await userEvent.clear(preco);
    await userEvent.type(preco, '150');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(api.updatePlan).toHaveBeenCalledWith('p1', expect.objectContaining({ monthlyPrice: 150 }), 'tok-123')
    );
    expect(api.createPlan).not.toHaveBeenCalled();
  });

  test('editar preenche os campos com o plano atual', () => {
    const plano = {
      id: 'p1', name: '600 Mega', speedMbps: 600, monthlyPrice: 130,
      installCondition: 'Gratis', active: false, sortOrder: 2, note: 'margem baixa',
    };
    render(<PlanForm plan={plano} onSaved={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText('Nome')).toHaveValue('600 Mega');
    expect(screen.getByLabelText('Velocidade (Mbps)')).toHaveValue('600');
    expect(screen.getByLabelText('Mensalidade (R$)')).toHaveValue('130,00');
    expect(screen.getByLabelText('Condição de instalação')).toHaveValue('Gratis');
    expect(screen.getByLabelText('Observação interna')).toHaveValue('margem baixa');
    expect(screen.getByLabelText('Plano ativo')).not.toBeChecked();
  });

  test('a observacao e apresentada como interna', () => {
    render(<PlanForm plan={null} onSaved={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/nunca é enviada ao cliente/i)).toBeInTheDocument();
  });

  test('falha da API vira mensagem, sem fechar o formulario', async () => {
    api.createPlan.mockRejectedValue(new Error('caiu'));
    const onSaved = vi.fn();
    render(<PlanForm plan={null} onSaved={onSaved} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Nome'), 'Teste');
    await userEvent.type(screen.getByLabelText('Mensalidade (R$)'), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
