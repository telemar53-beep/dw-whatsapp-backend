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

  test('sem canal nenhum e sem resultado no filtro, as frases de sempre', async () => {
    const { unmount } = render(<MemoryRouter><CartoesDeCanais channels={[]} summaryContext={pronto} /></MemoryRouter>);
    expect(screen.getByText('Nenhum canal cadastrado ainda.')).toBeInTheDocument();
    unmount();
    montar();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar por nome ou número' }), 'zzz');
    expect(screen.getByText('Nenhum canal com esse filtro.')).toBeInTheDocument();
  });
});

describe('Números conectados: mais ações', () => {
  const acoes = () => ({ reconnect: vi.fn(), toggleHidden: vi.fn(), remove: vi.fn(), busyChannelId: null });

  test('só aparece para quem pode gerenciar', () => {
    montar({ actions: acoes(), canManage: false });
    expect(screen.queryByRole('button', { name: /Mais ações/ })).not.toBeInTheDocument();
  });

  test('Reconectar só no Baileys; Ocultar e Excluir chamam as mesmas ações de antes', async () => {
    const a = acoes();
    montar({ actions: a, canManage: true });
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações para Canal Comercial' }));
    expect(screen.queryByRole('button', { name: 'Reconectar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar' }));
    expect(a.toggleHidden).toHaveBeenCalledWith(meta);
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações para Canal Suporte' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reconectar' }));
    expect(a.reconnect).toHaveBeenCalledWith(baileys);
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações para Canal Cobrança' }));
    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(a.remove).toHaveBeenCalledWith(bsp);
  });

  test('Esc fecha o menu; canal oculto oferece Reexibir; ocupado desliga as ações', async () => {
    const a = { ...acoes(), busyChannelId: 'c1' };
    render(<MemoryRouter><CartoesDeCanais channels={[{ ...baileys, hidden: true }]} summaryContext={pronto} actions={a} canManage /></MemoryRouter>);
    const botao = screen.getByRole('button', { name: 'Mais ações para Canal Suporte' });
    await userEvent.click(botao);
    expect(botao).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Reexibir' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(botao).toHaveAttribute('aria-expanded', 'false');
  });
});
