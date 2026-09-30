import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SectorsPage from '../team/SectorsPage';
import UsersPage from '../team/UsersPage';
import ReasonsPage from '../registers/ReasonsPage';
import CitiesPage from '../registers/CitiesPage';
import PlansPage from '../registers/PlansPage';
import TemplatesAdminTab from '../../../components/TemplatesAdminTab';
import SectionHelp from '../../../components/SectionHelp';
import { useAuth } from '../../../contexts/AuthContext';
import { useSectors } from '../../../hooks/useSectors';
import { useAgentsAdmin } from '../../../hooks/useAgentsAdmin';
import { useReasonsAdmin } from '../../../hooks/useReasonsAdmin';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { usePlaces } from '../../../hooks/useCities';
import { usePlans } from '../../../hooks/usePlans';
import { useTemplates } from '../../../hooks/useTemplates';
import { useChannels } from '../../../hooks/useChannels';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useSectors');
vi.mock('../../../hooks/useAgentsAdmin');
vi.mock('../../../hooks/useReasonsAdmin');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../hooks/useCities');
vi.mock('../../../hooks/usePlans');
vi.mock('../../../hooks/useTemplates');
vi.mock('../../../hooks/useChannels');
vi.mock('../../../services/api');

// Os sete diálogos da Fatia S3 pelos consumidores reais (as páginas montam as
// abas no modo controlado, como no app). Dados e credenciais fictícios.
const refresh = vi.fn();
const MUNICIPIO = { id: 'city-1', name: 'Cidade Exemplo', kind: 'city', parentId: null, sgpPop: null, active: true, served: true, note: '' };
const PLANO = { id: 'plan-1', name: 'Fibra 300', speedMbps: 300, monthlyPrice: 99.9, installCondition: 'Grátis', active: true, sortOrder: 1, note: '' };

function adiado() {
  let resolver;
  const promessa = new Promise((ok) => { resolver = ok; });
  return { promessa, resolver };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
  useSectors.mockReturnValue({ sectors: [], status: 'ready', refresh });
  useAgentsAdmin.mockReturnValue({ agents: [], status: 'ready', refresh });
  useReasonsAdmin.mockReturnValue({ reasons: [], status: 'ready', refresh });
  useAiConfig.mockReturnValue({ config: { triageResolvedReasonId: null }, status: 'ready', refresh: vi.fn() });
  usePlaces.mockReturnValue({ places: [MUNICIPIO], status: 'ready', refresh });
  usePlans.mockReturnValue({ plans: [PLANO], status: 'ready', refresh });
  useTemplates.mockReturnValue({ templates: [], status: 'ready', refresh: vi.fn() });
  useChannels.mockReturnValue({ channels: [{ id: 'ch-1', type: 'meta_cloud', name: 'Canal Exemplo', wabaId: '000000000000001' }], status: 'ready', refresh: vi.fn() });
});

// Diálogo claro da área: moldura mc + base da S3, sem a família escura. O
// trecho chega sob demanda: o primeiro clique de cada formulário espera por ele.
async function esperarDialogoClaro(nome) {
  const d = await screen.findByRole('dialog', { name: nome });
  expect(d).toHaveClass('mc');
  expect(d).toHaveClass('cfg-dlg-form');
  expect(d.querySelector('svg')).toBeNull();
  return d;
}

describe('Adicionar setor', () => {
  test('diálogo claro; payload de sempre; fecha no sucesso, relê a lista e devolve o foco', async () => {
    const pedido = adiado();
    api.createSector.mockReturnValue(pedido.promessa);
    render(<SectorsPage />);
    const abridor = screen.getByRole('button', { name: 'Adicionar setor' });
    await userEvent.click(abridor);
    const d = await esperarDialogoClaro('Adicionar setor');
    await userEvent.type(within(d).getByLabelText('Nome do setor'), 'Setor Exemplo');
    await userEvent.click(within(d).getByRole('button', { name: 'Adicionar setor' }));
    expect(api.createSector).toHaveBeenCalledWith({ name: 'Setor Exemplo' }, 'tok-123');
    expect(within(d).getByRole('button', { name: 'Adicionando…' })).toHaveAttribute('aria-disabled', 'true');
    await act(async () => { pedido.resolver({ id: 'sector-9' }); });
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(abridor).toHaveFocus();
  });
});

