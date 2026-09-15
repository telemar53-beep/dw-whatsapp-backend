import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Button, Card, Field, Toggle, ScopeBadge, Tabs, PageHeader, DangerZone } from './index';

describe('ui primitives', () => {
  test('Button loading fica desabilitado e anuncia ocupado', () => {
    render(<Button loading>Salvar</Button>);
    const button = screen.getByRole('button', { name: /salvar/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  test('Card mostra título, descrição, selo de escopo e rodapé', () => {
    render(
      <Card title="Empresa" description="Nome e comprovantes" scope="global" footer={<Button>Salvar empresa</Button>}>
        <p>corpo</p>
      </Card>
    );
    expect(screen.getByRole('heading', { name: 'Empresa' })).toBeInTheDocument();
    expect(screen.getByText('Nome e comprovantes')).toBeInTheDocument();
    expect(screen.getByText('Toda a operação')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar empresa' })).toBeInTheDocument();
  });

  test('Field liga rótulo, ajuda e erro ao campo', () => {
    render(
      <Field id="nome" label="Nome" help="Como aparece no menu" error="Obrigatório">
        <input id="nome" />
      </Field>
    );
    const input = screen.getByLabelText('Nome');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain('nome-help');
    expect(input.getAttribute('aria-describedby')).toContain('nome-error');
    expect(screen.getByText('Obrigatório')).toBeInTheDocument();
  });

  test('Toggle desabilitado explica o porquê', () => {
    render(<Toggle id="noturno" checked={false} onChange={() => {}} label="Atendimento noturno" disabled disabledReason="Precisa da triagem com IA ligada" />);
    const box = screen.getByRole('checkbox', { name: /atendimento noturno/i });
    expect(box).toBeDisabled();
    expect(box.getAttribute('aria-describedby')).toContain('noturno-reason');
    expect(screen.getByText('Precisa da triagem com IA ligada')).toBeInTheDocument();
  });

  test('ScopeBadge mostra os quatro escopos', () => {
    const { rerender } = render(<ScopeBadge scope="channel" />);
    expect(screen.getByText('Este canal')).toBeInTheDocument();
    rerender(<ScopeBadge scope="inherited" detail="Atendimento noturno" />);
    expect(screen.getByText('Herdado de Atendimento noturno')).toBeInTheDocument();
    rerender(<ScopeBadge scope="depends" detail="OpenAI" />);
    expect(screen.getByText('Depende de OpenAI')).toBeInTheDocument();
  });

  test('Tabs por botão marca a aba ativa e navega com setas', async () => {
    const onChange = vi.fn();
    render(<Tabs tabs={[{ key: 'a', label: 'Conexão' }, { key: 'b', label: 'Atendimento', count: 2 }]} active="a" onChange={onChange} />);
    const first = screen.getByRole('tab', { name: /conexão/i });
    expect(first).toHaveAttribute('aria-selected', 'true');
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  test('Tabs por rota viram links', () => {
    render(
      <MemoryRouter initialEntries={['/x/conexao']}>
        <Tabs tabs={[{ key: 'conexao', label: 'Conexão', to: '/x/conexao' }, { key: 'atendimento', label: 'Atendimento', to: '/x/atendimento' }]} />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: /conexão/i })).toHaveAttribute('aria-current', 'page');
  });

  test('PageHeader mostra breadcrumb, título e ação', () => {
    render(
      <MemoryRouter>
        <PageHeader crumbs={[{ label: 'Configurações', to: '/configuracoes' }, { label: 'Canais' }]} title="Canais" description="Os números ligados" action={<Button>Criar canal</Button>} />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'Configurações' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Canais' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar canal' })).toBeInTheDocument();
  });

  test('DangerZone tem título próprio', () => {
    render(<DangerZone><Button variant="danger">Excluir</Button></DangerZone>);
    expect(screen.getByRole('heading', { name: /ações com cuidado/i })).toBeInTheDocument();
  });

  test('Múltiplas DangerZones têm ids distintos e aria-labelledby correto', () => {
    render(
      <>
        <DangerZone><Button variant="danger">Excluir</Button></DangerZone>
        <DangerZone title="Outra ação"><Button variant="danger">Reset</Button></DangerZone>
      </>
    );
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings).toHaveLength(2);
    const id1 = headings[0].id;
    const id2 = headings[1].id;
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
    const sections = screen.getAllByRole('region');
    expect(sections[0]).toHaveAttribute('aria-labelledby', id1);
    expect(sections[1]).toHaveAttribute('aria-labelledby', id2);
  });
});
