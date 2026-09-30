import { describe, test, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CartoesDeCanais, siglaDoTipo, precisaDeAtencao } from './CartoesDeCanais';

// Dados fictícios.
const baileys = { id: 'c1', type: 'baileys', name: 'Canal Suporte', phoneNumber: '+5500900000001', status: 'connected', triageEnabled: true, aiEnabled: true };
const meta = { id: 'c2', type: 'meta_cloud', name: 'Canal Comercial', phoneNumber: '+5500900000002', status: 'connected', connection: { state: 'connected', quality: 'GREEN' } };
const bsp = { id: 'c3', type: '360dialog', name: 'Canal Cobrança', phoneNumber: '+5500900000003', status: 'connected' };
const pronto = { triageOptionsCount: 2, nightWindowSet: true, openAiReady: true };

function montar(props = {}) {
  return render(
    <MemoryRouter>
      <CartoesDeCanais channels={[baileys, meta, bsp]} summaryContext={pronto} {...props} />
    </MemoryRouter>
  );
}
const cartao = (nome) => screen.getByRole('link', { name: nome }).closest('li.cfg-canal');

describe('Números conectados: o tipo em letras', () => {
  test('API para a Meta, BSP para a 360dialog, BL para o Baileys', () => {
    expect(siglaDoTipo('meta_cloud')).toBe('API');
    expect(siglaDoTipo('360dialog')).toBe('BSP');
    expect(siglaDoTipo('baileys')).toBe('BL');
  });

  test('cada cartão leva o emblema; o Baileys, não oficial, tem o emblema claro', () => {
    montar();
    expect(cartao('Canal Comercial').querySelector('.cfg-emblema')).toHaveTextContent('API');
    expect(cartao('Canal Cobrança').querySelector('.cfg-emblema')).toHaveTextContent('BSP');
    const bl = cartao('Canal Suporte').querySelector('.cfg-emblema');
    expect(bl).toHaveTextContent('BL');
    expect(bl).toHaveClass('is-nao-oficial');
    expect(cartao('Canal Comercial').querySelector('.cfg-emblema')).not.toHaveClass('is-nao-oficial');
  });

  test('nenhuma marca de terceiro no cartão: sem o WhatsApp com selo', () => {
    montar();
    expect(document.querySelector('.cfg-canais .channel-brand')).toBeNull();
    expect(document.querySelector('.cfg-canais img')).toBeNull();
  });
});

