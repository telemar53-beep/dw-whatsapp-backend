import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PainelDadosCliente from './PainelDadosCliente';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';
import fonteDoPainel from './PainelDadosCliente.jsx?raw';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

// Dados fictícios. A conversa chega como a ConversationView a entrega: já com o
// que o "Editar cliente" salvou (utils/contatoSalvo.js) e com o estado canônico.
const CONVERSA = {
  id: 'conv-1',
  contactId: 'contato-1',
  contactDisplayName: 'Cliente Exemplo',
  contactPhoneNumber: '5500000000017',
  contactCityName: 'Município Um',
  contactLocalityName: 'Localidade Um',
  contactInternalNote: 'Prefere contato à tarde.',
  status: 'assigned',
  assignedAgentId: 'agent-1',
  assignedAgentName: 'Atendente A',
  sectorId: 'setor-1',
  sectorName: 'Suporte',
  protocolNumber: '20260926-0001',
};
const TRIAGEM = {
  aiTriageCompletedAt: '2026-09-26T12:00:00.000Z',
  aiTriageReasonName: 'Sem conexão',
  aiTriageSummary: 'Cliente sem internet desde ontem.',
  aiTriageIdentifiedBy: 'cpf',
  aiTriageConfidence: 0.87,
  aiTriageSectorId: 'setor-1',
};
const EM_ATENDIMENTO = { tipo: 'atendimento', label: 'Em atendimento' };

function mostrar(props = {}) {
  const conversation = { ...CONVERSA, ...(props.conversation || {}) };
  return render(
    <PainelDadosCliente
      estado={EM_ATENDIMENTO}
      onEditar={vi.fn()}
      onHistorico={vi.fn()}
      {...props}
      conversation={conversation}
    />
  );
}
const painel = () => screen.getByRole('complementary', { name: 'Dados do cliente' });
const titulos = () => within(painel()).getAllByRole('heading').map((h) => h.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  api.listSectors.mockReset();
  api.listSectors.mockResolvedValue([{ id: 'setor-1', name: 'Suporte' }, { id: 'setor-2', name: 'Financeiro' }]);
  api.setConversationSector.mockReset();
});

