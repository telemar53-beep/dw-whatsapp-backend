import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdicionarCanalDialog from './AdicionarCanalDialog';
import { useAuth } from '../../../contexts/AuthContext';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../services/api');

function adiado() {
  let resolver;
  let rejeitar;
  const promessa = new Promise((res, rej) => { resolver = res; rejeitar = rej; });
  return { promessa, resolver, rejeitar };
}

function montar(props = {}) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const utils = render(<AdicionarCanalDialog onClose={onClose} onCreated={onCreated} {...props} />);
  return { ...utils, onClose, onCreated };
}
const dialogo = () => screen.getByRole('dialog', { name: 'Adicionar canal' });
async function escolher(nome) {
  await userEvent.click(within(dialogo()).getByRole('button', { name: new RegExp(`^${nome}`) }));
}
async function preencher(campos) {
  for (const [rotulo, valor] of campos) await userEvent.type(screen.getByLabelText(rotulo), valor);
}
// Dados fictícios.
const BAILEYS = [['Nome do canal', 'Canal Exemplo'], ['Telefone', '+5500900000099']];
const META = [...BAILEYS, ['Phone Number ID', '000000000000099'], ['WABA ID', '000000000000001'], ['Access Token', 'token-ficticio-0000']];
const D360 = [...BAILEYS, ['API Key', 'chave-ficticia-0000'], ['WABA ID', '000000000000002']];

beforeEach(() => {
  vi.clearAllMocks();
  api.createChannel.mockReset();
  useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
  api.createChannel.mockResolvedValue({ id: 'novo', type: 'baileys', name: 'Canal Exemplo' });
});
afterEach(() => { delete window.matchMedia; });

describe('Adicionar canal: escolha da conexão', () => {
  test('diálogo claro com os três tipos em emblemas de texto, sem marca de terceiro', () => {
    montar();
    const d = dialogo();
    expect(d).toHaveClass('mc');
    expect(within(d).getByText('Escolha como este número será conectado.')).toBeInTheDocument();
    const opcoes = within(d).getAllByRole('button', { name: /Continuar/ });
    expect(opcoes.map((b) => b.querySelector('.cfg-emblema').textContent)).toEqual(['BL', 'API', 'BSP']);
    expect(d.querySelector('img')).toBeNull();
    expect(d.querySelector('.channel-brand, [data-provider]')).toBeNull();
  });

  test('o foco começa na primeira opção', () => {
    montar();
    expect(within(dialogo()).getAllByRole('button', { name: /Continuar/ })[0]).toHaveFocus();
  });

  test('escolher leva ao formulário com o foco no nome; "Trocar conexão" volta com o foco na escolha feita', async () => {
    montar();
    await escolher('Meta Cloud');
    expect(screen.getByLabelText('Nome do canal')).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Trocar conexão' }));
    expect(within(dialogo()).getByRole('button', { name: /^Meta Cloud/ })).toHaveFocus();
  });
});

describe('Adicionar canal: segredos', () => {
  test('Access Token começa mascarado, sem autocompletar, e mostra/oculta pelo botão', async () => {
    montar();
    await escolher('Meta Cloud');
    const token = screen.getByLabelText('Access Token');
    expect(token).toHaveAttribute('type', 'password');
    expect(token).toHaveAttribute('autocomplete', 'off');
    const mostrar = screen.getByRole('button', { name: 'Mostrar Access Token' });
    expect(mostrar).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(mostrar);
    expect(token).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ocultar Access Token' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('API Key da 360dialog também', async () => {
    montar();
    await escolher('360dialog');
    const chave = screen.getByLabelText('API Key');
    expect(chave).toHaveAttribute('type', 'password');
    expect(chave).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByRole('button', { name: 'Mostrar API Key' })).toBeInTheDocument();
  });
});

describe('Adicionar canal: payload igual ao de antes', () => {
  test('Baileys: tipo, nome e telefone; ao concluir, segue para o QR', async () => {
    const { onCreated } = montar();
    await escolher('Baileys');
    await preencher(BAILEYS);
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar e conectar' }));
    expect(api.createChannel).toHaveBeenCalledWith({ type: 'baileys', name: 'Canal Exemplo', phoneNumber: '+5500900000099' }, 'tok');
    expect(onCreated).toHaveBeenCalledWith({ id: 'novo', type: 'baileys', name: 'Canal Exemplo' });
  });

  test('Meta Cloud: com Phone Number ID, Access Token e WABA ID', async () => {
    montar();
    await escolher('Meta Cloud');
    await preencher(META);
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar canal' }));
    expect(api.createChannel).toHaveBeenCalledWith(
      { type: 'meta_cloud', name: 'Canal Exemplo', phoneNumber: '+5500900000099', phoneNumberId: '000000000000099', accessToken: 'token-ficticio-0000', wabaId: '000000000000001' },
      'tok'
    );
  });

  test('360dialog: com API Key e WABA ID', async () => {
    montar();
    await escolher('360dialog');
    await preencher(D360);
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar canal' }));
    expect(api.createChannel).toHaveBeenCalledWith(
      { type: '360dialog', name: 'Canal Exemplo', phoneNumber: '+5500900000099', apiKey: 'chave-ficticia-0000', wabaId: '000000000000002' },
      'tok'
    );
  });
});

