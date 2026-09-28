import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CloseReasonModal from './CloseReasonModal';
import { IconeDoMotivo } from './icones/motivos';
import { useReasons } from '../hooks/useReasons';

vi.mock('../hooks/useReasons');

const AQUI = dirname(fileURLToPath(import.meta.url));

function motivos(lista, extra = {}) {
  useReasons.mockReturnValue({ reasons: lista.map((name, i) => ({ id: `r${i + 1}`, name, active: true })), status: 'ready', loading: false, refresh: vi.fn(), ...extra });
}

beforeEach(() => {
  vi.clearAllMocks();
  motivos(['Troca de senha', 'Pagamento - sem conexão']);
});

afterEach(() => vi.unstubAllGlobals());

function telaDeCelular() {
  vi.stubGlobal('matchMedia', (consulta) => ({ matches: /max-width/.test(consulta), media: consulta, addEventListener() {}, removeEventListener() {} }));
}

// O desenho que o módulo dos motivos daria ao nome, para comparar com o do cartão.
function desenhoDoModulo(nome) {
  const { container, unmount } = render(<IconeDoMotivo nome={nome} />);
  const html = container.querySelector('svg').innerHTML;
  unmount();
  return html;
}
const desenhoDoCartao = (nome) => screen.getByLabelText(nome).closest('label').querySelector('.en-icone svg').innerHTML;

describe('CloseReasonModal', () => {
  test('lista os motivos ativos como opções de rádio, na ordem em que vêm do banco', () => {
    motivos(['Sem conexão', 'Lentidão', 'Segunda via', 'Informações comerciais']);
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    const grupo = screen.getByRole('radiogroup', { name: 'Motivo do contato' });
    expect(within(grupo).getAllByRole('radio').map((r) => r.labels[0].querySelector('.en-nome').textContent)).toEqual(['Sem conexão', 'Lentidão', 'Segunda via', 'Informações comerciais']);
  });

  test('o título e a explicação dão nome e descrição ao diálogo', () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Encerrar atendimento' })).toHaveAccessibleDescription('Selecione o motivo principal deste atendimento.');
  });

  test('Encerrar fica desabilitado até escolher um motivo', async () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /encerrar atendimento/i })).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Troca de senha'));
    expect(screen.getByRole('button', { name: /encerrar atendimento/i })).not.toBeDisabled();
  });

  test('confirmar chama onConfirm com o id do motivo escolhido', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<CloseReasonModal onConfirm={onConfirm} onClose={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('Pagamento - sem conexão'));
    await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));
    expect(onConfirm).toHaveBeenCalledWith('r2');
  });

  test('clique duplo em Encerrar envia uma vez só, e o botão diz que está encerrando', async () => {
    let concluir;
    const onConfirm = vi.fn(() => new Promise((r) => { concluir = r; }));
    render(<CloseReasonModal onConfirm={onConfirm} onClose={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('Troca de senha'));
    const botao = screen.getByRole('button', { name: /encerrar atendimento/i });
    await userEvent.dblClick(botao);
    await userEvent.click(botao);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Encerrando…' })).toBeDisabled();
    concluir();
  });

  test('a falha aparece no diálogo, que continua utilizável, e tentar de novo encerra', async () => {
    const onConfirm = vi.fn()
      .mockRejectedValueOnce({ body: { error: 'Conversation is not currently assigned to you, or is closed' } })
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<CloseReasonModal onConfirm={onConfirm} onClose={onClose} />);

    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Este atendimento não está com você, ou já foi encerrado.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Troca de senha')).toBeChecked();
    await userEvent.click(screen.getByLabelText('Pagamento - sem conexão'));
    await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
    expect(onConfirm).toHaveBeenLastCalledWith('r2');
  });

  test('Cancelar fecha sem encerrar', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<CloseReasonModal onConfirm={onConfirm} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('sem motivos cadastrados: a mensagem de sempre e Encerrar desabilitado', () => {
    motivos([]);
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/nenhum motivo de contato cadastrado ainda/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /encerrar atendimento/i })).toBeDisabled();
  });

  test('carregando: nada de "Nenhum motivo", só o aviso de carregamento', () => {
    useReasons.mockReturnValue({ reasons: [], status: 'loading', loading: true, refresh: vi.fn() });
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText(/nenhum motivo de contato cadastrado/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando os motivos…');
  });

  test('os motivos não carregaram: erro e "Tentar de novo" pede outra vez', async () => {
    const refresh = vi.fn();
    useReasons.mockReturnValue({ reasons: [], status: 'error', error: 'Sem conexão com o servidor.', loading: false, refresh });
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sem conexão com o servidor.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('pré-seleciona o motivo que a IA sugeriu', () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} suggestedReasonId="r2" />);
    expect(screen.getByLabelText('Pagamento - sem conexão')).toBeChecked();
    expect(screen.getByLabelText('Troca de senha')).not.toBeChecked();
    expect(screen.getByRole('button', { name: /encerrar atendimento/i })).not.toBeDisabled();
  });

  test('sem sugestão da IA, nada vem escolhido, como antes', () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} suggestedReasonId={null} />);
    expect(screen.getByLabelText('Troca de senha')).not.toBeChecked();
    expect(screen.getByLabelText('Pagamento - sem conexão')).not.toBeChecked();
    expect(screen.getByRole('button', { name: /encerrar atendimento/i })).toBeDisabled();
  });

  test('o atendente ainda troca o motivo sugerido antes de confirmar', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<CloseReasonModal onConfirm={onConfirm} onClose={vi.fn()} suggestedReasonId="r2" />);
    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));
    expect(onConfirm).toHaveBeenCalledWith('r1');
  });
});