describe('PainelDadosCliente — estrutura', () => {
  test('a nota e a triagem vêm antes do cadastro e dos dados do atendimento', () => {
    mostrar({ conversation: TRIAGEM });
    expect(titulos()).toEqual(['Dados do cliente', 'Cliente Exemplo', 'Nota interna', 'Triagem por IA', 'Cadastro', 'Dados do atendimento']);
  });

  test('identificação: nome, telefone formatado uma vez só, estado e as duas ações', async () => {
    const onEditar = vi.fn();
    const onHistorico = vi.fn();
    mostrar({ onEditar, onHistorico });
    const p = within(painel());
    expect(p.getByRole('heading', { name: 'Cliente Exemplo' })).toBeInTheDocument();
    expect(p.getAllByText('+55 (00) 00000-0017')).toHaveLength(1);
    expect(p.getByText('Em atendimento')).toBeInTheDocument();

    await userEvent.click(p.getByRole('button', { name: 'Editar cliente' }));
    await userEvent.click(p.getByRole('button', { name: 'Histórico' }));
    expect(onEditar).toHaveBeenCalledTimes(1);
    expect(onHistorico).toHaveBeenCalledTimes(1);
  });

  test('sem nome, o telefone vira o título e não se repete embaixo', () => {
    mostrar({ conversation: { contactDisplayName: null } });
    expect(within(painel()).getByRole('heading', { name: '+55 (00) 00000-0017' })).toBeInTheDocument();
    expect(within(painel()).getAllByText('+55 (00) 00000-0017')).toHaveLength(1);
  });

  test('sem nome e sem telefone, o título é "Conversa" e não há linha de telefone', () => {
    mostrar({ conversation: { contactDisplayName: null, contactPhoneNumber: null } });
    expect(within(painel()).getByRole('heading', { name: 'Conversa' })).toBeInTheDocument();
    expect(within(painel()).queryByText(/\+55/)).not.toBeInTheDocument();
  });

  test('a nota aparece inteira; sem nota, um aviso discreto que aponta para "Editar cliente"', () => {
    const { unmount } = mostrar({ conversation: { contactInternalNote: 'Linha 1\nLinha 2 da nota' } });
    expect(within(painel()).getByText(/Linha 1\s+Linha 2 da nota/)).toBeInTheDocument();
    unmount();
    mostrar({ conversation: { contactInternalNote: null } });
    expect(within(painel()).getByText('Nenhuma nota interna.')).toBeInTheDocument();
    expect(within(painel()).getByText(/use Editar cliente/i)).toBeInTheDocument();
    // Nota não se edita aqui: nenhum campo de texto no painel.
    expect(within(painel()).queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('sem triagem, nenhum bloco de triagem; sem cidade, "Não informada"', () => {
    mostrar({ conversation: { contactCityName: null, contactLocalityName: null } });
    expect(titulos()).not.toContain('Triagem por IA');
    expect(within(painel()).queryByRole('button', { name: /Detalhes da triagem/ })).not.toBeInTheDocument();
    expect(within(painel()).getByText('Não informada')).toBeInTheDocument();
  });

  test('município e localidade por extenso', () => {
    mostrar();
    expect(within(painel()).getByText('Localidade Um · Município Um')).toBeInTheDocument();
  });

  test('nada em fonte monoespaçada', () => {
    const { container } = mostrar({ conversation: TRIAGEM });
    expect(container.querySelector('pre, code, kbd, samp')).toBeNull();
  });
});

describe('PainelDadosCliente — topo', () => {
  test('coluna com fechar: "×" e nenhum voltar', async () => {
    const onFechar = vi.fn();
    mostrar({ onFechar });
    await userEvent.click(within(painel()).getByRole('button', { name: 'Fechar dados do cliente' }));
    expect(onFechar).toHaveBeenCalled();
    expect(within(painel()).queryByRole('button', { name: 'Voltar à conversa' })).not.toBeInTheDocument();
  });

  test('no lugar da conversa: só o voltar, nunca o "×"', async () => {
    const onFechar = vi.fn();
    mostrar({ onFechar, emTela: true });
    await userEvent.click(within(painel()).getByRole('button', { name: 'Voltar à conversa' }));
    expect(onFechar).toHaveBeenCalled();
    expect(within(painel()).queryByRole('button', { name: 'Fechar dados do cliente' })).not.toBeInTheDocument();
  });

  test('coluna fixa (popup no desktop): nem fechar nem voltar', () => {
    mostrar();
    expect(within(painel()).queryByRole('button', { name: 'Fechar dados do cliente' })).not.toBeInTheDocument();
    expect(within(painel()).queryByRole('button', { name: 'Voltar à conversa' })).not.toBeInTheDocument();
  });
});

describe('PainelDadosCliente — triagem', () => {
  test('motivo e resumo sempre à vista; o resto só em "Detalhes da triagem"', async () => {
    mostrar({ conversation: TRIAGEM });
    const p = within(painel());
    expect(p.getByText('Sem conexão')).toBeInTheDocument();
    expect(p.getByText('Cliente sem internet desde ontem.')).toBeInTheDocument();
    expect(p.queryByText('Identificado por')).not.toBeInTheDocument();

    const detalhes = p.getByRole('button', { name: 'Detalhes da triagem' });
    expect(detalhes).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(detalhes);
    expect(detalhes).toHaveAttribute('aria-expanded', 'true');
    expect(p.getByText('Identificado por')).toBeInTheDocument();
    expect(p.getByText('CPF')).toBeInTheDocument();
    expect(p.getByText('87%')).toBeInTheDocument();
    // Setor da IA igual ao setor da conversa: o nome já está na conversa.
    expect(p.getByText('Suporte')).toBeInTheDocument();
    expect(api.listSectors).not.toHaveBeenCalled();
  });

  test.each([
    ['memory', 'memória'],
    ['phone', 'telefone'],
    ['cpf', 'CPF'],
    ['none', 'não identificado'],
    [null, 'não identificado'],
  ])('identificação %s aparece como "%s"', async (valor, rotulo) => {
    mostrar({ conversation: { ...TRIAGEM, aiTriageIdentifiedBy: valor } });
    await userEvent.click(within(painel()).getByRole('button', { name: 'Detalhes da triagem' }));
    expect(within(painel()).getByText(rotulo)).toBeInTheDocument();
  });

  test('confiança sem valor aparece como "—"', async () => {
    mostrar({ conversation: { ...TRIAGEM, aiTriageConfidence: null } });
    await userEvent.click(within(painel()).getByRole('button', { name: 'Detalhes da triagem' }));
    expect(within(painel()).getByText('—')).toBeInTheDocument();
  });

  test('confiança baixa e resolvido pela IA ficam à vista, na primeira camada', () => {
    mostrar({ conversation: { ...TRIAGEM, aiTriageLowConfidence: true, aiTriageConfidence: 0.42, aiTriageResolvedByAi: true } });
    expect(within(painel()).getByText('Confiança baixa (42%)')).toBeInTheDocument();
    expect(within(painel()).getByText('Resolvido pela IA')).toBeInTheDocument();
  });

  test('setor da IA diferente do atual: busca os setores só ao abrir os detalhes', async () => {
    mostrar({ conversation: { ...TRIAGEM, aiTriageSectorId: 'setor-2' } });
    expect(api.listSectors).not.toHaveBeenCalled();
    await userEvent.click(within(painel()).getByRole('button', { name: 'Detalhes da triagem' }));
    expect(await within(painel()).findByText('Financeiro')).toBeInTheDocument();
    expect(api.listSectors).toHaveBeenCalledTimes(1);
  });
});

describe('PainelDadosCliente — dados do atendimento', () => {
  const abrirAtendimento = () => userEvent.click(within(painel()).getByRole('button', { name: 'Dados do atendimento' }));

  test('recolhidos por padrão; abertos mostram setor, responsável, protocolo e encerrado em', async () => {
    mostrar({ conversation: { status: 'closed', closedAt: '2026-09-20T15:00:00.000Z' } });
    expect(within(painel()).queryByText('20260926-0001')).not.toBeInTheDocument();
    await abrirAtendimento();
    const p = within(painel());
    expect(p.getByText('Suporte')).toBeInTheDocument();
    expect(p.getByText('Atendente A')).toBeInTheDocument();
    expect(p.getByText('20260926-0001')).toBeInTheDocument();
    expect(p.getByText('Encerrado em')).toBeInTheDocument();
  });

  test('sem setor, responsável ou protocolo: textos coerentes, sem linha vazia', async () => {
    mostrar({ conversation: { sectorId: null, sectorName: null, assignedAgentId: null, assignedAgentName: null, protocolNumber: null } });
    await abrirAtendimento();
    const p = within(painel());
    expect(p.getByText('Não definido')).toBeInTheDocument();
    expect(p.getByText('Não atribuído')).toBeInTheDocument();
    expect(p.queryByText('Protocolo')).not.toBeInTheDocument();
    expect(p.queryByText('Encerrado em')).not.toBeInTheDocument();
  });

  test('na mesa não há troca de setor, nem para admin, e nada é buscado', async () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
    mostrar();
    await abrirAtendimento();
    expect(within(painel()).queryByLabelText('Alterar setor')).not.toBeInTheDocument();
    expect(api.listSectors).not.toHaveBeenCalled();
  });

  test('no popup, os setores só são buscados quando a seção abre e há permissão', async () => {
    mostrar({ trocaDeSetor: true });
    expect(api.listSectors).not.toHaveBeenCalled();
    await abrirAtendimento();
    expect(await within(painel()).findByRole('option', { name: 'Financeiro' })).toBeInTheDocument();
    expect(api.listSectors).toHaveBeenCalledTimes(1);
  });

  // Mesma regra de antes (ConversationInfoPanel): admin, gerente ou o
  // responsável pela conversa; ninguém mais.
  test.each([
    ['atendente que não é o responsável', { id: 'agent-2', role: 'agent' }, false],
    ['responsável pela conversa', { id: 'agent-1', role: 'agent' }, true],
    ['gerente', { id: 'gerente-1', role: 'manager' }, true],
    ['admin', { id: 'admin-1', role: 'admin' }, true],
  ])('permissão de trocar o setor no popup: %s', async (_quem, agent, pode) => {
    useAuth.mockReturnValue({ token: 'tok-123', agent });
    mostrar({ trocaDeSetor: true });
    await abrirAtendimento();
    if (pode) {
      expect(within(painel()).getByLabelText('Alterar setor')).toBeInTheDocument();
      await waitFor(() => expect(api.listSectors).toHaveBeenCalledTimes(1));
    } else {
      expect(within(painel()).queryByLabelText('Alterar setor')).not.toBeInTheDocument();
      expect(api.listSectors).not.toHaveBeenCalled();
    }
  });

  test('carregando setores: o seletor diz que está carregando e o setor atual continua à vista', async () => {
    api.listSectors.mockReturnValue(new Promise(() => {}));
    mostrar({ trocaDeSetor: true });
    await abrirAtendimento();
    const seletor = within(painel()).getByLabelText('Alterar setor');
    expect(seletor).toBeDisabled();
    expect(within(seletor).getByRole('option', { name: 'Carregando setores…' })).toBeInTheDocument();
    expect(within(painel()).getByText('Suporte')).toBeInTheDocument();
    expect(within(painel()).queryByText('Não definido')).not.toBeInTheDocument();
  });

  test('erro ao carregar setores: mensagem e tentar de novo', async () => {
    api.listSectors.mockRejectedValueOnce(new Error('rede fora')).mockResolvedValueOnce([{ id: 'setor-1', name: 'Suporte' }, { id: 'setor-2', name: 'Financeiro' }]);
    mostrar({ trocaDeSetor: true });
    await abrirAtendimento();
    expect(await within(painel()).findByText('Não foi possível carregar os setores.')).toBeInTheDocument();
    await userEvent.click(within(painel()).getByRole('button', { name: 'Tentar de novo' }));
    expect(await within(painel()).findByRole('option', { name: 'Financeiro' })).toBeInTheDocument();
  });

  test('trocar o setor: "Salvando…" e depois o novo nome na linha', async () => {
    let responder;
    api.setConversationSector.mockReturnValue(new Promise((resolve) => { responder = resolve; }));
    mostrar({ trocaDeSetor: true });
    await abrirAtendimento();
    await within(painel()).findByRole('option', { name: 'Financeiro' });
    await userEvent.selectOptions(within(painel()).getByLabelText('Alterar setor'), 'setor-2');
    expect(within(painel()).getByText('Salvando…')).toBeInTheDocument();
    expect(api.setConversationSector).toHaveBeenCalledWith('conv-1', 'setor-2', 'tok-123');
    await act(async () => responder({}));
    expect(within(painel()).queryByText('Salvando…')).not.toBeInTheDocument();
    expect(within(painel()).getByText('Financeiro', { selector: 'dd' })).toBeInTheDocument();
  });

  test('falha ao trocar o setor volta ao anterior e mostra o erro', async () => {
    api.setConversationSector.mockRejectedValue(new Error('rede fora'));
    mostrar({ trocaDeSetor: true });
    await abrirAtendimento();
    await within(painel()).findByRole('option', { name: 'Financeiro' });
    await userEvent.selectOptions(within(painel()).getByLabelText('Alterar setor'), 'setor-2');
    expect(await within(painel()).findByRole('alert')).toBeInTheDocument();
    expect(within(painel()).getByLabelText('Alterar setor')).toHaveValue('setor-1');
  });

  test('resposta atrasada da troca de setor não vale para a conversa seguinte', async () => {
    let responder;
    api.setConversationSector.mockReturnValue(new Promise((resolve) => { responder = resolve; }));
    const { rerender } = mostrar({ trocaDeSetor: true });
    await abrirAtendimento();
    await within(painel()).findByRole('option', { name: 'Financeiro' });
    await userEvent.selectOptions(within(painel()).getByLabelText('Alterar setor'), 'setor-2');

    rerender(
      <PainelDadosCliente estado={EM_ATENDIMENTO} onEditar={vi.fn()} onHistorico={vi.fn()} trocaDeSetor
        conversation={{ ...CONVERSA, id: 'conv-2', contactId: 'contato-2', sectorId: 'setor-1', sectorName: 'Suporte' }} />
    );
    await act(async () => responder({}));
    expect(within(painel()).queryByText('Salvando…')).not.toBeInTheDocument();
    expect(within(painel()).queryByText('Financeiro', { selector: 'dd' })).not.toBeInTheDocument();
  });
});

// O painel só usa os ícones DW da conversa (icones/conversa.jsx): nada da
// família antiga (WaIcons, SgpIcons), de biblioteca genérica ou do índice.
test('o painel não importa ícone genérico', () => {
  const origens = [...fonteDoPainel.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  expect(origens.filter((o) => /icon/i.test(o))).toEqual(['./icones/conversa']);
  expect(origens.filter((o) => !o.startsWith('.') && o !== 'react')).toEqual([]);
});