describe('Números conectados: hierarquia do cartão', () => {
  test('nome leva ao detalhe, com o número e o jeito de conectar por extenso', () => {
    montar();
    expect(screen.getByRole('link', { name: 'Canal Suporte' })).toHaveAttribute('href', '/configuracoes/canais/c1/conexao');
    const c = cartao('Canal Suporte');
    expect(within(c).getByText('Conexão').nextSibling).toHaveTextContent('Baileys · Não oficial');
    expect(within(cartao('Canal Comercial')).getByText('Meta Cloud · API oficial')).toBeInTheDocument();
    expect(within(cartao('Canal Cobrança')).getByText('360dialog · BSP oficial')).toBeInTheDocument();
  });

  test('qualidade só no oficial em que a Meta informou', () => {
    montar();
    expect(within(cartao('Canal Comercial')).getByText('Qualidade').nextSibling).toHaveTextContent('Alta');
    expect(within(cartao('Canal Suporte')).queryByText('Qualidade')).not.toBeInTheDocument();
    expect(within(cartao('Canal Cobrança')).queryByText('Qualidade')).not.toBeInTheDocument();
  });

  test('oficial fora do ar não mostra a qualidade antiga', () => {
    const caido = { ...meta, connection: { state: 'disconnected', quality: 'GREEN' } };
    render(<MemoryRouter><CartoesDeCanais channels={[caido]} summaryContext={pronto} /></MemoryRouter>);
    expect(within(cartao('Canal Comercial')).queryByText('Qualidade')).not.toBeInTheDocument();
  });

  test('estado em ponto e texto, pelo mesmo ConnectionStatus de sempre', () => {
    montar();
    expect(within(cartao('Canal Suporte')).getByText('Conectado')).toBeInTheDocument();
    expect(within(cartao('Canal Cobrança')).getByText('Não verificada')).toBeInTheDocument();
  });

  test('recursos ativos em texto, sem glifo de produto nem de fornecedor', () => {
    montar();
    const recursos = within(cartao('Canal Suporte')).getByRole('list', { name: 'Recursos ativos' });
    expect(within(recursos).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Triagem por menu', 'IA ativa']);
    expect(recursos.querySelector('svg')).toBeNull();
    expect(within(cartao('Canal Comercial')).getByRole('list', { name: 'Recursos ativos' })).toHaveTextContent('Humano');
  });

  test('canal oculto diz que está oculto', () => {
    render(<MemoryRouter><CartoesDeCanais channels={[{ ...baileys, hidden: true }]} summaryContext={pronto} /></MemoryRouter>);
    expect(cartao('Canal Suporte')).toHaveClass('is-oculto');
    expect(within(cartao('Canal Suporte')).getByText(/oculto/)).toBeInTheDocument();
  });
});

describe('Números conectados: atenção', () => {
  test('aviso do resumo destaca o cartão, lista o motivo e troca a ação para Revisar canal', () => {
    render(<MemoryRouter><CartoesDeCanais channels={[baileys, meta]} summaryContext={{ ...pronto, openAiReady: false }} /></MemoryRouter>);
    const c = cartao('Canal Suporte');
    expect(c).toHaveClass('precisa-atencao');
    expect(within(c).getByRole('list', { name: 'Precisa de atenção' })).toHaveTextContent('IA ligada sem OpenAI configurada');
    expect(within(c).getByRole('link', { name: 'Revisar canal' })).toHaveAttribute('href', '/configuracoes/canais/c1/conexao');
    expect(cartao('Canal Comercial')).not.toHaveClass('precisa-atencao');
    expect(within(cartao('Canal Comercial')).getByRole('link', { name: 'Configurar' })).toBeInTheDocument();
  });

  test('o resumo conta os números, os oficiais, os Baileys e os que precisam de atenção', () => {
    render(<MemoryRouter><CartoesDeCanais channels={[baileys, meta, bsp]} summaryContext={{ ...pronto, openAiReady: false }} /></MemoryRouter>);
    const resumo = screen.getByRole('list', { name: 'Resumo dos canais' });
    expect(within(resumo).getAllByRole('listitem').map((li) => li.textContent.replace(/\s+/g, ' ').trim())).toEqual(['3 números', '2 oficiais', '1 Baileys', '1 precisa de atenção']);
  });

  test.each([
    ['Baileys conectado, sem aviso', { type: 'baileys', status: 'connected' }, false],
    ['Baileys esperando o QR', { type: 'baileys', status: 'awaiting_qr' }, true],
    ['Baileys desconectado', { type: 'baileys', status: 'disconnected' }, true],
    ['oficial sem resposta da Meta', { type: 'meta_cloud', status: 'connected' }, false],
    ['oficial com erro', { type: 'meta_cloud', connection: { state: 'error', motivo: '(190)' } }, true],
    ['oficial desconectado', { type: 'meta_cloud', connection: { state: 'disconnected' } }, true],
    ['oficial com qualidade média', { type: 'meta_cloud', connection: { state: 'connected', quality: 'YELLOW' } }, true],
    ['oficial com qualidade alta', { type: 'meta_cloud', connection: { state: 'connected', quality: 'GREEN' } }, false],
    ['360dialog, que não é verificada', { type: '360dialog', status: 'connected' }, false],
  ])('%s', (_, canal, esperado) => {
    expect(precisaDeAtencao(canal, [])).toBe(esperado);
  });

  test('um aviso basta, mesmo com a conexão boa', () => {
    expect(precisaDeAtencao({ type: 'baileys', status: 'connected' }, ['Noturno ligado sem janela definida'])).toBe(true);
  });
});

describe('Números conectados: busca, filtro e vazio', () => {
  test('busca por nome e por número, e diz quantos sobraram', async () => {
    montar();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar por nome ou número' }), 'cobr');
    expect(screen.getAllByRole('link', { name: /^Canal/ }).map((a) => a.textContent)).toEqual(['Canal Cobrança']);
    expect(screen.getByText('1 de 3 canais')).toBeInTheDocument();
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Buscar por nome ou número' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar por nome ou número' }), '0002');
    expect(screen.getAllByRole('link', { name: /^Canal/ }).map((a) => a.textContent)).toEqual(['Canal Comercial']);
  });

  test('filtra pelo tipo de conexão', async () => {
    montar();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tipo de conexão' }), 'baileys');
    expect(screen.getAllByRole('link', { name: /^Canal/ }).map((a) => a.textContent)).toEqual(['Canal Suporte']);
  });

  // S2: a lista vazia de verdade é da página (ListaVazia, com a ação de
  // adicionar o primeiro canal); aqui fica só o "sem resultado" do filtro.
  test('sem resultado no filtro: a frase de sempre', async () => {
    montar();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar por nome ou número' }), 'zzz');
    expect(screen.getByText('Nenhum canal com esse filtro.')).toBeInTheDocument();
  });
});