describe('Adicionar usuário', () => {
  test('senha inicial mascarada, new-password, Mostrar/Ocultar; payload de sempre', async () => {
    api.createAgent.mockResolvedValue({ id: 'agent-9' });
    render(<UsersPage />);
    await userEvent.click(screen.getByRole('button', { name: /Adicionar usuário/ }));
    const d = await esperarDialogoClaro('Adicionar usuário');
    const senha = within(d).getByLabelText('Senha inicial');
    expect(senha).toHaveAttribute('type', 'password');
    expect(senha).toHaveAttribute('autocomplete', 'new-password');
    await userEvent.type(within(d).getByLabelText('Nome'), 'Atendente Exemplo');
    await userEvent.type(within(d).getByLabelText('E-mail'), 'atendente@exemplo.test');
    await userEvent.type(senha, 'senha-ficticia-1');
    await userEvent.click(within(d).getByRole('button', { name: 'Mostrar senha inicial' }));
    expect(senha).toHaveAttribute('type', 'text');
    await userEvent.click(within(d).getByRole('button', { name: 'Ocultar senha inicial' }));
    expect(senha).toHaveAttribute('type', 'password');
    await userEvent.click(within(d).getByRole('button', { name: 'Adicionar usuário' }));
    expect(api.createAgent).toHaveBeenCalledWith({ name: 'Atendente Exemplo', email: 'atendente@exemplo.test', password: 'senha-ficticia-1', role: 'agent' }, 'tok-123');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  test('perfis de sempre; gerente leva a permissão de integrações no payload', async () => {
    api.createAgent.mockResolvedValue({ id: 'agent-9' });
    render(<UsersPage />);
    await userEvent.click(screen.getByRole('button', { name: /Adicionar usuário/ }));
    const d = await esperarDialogoClaro('Adicionar usuário');
    const perfil = within(d).getByLabelText('Perfil');
    expect([...perfil.options].map((o) => o.value)).toEqual(['agent', 'manager', 'admin']);
    await userEvent.type(within(d).getByLabelText('Nome'), 'Gerente Exemplo');
    await userEvent.type(within(d).getByLabelText('E-mail'), 'gerente@exemplo.test');
    await userEvent.type(within(d).getByLabelText('Senha inicial'), 'senha-ficticia-2');
    await userEvent.selectOptions(perfil, 'manager');
    await userEvent.click(within(d).getByLabelText('Pode gerenciar Canais e Integrações'));
    await userEvent.click(within(d).getByRole('button', { name: 'Adicionar usuário' }));
    expect(api.createAgent).toHaveBeenCalledWith(
      { name: 'Gerente Exemplo', email: 'gerente@exemplo.test', password: 'senha-ficticia-2', role: 'manager', canManageIntegrations: true },
      'tok-123'
    );
  });

  test('a recusa do backend (gerente só cria atendente) aparece em português, com os dados', async () => {
    api.createAgent.mockRejectedValue({ status: 403, body: { error: 'Managers can only create attendant accounts' } });
    render(<UsersPage />);
    await userEvent.click(screen.getByRole('button', { name: /Adicionar usuário/ }));
    const d = await esperarDialogoClaro('Adicionar usuário');
    await userEvent.type(within(d).getByLabelText('Nome'), 'Admin Exemplo');
    await userEvent.type(within(d).getByLabelText('E-mail'), 'admin@exemplo.test');
    await userEvent.type(within(d).getByLabelText('Senha inicial'), 'senha-ficticia-3');
    await userEvent.selectOptions(within(d).getByLabelText('Perfil'), 'admin');
    await userEvent.click(within(d).getByRole('button', { name: 'Adicionar usuário' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('Gerentes só podem criar contas de atendente.');
    expect(within(d).getByLabelText('E-mail')).toHaveValue('admin@exemplo.test');
    expect(within(d).getByRole('button', { name: 'Tentar novamente' })).toHaveFocus();
  });
});

describe('Novo motivo', () => {
  test('diálogo claro com "Adicionar motivo"; payload de sempre', async () => {
    api.createReason.mockResolvedValue({ id: 'r-9' });
    render(<ReasonsPage />);
    await userEvent.click(screen.getByRole('button', { name: /Novo motivo/ }));
    const d = await esperarDialogoClaro('Novo motivo');
    await userEvent.type(within(d).getByLabelText('Nome do motivo'), 'Motivo Exemplo');
    await userEvent.click(within(d).getByRole('button', { name: 'Adicionar motivo' }));
    expect(api.createReason).toHaveBeenCalledWith({ name: 'Motivo Exemplo' }, 'tok-123');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('Nova cidade e Editar cadastro', () => {
  test('localidade sem município: mensagem e foco no campo; depois, payload de sempre', async () => {
    api.createCity.mockResolvedValue({ id: 'city-9' });
    render(<CitiesPage />);
    await userEvent.click(screen.getByRole('button', { name: /Nova cidade/ }));
    const d = await esperarDialogoClaro('Nova cidade ou localidade');
    await userEvent.type(within(d).getByLabelText('Nome'), 'Povoado Exemplo');
    await userEvent.selectOptions(within(d).getByLabelText('Tipo'), 'locality');
    await userEvent.click(within(d).getByRole('button', { name: 'Adicionar cidade' }));
    expect(api.createCity).not.toHaveBeenCalled();
    expect(within(d).getByRole('alert')).toHaveTextContent('Uma localidade precisa pertencer a um município.');
    expect(within(d).getByLabelText('Município')).toHaveFocus();
    await userEvent.selectOptions(within(d).getByLabelText('Município'), 'city-1');
    await userEvent.click(within(d).getByRole('button', { name: 'Tentar novamente' }));
    expect(api.createCity).toHaveBeenCalledWith(
      { name: 'Povoado Exemplo', kind: 'locality', parentId: 'city-1', sgpPop: null, active: true, served: false, note: '' },
      'tok-123'
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('editar: "Salvar alterações", mesmo método e a recusa estrutural em português', async () => {
    api.updateCity.mockRejectedValueOnce({ status: 409, body: { error: 'structural change blocked', dependencies: { filhas: 2 } } });
    api.updateCity.mockResolvedValueOnce({ id: 'city-1' });
    render(<CitiesPage />);
    const editar = screen.getByRole('button', { name: 'Editar Cidade Exemplo' });
    await userEvent.click(editar);
    const d = await esperarDialogoClaro('Editar cadastro');
    await userEvent.click(within(d).getByRole('button', { name: 'Salvar alterações' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('2 localidades dependem dele');
    expect(api.updateCity).toHaveBeenCalledWith('city-1', expect.objectContaining({ name: 'Cidade Exemplo', kind: 'city' }), 'tok-123');
    await userEvent.click(within(d).getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(editar).toHaveFocus();
  });
});

describe('Novo plano e Editar plano', () => {
  test('mensalidade inválida: mensagem e foco no campo; valores convertidos no payload', async () => {
    api.createPlan.mockResolvedValue({ id: 'plan-9' });
    render(<PlansPage />);
    await userEvent.click(screen.getByRole('button', { name: /Novo plano/ }));
    const d = await esperarDialogoClaro('Novo plano');
    await userEvent.type(within(d).getByLabelText('Nome'), 'Fibra 500');
    await userEvent.type(within(d).getByLabelText('Velocidade (Mbps)'), '500');
    await userEvent.type(within(d).getByLabelText('Mensalidade (R$)'), 'abc');
    await userEvent.click(within(d).getByRole('button', { name: 'Adicionar plano' }));
    expect(api.createPlan).not.toHaveBeenCalled();
    expect(within(d).getByRole('alert')).toHaveTextContent('Informe a mensalidade em reais, por exemplo 100,00.');
    expect(within(d).getByLabelText('Mensalidade (R$)')).toHaveFocus();
    await userEvent.clear(within(d).getByLabelText('Mensalidade (R$)'));
    await userEvent.type(within(d).getByLabelText('Mensalidade (R$)'), '129,90');
    await userEvent.click(within(d).getByRole('button', { name: 'Tentar novamente' }));
    expect(api.createPlan).toHaveBeenCalledWith(
      { name: 'Fibra 500', speedMbps: 500, monthlyPrice: 129.9, installCondition: '', active: true, sortOrder: 0, note: '' },
      'tok-123'
    );
  });

  test('editar: "Salvar alterações" e o mesmo método de antes', async () => {
    api.updatePlan.mockResolvedValue({ id: 'plan-1' });
    render(<PlansPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Editar Fibra 300' }));
    const d = await esperarDialogoClaro('Editar plano');
    await userEvent.click(within(d).getByRole('button', { name: 'Salvar alterações' }));
    expect(api.updatePlan).toHaveBeenCalledWith(
      'plan-1',
      { name: 'Fibra 300', speedMbps: 300, monthlyPrice: 99.9, installCondition: 'Grátis', active: true, sortOrder: 1, note: '' },
      'tok-123'
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('Fora da S3: Templates e a ajuda da Triagem seguem como estão', () => {
  test('Novo template continua na família antiga', async () => {
    render(<TemplatesAdminTab />);
    await userEvent.click(screen.getByRole('button', { name: /Cadastrar novo template|Novo template/ }));
    const d = screen.getByRole('dialog', { name: 'Novo template' });
    expect(d).not.toHaveClass('cfg-dlg-form');
    expect(d).not.toHaveClass('mc');
  });

  test('a ajuda da Triagem continua na família antiga', async () => {
    render(<SectionHelp label="Triagem" title="Triagem">Texto de ajuda.</SectionHelp>);
    await userEvent.click(screen.getByRole('button', { name: 'O que é isso: Triagem' }));
    const d = screen.getByRole('dialog', { name: 'Triagem' });
    expect(d).not.toHaveClass('cfg-dlg-form');
    expect(d).not.toHaveClass('mc');
  });
});
