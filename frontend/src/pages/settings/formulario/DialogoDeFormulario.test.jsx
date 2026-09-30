import { describe, test, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogoDeFormulario, CampoDoFormulario, ErroDoFormulario } from './DialogoDeFormulario';
import { CampoDeSenha } from './CampoDeSenha';
import { mensagemSegura } from './mensagemSegura';

// A base dos diálogos de formulário de Configurações (Fatia S3), com um
// consumidor mínimo: um campo, o botão que abre e a página que fecha no
// sucesso. Dados fictícios.

function adiado() {
  let resolver;
  let rejeitar;
  const promessa = new Promise((ok, falha) => { resolver = ok; rejeitar = falha; });
  return { promessa, resolver, rejeitar };
}

function Palco({ onEnviar, onConcluido = vi.fn(), onClose = vi.fn() }) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  return (
    <>
      <button type="button" onClick={() => setAberto(true)}>Abrir cadastro</button>
      {aberto && (
        <DialogoDeFormulario
          titulo="Adicionar setor"
          descricao="Crie uma nova fila para organizar os atendimentos."
          acao="Adicionar setor"
          andamento="Adicionando…"
          erroPadrao="Não foi possível adicionar o setor. Verifique os dados e tente novamente."
          onEnviar={() => onEnviar(nome)}
          onConcluido={() => { onConcluido(); setAberto(false); }}
          onClose={() => { onClose(); setAberto(false); }}
        >
          <CampoDoFormulario id="teste-nome" rotulo="Nome do setor" inteiro>
            <input id="teste-nome" className="mc-entrada" value={nome} onChange={(e) => setNome(e.target.value)} required />
          </CampoDoFormulario>
        </DialogoDeFormulario>
      )}
    </>
  );
}

async function abrir(props) {
  const onEnviar = props.onEnviar || vi.fn().mockResolvedValue({});
  const onConcluido = props.onConcluido || vi.fn();
  const onClose = props.onClose || vi.fn();
  render(<Palco onEnviar={onEnviar} onConcluido={onConcluido} onClose={onClose} />);
  const abridor = screen.getByRole('button', { name: 'Abrir cadastro' });
  await userEvent.click(abridor);
  return { onEnviar, onConcluido, onClose, abridor, dialogo: screen.getByRole('dialog', { name: 'Adicionar setor' }) };
}

async function preencherEEnviar(d) {
  await userEvent.type(within(d).getByLabelText('Nome do setor'), 'Setor Exemplo');
  await userEvent.click(within(d).getByRole('button', { name: 'Adicionar setor' }));
}

afterEach(() => { delete window.matchMedia; });

describe('DialogoDeFormulario: moldura', () => {
  test('é a moldura clara da área, com "Fechar" em texto e sem ícone', async () => {
    const { dialogo } = await abrir({});
    expect(dialogo).toHaveClass('mc');
    expect(dialogo).toHaveClass('cfg-dlg-form');
    expect(within(dialogo).getByRole('button', { name: 'Fechar' })).toHaveTextContent('Fechar');
    expect(dialogo.querySelector('svg')).toBeNull();
    expect(within(dialogo).getByText('Crie uma nova fila para organizar os atendimentos.')).toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Nome do setor')).toHaveFocus();
  });
});

