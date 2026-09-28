import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Só dados fictícios.
const EMAIL = 'atendente@exemplo.test';
const SENHA = 'senha-ficticia';

function montar() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

// Espera o nome da empresa chegar: o teste não termina com a promessa no ar.
async function montarPronto() {
  const resultado = montar();
  await screen.findByRole('heading', { level: 1, name: 'Provedor Exemplo' });
  return resultado;
}

const campoEmail = () => screen.getByLabelText('E-mail');
const campoSenha = () => screen.getByLabelText('Senha');
const botaoEntrar = () => screen.getByRole('button', { name: 'Entrar' });

async function preencher(user, email = EMAIL, senha = SENHA) {
  if (email) await user.type(campoEmail(), email);
  if (senha) await user.type(campoSenha(), senha);
}

function adiado() {
  let resolver;
  let rejeitar;
  const promessa = new Promise((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

// matchMedia não existe no jsdom. `fino` responde às consultas de mouse.
function simularPonteiro(fino) {
  const listas = [];
  window.matchMedia = vi.fn((consulta) => {
    const lista = {
      matches: fino && /pointer:\s*fine/.test(consulta),
      media: consulta,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    listas.push(lista);
    return lista;
  });
  return listas;
}

let login;

beforeEach(() => {
  vi.clearAllMocks();
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor Exemplo' });
  login = vi.fn().mockResolvedValue({});
  useAuth.mockReturnValue({ login });
});

afterEach(() => {
  delete window.matchMedia;
});

describe('LoginPage: estrutura do mockup aprovado', () => {
  test('nome da empresa, rótulo "Atendimento" e título "Entrar", nessa ordem', async () => {
    montar();
    const empresa = await screen.findByRole('heading', { level: 1, name: 'Provedor Exemplo' });
    const rotulo = screen.getByText('Atendimento');
    const titulo = screen.getByRole('heading', { level: 2, name: 'Entrar' });

    expect(empresa.compareDocumentPosition(rotulo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rotulo.compareDocumentPosition(titulo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Entrar' })).toBeInTheDocument();
  });

  test('os textos e blocos do login antigo saíram', async () => {
    montar();
    await screen.findByRole('heading', { level: 1, name: 'Provedor Exemplo' });

    for (const antigo of [
      /Acesso restrito/i,
      /Plataforma de atendimento/i,
      /Um lugar claro/i,
      /Acesso à plataforma/i,
      /Entre com seu e-mail e senha/i,
      /Lembrar/i,
      /Esqueci/i,
      /da Provedor Exemplo/,
    ]) {
      expect(screen.queryByText(antigo)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('region', { name: /apresentação/i })).not.toBeInTheDocument();
  });

  test('sem desfoque, vidro, gradiente, animação ou tema escuro no DOM', async () => {
    const { container } = montar();
    await screen.findByRole('heading', { level: 1, name: 'Provedor Exemplo' });

    expect(container.innerHTML).not.toMatch(/blur|backdrop|gradient|animate-|chat-theme|font-display|shadow-\[/);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});

describe('LoginPage: ícones dos campos', () => {
  test('exatamente dois SVGs próprios, cada um no círculo do seu campo', async () => {
    const { container } = await montarPronto();
    const svgs = [...container.querySelectorAll('svg')];

    expect(svgs).toHaveLength(2);
    const [conta, cadeado] = svgs;
    expect(campoEmail().closest('.login-campo')).toContainElement(conta);
    expect(campoSenha().closest('.login-campo')).toContainElement(cadeado);

    for (const svg of svgs) {
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('fill')).toBe('none');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('stroke-width')).toBe('1.75');
      expect(svg.getAttribute('stroke-linecap')).toBe('round');
      expect(svg.getAttribute('stroke-linejoin')).toBe('round');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');

      // Nenhuma cor fixa dentro do desenho: a cor vem do círculo.
      for (const elemento of [svg, ...svg.querySelectorAll('*')]) {
        for (const { name, value } of elemento.attributes) {
          if (['fill', 'stroke', 'color', 'stop-color'].includes(name)) {
            expect(['none', 'currentColor']).toContain(value);
          }
          expect(name).not.toBe('style');
        }
      }
      // Nada de emoji ou caractere no lugar do desenho.
      expect(svg.closest('.login-circulo').textContent).toBe('');
    }
  });

  test('geometria: conta (cabeça e ombros) e cadeado (corpo, alça e fechadura) dentro de 24×24', async () => {
    const { container } = await montarPronto();
    const [conta, cadeado] = container.querySelectorAll('svg');

    expect([...conta.children].map((el) => el.tagName)).toEqual(['circle', 'path']);
    const cabeca = conta.querySelector('circle');
    expect(Number(cabeca.getAttribute('cx'))).toBe(12);
    expect(Number(cabeca.getAttribute('r'))).toBeGreaterThanOrEqual(3);
    expect(Number(cabeca.getAttribute('r'))).toBeLessThanOrEqual(4.5);

    expect([...cadeado.children].map((el) => el.tagName)).toEqual(['rect', 'path', 'path']);
    const corpo = cadeado.querySelector('rect');
    expect(Number(corpo.getAttribute('rx'))).toBeGreaterThan(0);
    expect(Number(corpo.getAttribute('x')) + Number(corpo.getAttribute('width')) / 2).toBe(12);
    const [alca] = cadeado.querySelectorAll('path');
    expect(alca.getAttribute('d')).toMatch(/a/i);

    // Tudo dentro da prancheta, com respiro para o traço de 1,75.
    for (const svg of [conta, cadeado]) {
      for (const el of svg.querySelectorAll('*')) {
        const texto = ['d', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx'].map((a) => el.getAttribute(a) || '').join(' ');
        for (const numero of texto.match(/-?\d*\.?\d+/g) || []) {
          expect(Math.abs(Number(numero))).toBeLessThanOrEqual(24);
        }
      }
    }
  });
});

describe('LoginPage: nome da empresa', () => {
  test('carregando: barra estática no lugar do nome, sem pulsar, anunciada ao leitor de tela', () => {
    api.getPublicCompany.mockReturnValue(new Promise(() => {}));
    const { container } = montar();

    const titulo = screen.getByRole('heading', { level: 1 });
    expect(titulo).toHaveTextContent('Carregando o nome da empresa…');
    expect(titulo.querySelector('.login-esqueleto')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[class*="animate"], [class*="pulse"]')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Atendimento' })).not.toBeInTheDocument();
  });

  test('sem nome cadastrado: título "Atendimento", sem repetir o rótulo', async () => {
    api.getPublicCompany.mockResolvedValue({ name: '' });
    montar();

    expect(await screen.findByRole('heading', { level: 1, name: 'Atendimento' })).toBeInTheDocument();
    expect(screen.getAllByText('Atendimento')).toHaveLength(1);
  });

  test('rota pública fora do ar: título "Atendimento" e a tela continua de pé', async () => {
    api.getPublicCompany.mockRejectedValue(new Error('offline'));
    montar();

    expect(await screen.findByRole('heading', { level: 1, name: 'Atendimento' })).toBeInTheDocument();
    expect(botaoEntrar()).toBeInTheDocument();
  });

  test('nome longo: chega inteiro, na classe que limita a duas linhas', async () => {
    const longo = 'Cooperativa Regional de Telecomunicações e Internet do Vale do Exemplo';
    api.getPublicCompany.mockResolvedValue({ name: longo });
    montar();

    const titulo = await screen.findByRole('heading', { level: 1, name: longo });
    expect(titulo).toHaveClass('login-empresa');
  });
});

describe('LoginPage: campos', () => {
  test('name e autocomplete certos para o preenchimento automático', async () => {
    await montarPronto();
    const email = campoEmail();
    const senha = campoSenha();

    expect(email).toHaveAttribute('name', 'email');
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocapitalize', 'none');
    expect(email).toHaveAttribute('spellcheck', 'false');
    expect(senha).toHaveAttribute('name', 'password');
    expect(senha).toHaveAttribute('autocomplete', 'current-password');
    expect(senha).toHaveAttribute('type', 'password');
    // A validação é da página: nada de balão nativo do navegador.
    expect(screen.getByRole('form', { name: 'Entrar' }).noValidate).toBe(true);
  });

  test('Mostrar e Ocultar alternam a senha sem enviar o formulário', async () => {
    const user = userEvent.setup();
    montar();
    await user.type(campoSenha(), SENHA);

    const mostrar = screen.getByRole('button', { name: 'Mostrar senha' });
    expect(mostrar).toHaveAttribute('type', 'button');
    expect(mostrar).toHaveAttribute('aria-controls', campoSenha().id);
    expect(mostrar).toHaveTextContent(/^Mostrar/);

    await user.click(mostrar);
    expect(campoSenha()).toHaveAttribute('type', 'text');
    expect(campoSenha()).toHaveValue(SENHA);

    const ocultar = screen.getByRole('button', { name: 'Ocultar senha' });
    expect(ocultar).toHaveTextContent(/^Ocultar/);
    await user.click(ocultar);
    expect(campoSenha()).toHaveAttribute('type', 'password');
    expect(login).not.toHaveBeenCalled();
  });

  test('a senha à mostra não passa por corretor nem por maiúscula automática', async () => {
    await montarPronto();
    expect(campoSenha()).toHaveAttribute('spellcheck', 'false');
    expect(campoSenha()).toHaveAttribute('autocapitalize', 'none');
    expect(campoSenha()).toHaveAttribute('autocorrect', 'off');
  });
});

describe('LoginPage: validação própria, ao lado do campo', () => {
  test('e-mail vazio: aviso junto do campo, foco no e-mail e nenhum pedido', async () => {
    const user = userEvent.setup();
    montar();
    await user.type(campoSenha(), SENHA);
    await user.click(botaoEntrar());

    const email = campoEmail();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Informe o e-mail.');
    expect(email.closest('.login-grupo')).toHaveTextContent('Informe o e-mail.');
    expect(email).toHaveFocus();
    expect(login).not.toHaveBeenCalled();
  });

  test('e-mail inválido: "Informe um e-mail válido."', async () => {
    const user = userEvent.setup();
    montar();
    await preencher(user, 'atendente.exemplo.test');
    await user.click(botaoEntrar());

    expect(campoEmail()).toHaveAttribute('aria-invalid', 'true');
    expect(campoEmail()).toHaveAccessibleDescription('Informe um e-mail válido.');
    expect(campoEmail()).toHaveFocus();
    expect(login).not.toHaveBeenCalled();
  });

  test('senha vazia: aviso junto da senha e foco nela', async () => {
    const user = userEvent.setup();
    montar();
    await preencher(user, EMAIL, '');
    await user.click(botaoEntrar());

    expect(campoSenha()).toHaveAttribute('aria-invalid', 'true');
    expect(campoSenha()).toHaveAccessibleDescription('Informe a senha.');
    expect(campoSenha().closest('.login-grupo')).toHaveTextContent('Informe a senha.');
    expect(campoSenha()).toHaveFocus();
    expect(campoEmail()).not.toHaveAttribute('aria-invalid');
    expect(login).not.toHaveBeenCalled();
  });

  test('corrigir o campo tira o aviso dele', async () => {
    const user = userEvent.setup();
    montar();
    await user.click(botaoEntrar());
    expect(campoEmail()).toHaveAttribute('aria-invalid', 'true');

    await user.type(campoEmail(), 'a');
    expect(campoEmail()).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('Informe o e-mail.')).not.toBeInTheDocument();
  });

  test('Enter no campo de senha envia', async () => {
    const user = userEvent.setup();
    montar();
    await user.type(campoEmail(), EMAIL);
    await user.type(campoSenha(), `${SENHA}{Enter}`);

    expect(login).toHaveBeenCalledWith(EMAIL, SENHA);
  });
});

describe('LoginPage: envio', () => {
  test('durante o envio: "Entrando…", campos só leitura e o foco continua no formulário', async () => {
    const pedido = adiado();
    login.mockReturnValue(pedido.promessa);
    const user = userEvent.setup();
    montar();
    await preencher(user);
    await user.click(botaoEntrar());

    const botao = screen.getByRole('button', { name: 'Entrando…' });
    expect(botao).toHaveAttribute('aria-disabled', 'true');
    // Não é `disabled`: o botão focado continuaria recebendo o foco, e não o <body>.
    expect(botao).toBeEnabled();
    expect(botao).toHaveFocus();
    expect(screen.getByRole('form', { name: 'Entrar' })).toHaveAttribute('aria-busy', 'true');
    expect(campoEmail()).toHaveAttribute('readonly');
    expect(campoSenha()).toHaveAttribute('readonly');

    await user.type(campoEmail(), 'x');
    expect(campoEmail()).toHaveValue(EMAIL);

    const mostrar = screen.getByRole('button', { name: 'Mostrar senha' });
    expect(mostrar).toHaveAttribute('aria-disabled', 'true');
    await user.click(mostrar);
    expect(campoSenha()).toHaveAttribute('type', 'password');

    await act(async () => pedido.resolver({}));
  });

  test('segundo clique, Enter e novo envio durante o pedido não repetem o login', async () => {
    const pedido = adiado();
    login.mockReturnValue(pedido.promessa);
    const user = userEvent.setup();
    montar();
    await preencher(user);

    await user.click(botaoEntrar());
    await user.click(screen.getByRole('button', { name: 'Entrando…' }));
    await user.keyboard('{Enter}');
    fireEvent.submit(screen.getByRole('form', { name: 'Entrar' }));

    expect(login).toHaveBeenCalledTimes(1);
    await act(async () => pedido.resolver({}));
  });

  test('ao enviar, a senha volta a ficar oculta', async () => {
    const pedido = adiado();
    login.mockReturnValue(pedido.promessa);
    const user = userEvent.setup();
    montar();
    await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(campoSenha()).toHaveAttribute('type', 'text');

    await user.click(botaoEntrar());
    expect(campoSenha()).toHaveAttribute('type', 'password');
    await act(async () => pedido.resolver({}));
  });

  test('sucesso: entra com o e-mail e a senha digitados e vai para /', async () => {
    const user = userEvent.setup();
    montar();
    await preencher(user);
    await user.click(botaoEntrar());

    expect(login).toHaveBeenCalledWith(EMAIL, SENHA);
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });
});

const INGLES = /invalid|credentials|disabled|too many|request|failed|fetch|unexpected|token|server|required|error/i;

describe('LoginPage: erros do login', () => {
  const CASOS = [
    ['senha errada (401)', { status: 401, body: { error: 'Invalid credentials' } }, 'E-mail ou senha incorretos.'],
    ['conta desativada (403)', { status: 403, body: { error: 'Account disabled' } }, 'Esta conta está desativada. Procure um administrador.'],
    [
      'tentativas demais (429)',
      { status: 429, body: { error: 'Too many requests, please try again later' } },
      'Muitas tentativas seguidas. Espere um pouco e tente de novo.',
    ],
    ['erro do servidor (500)', { status: 500, body: { error: 'Internal server error' } }, 'O servidor encontrou um erro. Tente de novo em instantes.'],
    ['servidor sem corpo (502)', { status: 502, body: null }, 'O servidor encontrou um erro. Tente de novo em instantes.'],
    ['resposta ilegível', new SyntaxError('Unexpected token < in JSON at position 0'), 'O servidor encontrou um erro. Tente de novo em instantes.'],
    ['sem rede', new TypeError('Failed to fetch'), 'Sem conexão com o servidor. Verifique a internet e tente de novo.'],
    ['erro sem tradução (400)', { status: 400, body: { error: 'email and password are required' } }, 'Não foi possível entrar. Tente de novo.'],
  ];

  test.each(CASOS)('%s: mensagem em português, formulário de pé, foco no e-mail e senha preservada', async (_nome, erro, esperado) => {
    login.mockRejectedValue(erro);
    const user = userEvent.setup();
    montar();
    await preencher(user);
    await user.click(botaoEntrar());

    expect(await screen.findByRole('alert')).toHaveTextContent(esperado);
    expect(campoEmail()).toHaveFocus();
    expect(campoSenha()).toHaveValue(SENHA);
    expect(campoEmail()).toHaveValue(EMAIL);
    expect(botaoEntrar()).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('alert').textContent).not.toMatch(INGLES);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('sem rede e senha errada são mensagens diferentes', () => {
    const rede = CASOS.find(([nome]) => nome === 'sem rede')[2];
    const credencial = CASOS.find(([nome]) => nome.startsWith('senha errada'))[2];
    expect(rede).not.toBe(credencial);
  });

  test('a mesma recusa, de novo, sai e volta (o leitor de tela anuncia outra vez)', async () => {
    const segunda = adiado();
    login.mockRejectedValueOnce({ status: 401, body: { error: 'Invalid credentials' } }).mockReturnValueOnce(segunda.promessa);
    const user = userEvent.setup();
    montar();
    await preencher(user);
    await user.click(botaoEntrar());
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.');

    await user.click(botaoEntrar());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => segunda.rejeitar({ status: 401, body: { error: 'Invalid credentials' } }));
    expect(screen.getByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.');
  });
});

describe('LoginPage: foco inicial', () => {
  test('com mouse, o foco começa no e-mail, sem deixar ouvinte registrado', async () => {
    const listas = simularPonteiro(true);
    await montarPronto();

    expect(campoEmail()).toHaveFocus();
    for (const lista of listas) {
      expect(lista.addEventListener).not.toHaveBeenCalled();
      expect(lista.addListener).not.toHaveBeenCalled();
    }
  });

  test('no toque, nenhum campo recebe foco (o teclado não abre sozinho)', async () => {
    simularPonteiro(false);
    await montarPronto();
    expect(document.body).toHaveFocus();
  });

  test('sem matchMedia, não quebra e não foca', async () => {
    await montarPronto();
    expect(document.body).toHaveFocus();
  });
});
