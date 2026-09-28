import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SendTemplateModal from './SendTemplateModal';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

const SEM_VARIAVEL = { id: 'tpl-1', name: 'aviso_tecnico', bodyText: 'Seu técnico está a caminho.', variableCount: 0, buttons: [] };
const COM_VARIAVEL = { id: 'tpl-2', name: 'confirmar_visita', bodyText: 'Olá {{1}}, podemos agendar para {{2}}?', variableCount: 2, buttons: [] };
const COM_BOTOES = { id: 'tpl-3', name: 'agendar_botao', bodyText: 'Podemos agendar?', variableCount: 0, buttons: ['Sim, pode agendar', 'Prefiro outro dia'] };

function montar(props = {}) {
  return render(<SendTemplateModal conversationId="conv-1" channelId="ch-1" onClose={vi.fn()} onSent={vi.fn()} {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  api.listTemplatesForChannel.mockResolvedValue([SEM_VARIAVEL, COM_VARIAVEL, COM_BOTOES]);
  api.sendConversationTemplate.mockResolvedValue({});
});

describe('SendTemplateModal', () => {
  // Numa conversa individual só faz sentido o template de atendimento: os de
  // disparo são do SGP e da campanha.
  test('pede apenas os templates de atendimento do canal', async () => {
    montar();
    await waitFor(() => expect(api.listTemplatesForChannel).toHaveBeenCalledWith('ch-1', 'tok-123', 'atendimento'));
  });

  // Antes a caixa inteira rolava (titulo junto) E a lista tinha o proprio
  // max-height por dentro: dois eixos disputando. Agora ha um so, no corpo.
  test('titulo e acoes ficam fora do unico eixo de rolagem', async () => {
    montar();
    await screen.findByRole('radio', { name: /aviso_tecnico/ });

    const painel = screen.getByRole('dialog');
    const corpo = painel.querySelector('.mc-corpo');
    const rodape = painel.querySelector('.mc-rodape');
    const cabecalho = painel.querySelector('.mc-cab');

    expect(painel).toHaveAccessibleName('Enviar template');
    expect(painel).toHaveClass('mc');
    expect(corpo).toBeTruthy();
    expect(corpo.contains(cabecalho)).toBe(false);
    expect(corpo.contains(rodape)).toBe(false);
    expect(within(rodape).getByRole('button', { name: 'Enviar' })).toBeInTheDocument();
    // Nenhum contêiner interno reintroduz um segundo eixo por conta propria.
    expect(corpo.querySelector('[class*="max-h-"]')).toBeNull();
    // Um jeito só de sair no cabeçalho: "Fechar" (o "×" da base não existe).
    expect(painel.querySelector('[data-dialog-close]')).toBeNull();
    expect(within(painel).getAllByRole('button', { name: 'Fechar' })).toHaveLength(1);
  });

  test('envia o template escolhido', async () => {
    const onSent = vi.fn();
    montar({ onSent });
    await userEvent.click(await screen.findByRole('radio', { name: /aviso_tecnico/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    await waitFor(() => expect(api.sendConversationTemplate).toHaveBeenCalledWith('conv-1', 'tpl-1', [], 'tok-123'));
    expect(onSent).toHaveBeenCalled();
  });

  // Template não dá para corrigir depois: o que sai chega assim ao cliente.
  test('a prévia troca as variáveis pelo que foi digitado', async () => {
    montar();
    await userEvent.click(await screen.findByRole('radio', { name: /confirmar_visita/ }));
    await userEvent.type(screen.getByLabelText('Variável 1'), 'Maria');
    await userEvent.type(screen.getByLabelText('Variável 2'), 'terça');

    expect(screen.getByText('Olá Maria, podemos agendar para terça?')).toBeInTheDocument();
  });

  test('não deixa enviar com variável em branco', async () => {
    montar();
    await userEvent.click(await screen.findByRole('radio', { name: /confirmar_visita/ }));

    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  });

  test('mostra o erro devolvido pela API', async () => {
    api.sendConversationTemplate.mockRejectedValue({ body: { error: 'Template não aprovado' } });
    montar();
    await userEvent.click(await screen.findByRole('radio', { name: /aviso_tecnico/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText('Template não aprovado')).toBeInTheDocument();
  });

  test('avisa quando o canal não tem template de atendimento', async () => {
    api.listTemplatesForChannel.mockResolvedValue([]);
    montar();

    expect(await screen.findByText(/nenhum template de atendimento aprovado/i)).toBeInTheDocument();
  });

  // O atendente precisa saber que este template dá ao cliente um botão: é o que
  // decide se dá para continuar a conversa ou se a mensagem morre ali.
  test('a prévia mostra os botões que o cliente vai receber', async () => {
    montar();
    await userEvent.click(await screen.findByRole('radio', { name: /agendar_botao/ }));

    const previa = within(screen.getByRole('group', { name: /prévia/i }));
    expect(previa.getByText('Sim, pode agendar')).toBeInTheDocument();
    expect(previa.getByText('Prefiro outro dia')).toBeInTheDocument();
  });

  test('explica que a resposta do botão reabre a conversa', async () => {
    montar();
    await userEvent.click(await screen.findByRole('radio', { name: /agendar_botao/ }));

    expect(screen.getByText(/reabre/i)).toBeInTheDocument();
  });

  test('a escolha é um grupo de rádio e as setas movem a escolha (A5-3)', async () => {
    montar();
    const primeiro = await screen.findByRole('radio', { name: /aviso_tecnico/ });
    expect(screen.getByRole('radiogroup', { name: 'Template' })).toBeInTheDocument();
    await userEvent.click(primeiro);
    expect(primeiro).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowDown}');
    const segundo = screen.getByRole('radio', { name: /confirmar_visita/ });
    expect(segundo).toHaveAttribute('aria-checked', 'true');
    expect(segundo).toHaveFocus();
    expect(primeiro).toHaveAttribute('aria-checked', 'false');
  });

  test('falha ao carregar os templates oferece "Tentar de novo" (A5-6)', async () => {
    api.listTemplatesForChannel.mockRejectedValueOnce({ status: 500, body: {} });
    montar();
    await userEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('radio', { name: /aviso_tecnico/ })).toBeInTheDocument();
    expect(api.listTemplatesForChannel).toHaveBeenCalledTimes(2);
  });
});

function largura(px) {
  vi.stubGlobal('matchMedia', (consulta) => {
    const max = /max-width:\s*(\d+)px/.exec(consulta);
    return { matches: Boolean(max) && px <= Number(max[1]), media: consulta, addEventListener() {}, removeEventListener() {} };
  });
}

// A5-4: o rodapé diz o que falta para enviar. A5-5: o erro fica fixo acima do
// rodapé, fora do corpo que rola. E o que já valia: um envio por vez.
describe('Enviar template: o que falta, erro fixo e um envio só', () => {
  afterEach(() => vi.unstubAllGlobals());
  const nota = () => document.querySelector('.mc-rodape .mc-nota');

  test('o rodapé diz o que falta: escolher, depois cada variável em branco', async () => {
    montar();
    await screen.findByRole('radio', { name: /aviso_tecnico/ });
    expect(nota()).toHaveTextContent('Escolha um template.');
    await userEvent.click(screen.getByRole('radio', { name: /confirmar_visita/ }));
    expect(nota()).toHaveTextContent('Preencha as variáveis 1 e 2.');
    await userEvent.type(screen.getByLabelText('Variável 1'), 'Maria');
    expect(nota()).toHaveTextContent('Preencha a variável 2.');
    await userEvent.type(screen.getByLabelText('Variável 2'), 'terça');
    expect(nota()).toHaveTextContent('');
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled();
  });

  test('carregando: o rodapé pede para aguardar e o envio fica travado', () => {
    api.listTemplatesForChannel.mockReturnValue(new Promise(() => {}));
    montar();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando templates…');
    expect(nota()).toHaveTextContent('Aguarde a lista de templates.');
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  });

  test('erro do envio: fixo acima do rodapé; dois cliques, um envio', async () => {
    let recusar;
    api.sendConversationTemplate.mockReturnValue(new Promise((_, r) => { recusar = r; }));
    montar();
    await userEvent.click(await screen.findByRole('radio', { name: /aviso_tecnico/ }));
    const enviar = screen.getByRole('button', { name: 'Enviar' });
    await userEvent.click(enviar);
    await userEvent.click(enviar);
    expect(api.sendConversationTemplate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
    await act(async () => { recusar({ body: { error: 'This template is not approved' } }); });
    const erro = screen.getByRole('alert');
    expect(erro).toHaveTextContent('Este template ainda não foi aprovado pela Meta.');
    expect(erro).toHaveClass('mc-erro');
    expect(erro.closest('.mc-corpo')).toBeNull();
  });

  test('cada template mostra a categoria e o idioma reais', async () => {
    api.listTemplatesForChannel.mockResolvedValue([{ ...SEM_VARIAVEL, category: 'UTILITY', language: 'pt_BR' }]);
    montar();
    const linha = await screen.findByRole('radio', { name: /aviso_tecnico/ });
    expect(linha).toHaveTextContent('Utilidade');
    expect(linha).toHaveTextContent('Português (Brasil)');
  });

  test('antes da escolha, a prévia diz o que fazer', async () => {
    montar();
    await screen.findByRole('radio', { name: /aviso_tecnico/ });
    expect(screen.getByText('Escolha um template para ver a prévia.')).toBeInTheDocument();
  });

  // No celular a prévia fica depois da lista: tocar num template a traz à vista
  // (sem animação). No desktop ela já está ao lado, e as setas não rolam nada.
  test('celular: tocar num template leva a prévia à vista; desktop não rola', async () => {
    const rolar = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = rolar;
    try {
      montar();
      await userEvent.click(await screen.findByRole('radio', { name: /aviso_tecnico/ }));
      expect(rolar).not.toHaveBeenCalled();
    } finally { Element.prototype.scrollIntoView = original; }
  });

  test('celular: o toque na linha rola até a prévia', async () => {
    largura(390);
    const rolar = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (opcoes) { rolar(this, opcoes); };
    try {
      montar();
      await userEvent.click(await screen.findByRole('radio', { name: /aviso_tecnico/ }));
      expect(rolar).toHaveBeenCalledTimes(1);
      const [alvo, opcoes] = rolar.mock.calls[0];
      expect(alvo).toHaveClass('te-compor');
      expect(opcoes).toEqual({ block: 'start' });
      // Setas não rolam: quem anda com o teclado continua na lista.
      await userEvent.keyboard('{ArrowDown}');
      expect(rolar).toHaveBeenCalledTimes(1);
    } finally { Element.prototype.scrollIntoView = original; }
  });

  test('celular: tela cheia, só a seta de voltar; Escape e o voltar fecham', async () => {
    largura(390);
    const onClose = vi.fn();
    montar({ onClose });
    await screen.findByRole('radio', { name: /aviso_tecnico/ });
    expect(screen.getByRole('dialog', { name: 'Enviar template' })).toHaveClass('is-celular');
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