describe('CloseReasonModal: o desenho de cada motivo vem do módulo dos motivos', () => {
  test('cada cartão usa o desenho que o módulo dá ao nome cadastrado', () => {
    const nomes = ['Sem conexão', 'Lentidão', 'Segunda via', 'Comprovante de pagamento', 'Mudança de plano', 'Negociação de débito', 'Instalação', 'Informações comerciais'];
    motivos(nomes);
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    nomes.forEach((nome) => expect(desenhoDoCartao(nome), nome).toBe(desenhoDoModulo(nome)));
  });

  test('Mudança de plano tem desenho próprio e não herda a legenda de endereço; Mudança de endereço continua separada', () => {
    motivos(['Mudança de plano', 'Mudança de endereço']);
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(desenhoDoCartao('Mudança de plano')).toBe(desenhoDoModulo('Troca de plano'));
    expect(desenhoDoCartao('Mudança de plano')).not.toBe(desenhoDoCartao('Mudança de endereço'));
    expect(screen.getByLabelText('Mudança de plano')).not.toHaveAccessibleDescription();
    expect(screen.getByLabelText('Mudança de endereço')).toHaveAccessibleDescription('Alteração de endereço');
  });

  test('"Pagamento - sem conexão" continua Financeiro: desenho e legenda do Financeiro', () => {
    motivos(['Pagamento - sem conexão', 'Financeiro', 'Sem conexão']);
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(desenhoDoCartao('Pagamento - sem conexão')).toBe(desenhoDoCartao('Financeiro'));
    expect(desenhoDoCartao('Pagamento - sem conexão')).not.toBe(desenhoDoCartao('Sem conexão'));
    expect(screen.getByLabelText('Pagamento - sem conexão')).toHaveAccessibleDescription('Boletos, pagamentos, faturas');
  });

  test('nome desconhecido usa o desenho neutro e fica sem legenda', () => {
    motivos(['Visita comercial', 'Troca de senha']);
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(desenhoDoCartao('Visita comercial')).toBe(desenhoDoModulo('Motivo que ninguém cadastrou'));
    expect(screen.getByLabelText('Visita comercial')).not.toHaveAccessibleDescription();
    expect(screen.getByLabelText('Troca de senha')).toHaveAccessibleDescription('Alteração de senha do cliente');
  });

  test('apelidos aprovados chegam ao desenho certo', () => {
    motivos(['Segunda via de fatura', 'Internet lenta', 'Cliente não respondeu', 'Troca de plano']);
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(desenhoDoCartao('Segunda via de fatura')).toBe(desenhoDoModulo('Segunda via'));
    expect(desenhoDoCartao('Internet lenta')).toBe(desenhoDoModulo('Lentidão'));
    expect(desenhoDoCartao('Cliente não respondeu')).toBe(desenhoDoModulo('Sem resposta'));
    expect(desenhoDoCartao('Troca de plano')).toBe(desenhoDoModulo('Mudança de plano'));
  });
});