describe('Adicionar canal: envio bloqueado de ponta a ponta', () => {
  test('"Adicionando…", sem duplicar, e sem Fechar, Cancelar, Trocar conexão, Esc nem clique fora', async () => {
    const pedido = adiado();
    api.createChannel.mockReturnValue(pedido.promessa);
    const { onClose, onCreated } = montar();
    await escolher('360dialog');
    await preencher(D360);
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar canal' }));

    const d = dialogo();
    expect(d).toHaveAttribute('aria-busy', 'true');
    // O botão de envio segura o foco: aria-disabled, e não disabled (um botão
    // desativado com foco joga o foco no <body>, medido no navegador).
    const enviar = within(d).getByRole('button', { name: 'Adicionando…' });
    expect(enviar).toHaveAttribute('aria-disabled', 'true');
    expect(enviar).not.toBeDisabled();
    expect(enviar).toHaveFocus();
    expect(within(d).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(within(d).getByRole('button', { name: 'Fechar' })).toBeDisabled();
    // Como no mockup: o voltar dá lugar à nota de que a saída está presa.
    expect(within(d).queryByRole('button', { name: 'Trocar conexão' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nome do canal')).toBeDisabled();
    expect(within(d).getByText('Fechar e voltar estão bloqueados durante o envio.')).toBeInTheDocument();

    await userEvent.click(enviar);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(d.parentElement);
    expect(api.createChannel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { pedido.resolver({ id: 'novo', type: '360dialog', name: 'Canal Exemplo' }); });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  test('enviar com Enter num campo leva o foco ao botão de envio; na falha ele continua lá, como "Tentar novamente"', async () => {
    const pedido = adiado();
    api.createChannel.mockReturnValue(pedido.promessa);
    montar();
    await escolher('360dialog');
    await preencher(D360);
    // O Enter do navegador submete o formulário com o foco no campo (o jsdom
    // não faz a submissão implícita com o botão fora do <form>).
    act(() => { screen.getByLabelText('WABA ID').focus(); });
    fireEvent.submit(document.getElementById('cfg-form-adicionar'));
    const enviar = within(dialogo()).getByRole('button', { name: 'Adicionando…' });
    expect(enviar).toHaveFocus();
    await act(async () => { pedido.rejeitar({ status: 500, body: { error: 'Internal failed' } }); });
    const repetir = within(dialogo()).getByRole('button', { name: 'Tentar novamente' });
    expect(repetir).toHaveFocus();
    expect(repetir).not.toHaveAttribute('aria-disabled');
  });

  test('resposta que chega depois de o diálogo sumir é descartada', async () => {
    const pedido = adiado();
    api.createChannel.mockReturnValue(pedido.promessa);
    const { onCreated, unmount } = montar();
    await escolher('Baileys');
    await preencher(BAILEYS);
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar e conectar' }));
    unmount();
    await act(async () => { pedido.resolver({ id: 'novo', type: 'baileys' }); });
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe('Adicionar canal: erro seguro, dentro do diálogo', () => {
  test('mantém os dados, mostra o motivo em português e oferece "Tentar novamente"', async () => {
    api.createChannel.mockRejectedValue({ status: 400, body: { error: 'Não foi possível registrar o webhook na 360dialog — confira a API Key' } });
    const { onCreated } = montar();
    await escolher('360dialog');
    await preencher(D360);
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar canal' }));

    expect(within(dialogo()).getByRole('alert')).toHaveTextContent('Não foi possível validar a chave da 360dialog. Confira a API Key e tente novamente.');
    expect(screen.getByLabelText('Nome do canal')).toHaveValue('Canal Exemplo');
    expect(screen.getByLabelText('API Key')).toHaveValue('chave-ficticia-0000');
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeEnabled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  test('frase técnica do servidor em inglês não chega à tela', async () => {
    api.createChannel.mockRejectedValue({ status: 400, body: { error: 'type, name and phoneNumber are required' } });
    montar();
    await escolher('Baileys');
    await preencher(BAILEYS);
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar e conectar' }));
    const alerta = within(dialogo()).getByRole('alert');
    expect(alerta).toHaveTextContent('Preencha o nome do canal e o telefone.');
    expect(alerta).not.toHaveTextContent(/required/);
  });

  test('telefone repetido vira frase clara', async () => {
    api.createChannel.mockRejectedValue({ status: 409, body: { error: 'A channel with this phone number already exists' } });
    montar();
    await escolher('Baileys');
    await preencher(BAILEYS);
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar e conectar' }));
    expect(within(dialogo()).getByRole('alert')).toHaveTextContent('Já existe um canal com este número.');
  });
});

describe('Adicionar canal: celular', () => {
  test('mesmo bloqueio no celular, com "Voltar" no lugar de "Trocar conexão"', async () => {
    window.matchMedia = (q) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} });
    const pedido = adiado();
    api.createChannel.mockReturnValue(pedido.promessa);
    const { onClose } = montar();
    await escolher('Baileys');
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument();
    await preencher(BAILEYS);
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar e conectar' }));
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();
    expect(screen.getByText('Fechar e voltar estão bloqueados durante o envio.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { pedido.resolver({ id: 'novo', type: 'baileys' }); });
  });
});