describe('Números conectados: mais ações', () => {
  // A API da S2: o menu só pede (pedir); andamento e erro chegam por cartão.
  const acoes = (extra = {}) => ({ pedir: vi.fn(), pendentes: {}, erros: {}, limparErro: vi.fn(), ...extra });

  test('só aparece para quem pode gerenciar', () => {
    montar({ actions: acoes(), canManage: false });
    expect(screen.queryByRole('button', { name: /Mais ações/ })).not.toBeInTheDocument();
  });

  test('Reconectar só no Baileys; cada item pede a ação certa para o canal certo', async () => {
    const a = acoes();
    montar({ actions: a, canManage: true });
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações para Canal Comercial' }));
    expect(screen.queryByRole('button', { name: 'Reconectar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar' }));
    expect(a.pedir).toHaveBeenLastCalledWith('ocultar', meta);
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações para Canal Suporte' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reconectar' }));
    expect(a.pedir).toHaveBeenLastCalledWith('reconectar', baileys);
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações para Canal Cobrança' }));
    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(a.pedir).toHaveBeenLastCalledWith('excluir', bsp);
    expect(a.pedir).toHaveBeenCalledTimes(3);
  });

  test('escolher um item devolve o foco ao "⋯" de origem', async () => {
    montar({ actions: acoes(), canManage: true });
    const botao = screen.getByRole('button', { name: 'Mais ações para Canal Cobrança' });
    await userEvent.click(botao);
    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(botao).toHaveFocus();
    expect(botao).toHaveAttribute('aria-expanded', 'false');
  });

  test('Esc fecha o menu; canal oculto oferece Reexibir', async () => {
    const a = acoes();
    render(<MemoryRouter><CartoesDeCanais channels={[{ ...baileys, hidden: true }]} summaryContext={pronto} actions={a} canManage /></MemoryRouter>);
    const botao = screen.getByRole('button', { name: 'Mais ações para Canal Suporte' });
    await userEvent.click(botao);
    expect(botao).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Reexibir' }));
    expect(a.pedir).toHaveBeenCalledWith('reexibir', { ...baileys, hidden: true });
    await userEvent.click(botao);
    await userEvent.keyboard('{Escape}');
    expect(botao).toHaveAttribute('aria-expanded', 'false');
  });

  test('em andamento: o cartão diz o que está acontecendo e não abre o menu nem o Configurar', async () => {
    const a = acoes({ pendentes: { c1: 'Excluindo…' } });
    montar({ actions: a, canManage: true });
    const c = cartao('Canal Suporte');
    expect(c).toHaveAttribute('aria-busy', 'true');
    expect(c).toHaveClass('is-pendente');
    expect(within(c).getByText('Excluindo…')).toBeInTheDocument();
    const botao = screen.getByRole('button', { name: 'Mais ações para Canal Suporte' });
    expect(botao).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(botao);
    expect(botao).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument();
    expect(within(c).getByRole('link', { name: 'Configurar' })).toHaveAttribute('aria-disabled', 'true');
    expect(cartao('Canal Comercial')).not.toHaveAttribute('aria-busy');
  });

  test('o erro aparece no cartão de origem, com Tentar novamente e Dispensar', async () => {
    const repetir = vi.fn();
    const a = acoes({ erros: { c3: { mensagem: 'Não foi possível reconectar o canal.', repetir } } });
    montar({ actions: a, canManage: true });
    const c = cartao('Canal Cobrança');
    expect(c).toHaveClass('is-erro');
    expect(within(c).getByRole('alert')).toHaveTextContent('Não foi possível reconectar o canal.');
    expect(within(cartao('Canal Suporte')).queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(within(c).getByRole('button', { name: 'Tentar novamente' }));
    expect(repetir).toHaveBeenCalledTimes(1);
    await userEvent.click(within(c).getByRole('button', { name: 'Dispensar' }));
    expect(a.limparErro).toHaveBeenCalledWith('c3');
  });
});