describe('CloseReasonModal: teclado, foco e ação destrutiva', () => {
  test('o foco começa no primeiro motivo (ou no sugerido), nunca na ação destrutiva', () => {
    const { unmount } = render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Troca de senha')).toHaveFocus();
    unmount();
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} suggestedReasonId="r2" />);
    expect(screen.getByLabelText('Pagamento - sem conexão')).toHaveFocus();
  });

  // Na vida real os motivos chegam do servidor depois de o diálogo abrir: o
  // foco da abertura cai no diálogo e, quando os motivos chegam, passa ao
  // primeiro (ou ao sugerido) — sem tirar o foco de quem já o mudou.
  test('motivos que chegam depois: o foco passa do diálogo ao primeiro motivo, ou ao sugerido', () => {
    useReasons.mockReturnValue({ reasons: [], status: 'loading', loading: true, refresh: vi.fn() });
    const { rerender } = render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} suggestedReasonId="r2" />);
    expect(screen.getByRole('dialog')).toHaveFocus();
    motivos(['Troca de senha', 'Pagamento - sem conexão']);
    rerender(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} suggestedReasonId="r2" />);
    expect(screen.getByLabelText('Pagamento - sem conexão')).toHaveFocus();
  });

  test('motivos que chegam depois não tiram o foco de quem já foi para outro lugar', () => {
    useReasons.mockReturnValue({ reasons: [], status: 'loading', loading: true, refresh: vi.fn() });
    const { rerender } = render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    screen.getByRole('button', { name: 'Cancelar' }).focus();
    motivos(['Troca de senha']);
    rerender(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  test('Espaço e Enter escolhem o motivo com foco; Escape fecha', async () => {
    const onClose = vi.fn();
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={onClose} />);
    screen.getByLabelText('Troca de senha').focus();
    await userEvent.keyboard(' ');
    expect(screen.getByLabelText('Troca de senha')).toBeChecked();
    screen.getByLabelText('Pagamento - sem conexão').focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByLabelText('Pagamento - sem conexão')).toBeChecked();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('o Tab fica preso no diálogo', async () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    const dialogo = screen.getByRole('dialog');
    for (let i = 0; i < 10; i += 1) {
      await userEvent.tab();
      expect(dialogo.contains(document.activeElement)).toBe(true);
    }
  });

  test('a ação destrutiva é o botão vermelho marcado, separado de Cancelar', () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    const encerrar = screen.getByRole('button', { name: 'Encerrar atendimento' });
    expect(encerrar).toHaveClass('is-perigo');
    expect(encerrar).toHaveAttribute('data-danger');
    expect(screen.getByRole('button', { name: 'Cancelar' })).not.toHaveClass('is-perigo');
  });

  test('o aviso do rodapé fala da mensagem ao cliente e do Relatório', () => {
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('O cliente recebe a mensagem de encerramento e o motivo alimenta o Relatório.')).toBeInTheDocument();
  });
});

describe('CloseReasonModal: desktop e celular', () => {
  test('desktop: sai pelo "Fechar", sem seta de voltar', async () => {
    const onClose = vi.fn();
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={onClose} />);
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('celular: tela cheia, só a seta de voltar, e o rodapé com Cancelar e Encerrar', async () => {
    telaDeCelular();
    const onClose = vi.fn();
    render(<CloseReasonModal onConfirm={vi.fn()} onClose={onClose} />);
    const dialogo = screen.getByRole('dialog', { name: 'Encerrar atendimento' });
    expect(dialogo).toHaveClass('is-celular');
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
    expect(dialogo.querySelector('[data-dialog-close]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Encerrar atendimento' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('CloseReasonModal: família DW, sem efeitos pesados', () => {
  const ler = (arquivo) => readFileSync(join(AQUI, arquivo), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  test('os desenhos vêm do módulo dos motivos e da família DW; nada do catálogo antigo, de WaIcons ou SVG próprio', () => {
    const fonte = ler('CloseReasonModal.jsx');
    expect(fonte).not.toMatch(/closeReasonCatalog|WaIcons|icons\/|<svg|<path/);
    expect(fonte).toMatch(/from '\.\/icones\/motivos'/);
    const daFamilia = [...fonte.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/icones'/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
    expect(daFamilia.sort()).toEqual(['IconeEncerrar', 'IconeRecolher']);
    expect(fonte).not.toMatch(/icones\/(sgp|supervisao)|desenhosSgp|desenhosSupervisao/);
  });

  test('a folha do diálogo não tem desfoque, gradiente, animação, filtro, laranja nem fundo escuro', () => {
    const folha = ler('dialogo-encerrar.css');
    expect(folha).not.toMatch(/blur\(|gradient|@keyframes|animation\s*:(?!\s*none)|transition\s*:\s*all|filter\s*:(?!\s*none)/i);
    expect(folha).not.toMatch(/#f28c45|#ff9a6e|#d9b695|#d5a176|#e05a48|#e5a16d|orange|chat-orange/i);
    const seletores = folha.replace(/@media[^{]*\{/g, '').match(/[^{}]+(?=\{)/g).map((s) => s.trim()).filter(Boolean);
    seletores.forEach((s) => expect(s, s).toMatch(/\[data-dialog='close-reason'\]/));
    expect(folha).toMatch(/\[data-dialog='close-reason'\]\.dw-dialog\s*\{[^}]*animation:\s*none/);
    expect(folha).toMatch(/:has\(> \[data-dialog='close-reason'\]\)\s*\{[^}]*backdrop-filter:\s*none/);
  });
});