describe('DialogoDeFormulario: antes do envio', () => {
  test('Fechar, Cancelar e Escape descartam o formulário como hoje', async () => {
    let r = await abrir({});
    await userEvent.click(within(r.dialogo).getByRole('button', { name: 'Fechar' }));
    expect(r.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(r.abridor);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(r.onClose).toHaveBeenCalledTimes(2);

    await userEvent.click(r.abridor);
    await userEvent.keyboard('{Escape}');
    expect(r.onClose).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('clique fora continua protegido, como hoje: não descarta o formulário', async () => {
    const r = await abrir({});
    await userEvent.type(within(r.dialogo).getByLabelText('Nome do setor'), 'Rascunho');
    await userEvent.click(r.dialogo.parentElement);
    expect(r.onClose).not.toHaveBeenCalled();
    expect(within(screen.getByRole('dialog')).getByLabelText('Nome do setor')).toHaveValue('Rascunho');
  });
});

describe('DialogoDeFormulario: durante o envio', () => {
  test('as quatro saídas ficam bloqueadas e o diálogo continua montado', async () => {
    const pedido = adiado();
    const r = await abrir({ onEnviar: vi.fn().mockReturnValue(pedido.promessa) });
    await preencherEEnviar(r.dialogo);

    const d = screen.getByRole('dialog', { name: 'Adicionar setor' });
    expect(d).toHaveAttribute('aria-busy', 'true');
    expect(within(d).getByRole('button', { name: 'Fechar' })).toBeDisabled();
    expect(within(d).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(within(d).getByText('Fechar, Cancelar e Escape estão bloqueados.')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(d.parentElement);
    expect(r.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Adicionar setor' })).toBeInTheDocument();
    await act(async () => { pedido.resolver({}); });
  });

  test('o controle de envio diz "Adicionando…", fica focável e não aceita segundo envio', async () => {
    const pedido = adiado();
    const r = await abrir({ onEnviar: vi.fn().mockReturnValue(pedido.promessa) });
    await preencherEEnviar(r.dialogo);

    const d = screen.getByRole('dialog', { name: 'Adicionar setor' });
    const enviar = within(d).getByRole('button', { name: 'Adicionando…' });
    expect(enviar).toHaveAttribute('aria-disabled', 'true');
    expect(enviar).not.toBeDisabled();
    expect(enviar).toHaveFocus();
    await userEvent.click(enviar);
    fireEvent.submit(d.querySelector('form'));
    expect(r.onEnviar).toHaveBeenCalledTimes(1);
    expect(within(d).getByLabelText('Nome do setor')).toBeDisabled();
    await act(async () => { pedido.resolver({}); });
  });
});

describe('DialogoDeFormulario: falha', () => {
  test('mantém os dados, mostra a mensagem segura e leva o foco a "Tentar novamente"', async () => {
    const onEnviar = vi.fn().mockRejectedValueOnce({ status: 500, body: { error: 'duplicate key value violates unique constraint' } });
    const r = await abrir({ onEnviar });
    await preencherEEnviar(r.dialogo);

    const d = await screen.findByRole('dialog', { name: 'Adicionar setor' });
    expect(within(d).getByRole('alert')).toHaveTextContent('Não foi possível adicionar o setor. Verifique os dados e tente novamente.');
    expect(d).not.toHaveTextContent('duplicate key');
    expect(within(d).getByLabelText('Nome do setor')).toHaveValue('Setor Exemplo');
    const repetir = within(d).getByRole('button', { name: 'Tentar novamente' });
    expect(repetir).toHaveFocus();
    expect(d).not.toHaveAttribute('aria-busy');
    expect(within(d).getByRole('button', { name: 'Cancelar' })).not.toBeDisabled();

    onEnviar.mockResolvedValueOnce({});
    await userEvent.click(repetir);
    expect(onEnviar).toHaveBeenCalledTimes(2);
    expect(onEnviar).toHaveBeenLastCalledWith('Setor Exemplo');
    expect(r.onConcluido).toHaveBeenCalledTimes(1);
  });

  test('a frase do servidor que já tem tradução chega em português', async () => {
    const onEnviar = vi.fn().mockRejectedValue({ status: 403, body: { error: 'Managers can only create attendant accounts' } });
    const r = await abrir({ onEnviar });
    await preencherEEnviar(r.dialogo);
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Gerentes só podem criar contas de atendente.');
  });

  test('erro de campo leva o foco ao campo inválido', async () => {
    const onEnviar = vi.fn().mockRejectedValue(new ErroDoFormulario('Informe um nome com letras.', 'teste-nome'));
    const r = await abrir({ onEnviar });
    await preencherEEnviar(r.dialogo);
    const d = screen.getByRole('dialog');
    expect(await within(d).findByRole('alert')).toHaveTextContent('Informe um nome com letras.');
    expect(within(d).getByLabelText('Nome do setor')).toHaveFocus();
  });
});

describe('DialogoDeFormulario: sucesso', () => {
  test('fecha só depois da resposta e devolve o foco ao botão que abriu', async () => {
    const pedido = adiado();
    const r = await abrir({ onEnviar: vi.fn().mockReturnValue(pedido.promessa) });
    await preencherEEnviar(r.dialogo);
    expect(r.onConcluido).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await act(async () => { pedido.resolver({ id: 'novo' }); });
    expect(r.onConcluido).toHaveBeenCalledTimes(1);
    expect(r.onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(r.abridor).toHaveFocus();
  });

  test('resposta que chega depois de a página sair é ignorada', async () => {
    const pedido = adiado();
    const onEnviar = vi.fn().mockReturnValue(pedido.promessa);
    const onConcluido = vi.fn();
    const { unmount } = render(<Palco onEnviar={onEnviar} onConcluido={onConcluido} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir cadastro' }));
    await preencherEEnviar(screen.getByRole('dialog'));
    unmount();
    await act(async () => { pedido.resolver({}); });
    expect(onConcluido).not.toHaveBeenCalled();
  });
});

describe('DialogoDeFormulario: celular', () => {
  test('mesma trava na folha inferior, com "Fechar" em texto (sem seta de voltar)', async () => {
    window.matchMedia = (q) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} });
    const pedido = adiado();
    const r = await abrir({ onEnviar: vi.fn().mockReturnValue(pedido.promessa) });
    expect(within(r.dialogo).getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
    expect(within(r.dialogo).queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();
    await preencherEEnviar(r.dialogo);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await act(async () => { pedido.resolver({}); });
  });
});

describe('CampoDeSenha', () => {
  function Senha() {
    const [valor, setValor] = useState('');
    return <CampoDeSenha id="teste-senha" rotulo="Senha inicial" valor={valor} onChange={(e) => setValor(e.target.value)} />;
  }

  test('começa mascarada, com new-password, e alterna com Mostrar/Ocultar', async () => {
    render(<Senha />);
    const campo = screen.getByLabelText('Senha inicial');
    expect(campo).toHaveAttribute('type', 'password');
    expect(campo).toHaveAttribute('autocomplete', 'new-password');
    await userEvent.type(campo, 'senha-ficticia-1');
    const mostrar = screen.getByRole('button', { name: 'Mostrar senha inicial' });
    expect(mostrar).toHaveTextContent('Mostrar');
    expect(mostrar).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(mostrar);
    expect(campo).toHaveAttribute('type', 'text');
    const ocultar = screen.getByRole('button', { name: 'Ocultar senha inicial' });
    expect(ocultar).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(ocultar);
    expect(campo).toHaveAttribute('type', 'password');
  });
});

describe('mensagemSegura', () => {
  test('texto técnico em inglês vira a mensagem padrão; português e traduções passam', () => {
    const P = 'Não foi possível concluir.';
    expect(mensagemSegura({ body: { error: 'duplicate key value violates unique constraint' } }, P)).toBe(P);
    expect(mensagemSegura({ message: 'Failed to fetch' }, P)).toBe(P);
    expect(mensagemSegura({ body: { error: 'An agent with this email already exists' } }, P)).toBe('Já existe um atendente com este e-mail.');
    expect(mensagemSegura({ body: { error: 'name, email, password and role are required' } }, P)).toBe('Preencha nome, e-mail, senha e perfil.');
    expect(mensagemSegura({ body: { error: 'Não dá para mudar a estrutura agora.' } }, P)).toBe('Não dá para mudar a estrutura agora.');
    expect(mensagemSegura(null, P)).toBe(P);
  });
});
