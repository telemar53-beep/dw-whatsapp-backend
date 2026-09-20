import { describe, test, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogBody, DialogFooter } from './Dialog';
import { ConfirmDialog } from './ConfirmDialog';
import { altura } from './dialogStack';

// O jsdom não tem PointerEvent: `fireEvent.pointerDown` chega sem `button`,
// `pointerId` nem `clientX`, e a regra de clique-versus-arrasto passaria sem
// nunca ser exercitada. Despachar um MouseEvent com o nome do evento de
// ponteiro entrega os campos que o navegador manda de verdade.
function ponteiro(alvo, tipo, x, y) {
  fireEvent(alvo, new MouseEvent(tipo, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
}

// A base é testada UMA vez, aqui. Era este o ponto da Etapa 4: sem isto, cada
// um dos 22 diálogos precisaria do seu próprio teste de foco, ESC e camada.

function Formulario({ onClose = () => {}, ...resto }) {
  return (
    <Dialog title="Editar cliente" description="Dados do contato" onClose={onClose} {...resto}>
      <DialogBody>
        <label htmlFor="nome">Nome</label>
        <input id="nome" />
        <label htmlFor="cidade">Cidade</label>
        <input id="cidade" />
      </DialogBody>
      <DialogFooter>
        <button type="button" onClick={onClose}>Cancelar</button>
        <button type="button">Salvar</button>
      </DialogFooter>
    </Dialog>
  );
}

// Pai e filho de verdade: o pai renderiza o filho quando pedem, como
// "Encerrados" faz com a conversa.
function Pilha({ niveis = 2, aoFecharTopo }) {
  const [abertos, setAbertos] = useState(1);
  if (abertos === 0) return null;
  return (
    <Dialog title="Encerrados" variant="closed" onClose={() => setAbertos(0)}>
      <DialogBody>
        <button type="button" onClick={() => setAbertos(2)}>Abrir conversa</button>
      </DialogBody>
      {abertos >= 2 && (
        <Dialog
          title="Conversa"
          variant="conversation"
          onClose={() => {
            setAbertos(1);
            if (aoFecharTopo) aoFecharTopo();
          }}
        >
          <DialogBody>
            {niveis >= 3 && <button type="button" onClick={() => setAbertos(3)}>Encerrar</button>}
          </DialogBody>
          {abertos >= 3 && (
            <Dialog title="Motivo do contato" variant="close-reason" onClose={() => setAbertos(2)}>
              <DialogBody>conteúdo</DialogBody>
            </Dialog>
          )}
        </Dialog>
      )}
    </Dialog>
  );
}

describe('base de diálogo', () => {
  test('a pilha começa e termina vazia em cada teste', () => {
    expect(altura()).toBe(0);
  });

  test('o nome acessível vem do título visível (aria-labelledby)', () => {
    render(<Formulario />);
    const dialogo = screen.getByRole('dialog');
    const titulo = screen.getByRole('heading', { name: 'Editar cliente' });
    expect(dialogo).toHaveAttribute('aria-labelledby', titulo.id);
    expect(dialogo).toHaveAccessibleName('Editar cliente');
    expect(dialogo).toHaveAccessibleDescription('Dados do contato');
  });

  test('o foco inicial vai para o primeiro campo, não para o "x"', () => {
    render(<Formulario />);
    expect(document.activeElement).toBe(screen.getByLabelText('Nome'));
  });

  test('sem campo nenhum, o foco fica no próprio diálogo', () => {
    render(
      <Dialog title="Atendimentos anteriores" onClose={() => {}} dismissible={false}>
        <DialogBody>uma lista vazia</DialogBody>
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  test('em alertdialog o foco inicial é a saída segura, nunca a ação destrutiva', () => {
    render(<ConfirmDialog open message="Excluir a cidade?" danger confirmLabel="Excluir" onConfirm={() => {}} onCancel={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Excluir' })).toHaveAttribute('data-danger');
  });

  test('Tab não escapa do diálogo: do último volta para o primeiro', async () => {
    render(<Formulario />);
    const foco = [screen.getByLabelText('Nome'), screen.getByLabelText('Cidade'),
      screen.getByRole('button', { name: 'Cancelar' }), screen.getByRole('button', { name: 'Salvar' })];
    const fechar = screen.getByRole('button', { name: 'Fechar' });

    fechar.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(foco[0]);

    foco[3].focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(fechar);
  });

  test('Shift+Tab do primeiro focável volta para o último', async () => {
    render(<Formulario />);
    screen.getByRole('button', { name: 'Fechar' }).focus();
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Salvar' }));
  });

  test('ao fechar, o foco volta para quem abriu', async () => {
    function Tela() {
      const [aberto, setAberto] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setAberto(true)}>Editar cliente</button>
          {aberto && <Formulario onClose={() => setAberto(false)} />}
        </>
      );
    }
    render(<Tela />);
    const abridor = screen.getByRole('button', { name: 'Editar cliente' });
    await userEvent.click(abridor);
    expect(document.activeElement).toBe(screen.getByLabelText('Nome'));

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(document.activeElement).toBe(abridor);
  });

  test('se quem abriu sumiu, o foco volta para o diálogo que virou topo', async () => {
    render(<Pilha />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir conversa' }));
    const pai = document.querySelector('[data-dialog="closed"]');
    // O abridor está dentro do pai, que agora está inerte; simula o caso real
    // de ele sair da lista (filtro, recarga) enquanto o filho está aberto.
    screen.getByRole('button', { name: 'Abrir conversa' }).remove();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(pai);
  });

  test('ESC com dois níveis fecha só o de cima', async () => {
    const aoFecharTopo = vi.fn();
    render(<Pilha aoFecharTopo={aoFecharTopo} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir conversa' }));
    expect(document.querySelector('[data-dialog="conversation"]')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(aoFecharTopo).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-dialog="conversation"]')).toBeNull();
    expect(document.querySelector('[data-dialog="closed"]')).toBeTruthy();
  });

  test('ESC com três níveis desce um por vez, na ordem', async () => {
    render(<Pilha niveis={3} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir conversa' }));
    await userEvent.click(screen.getByRole('button', { name: 'Encerrar' }));
    const aberto = (variante) => Boolean(document.querySelector(`[data-dialog="${variante}"]`));
    expect([aberto('closed'), aberto('conversation'), aberto('close-reason')]).toEqual([true, true, true]);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect([aberto('closed'), aberto('conversation'), aberto('close-reason')]).toEqual([true, true, false]);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect([aberto('closed'), aberto('conversation'), aberto('close-reason')]).toEqual([true, false, false]);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect([aberto('closed'), aberto('conversation'), aberto('close-reason')]).toEqual([false, false, false]);
  });

  test('a camada cresce com a profundidade e só o topo fica interativo', async () => {
    render(<Pilha />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir conversa' }));
    const fundoPai = document.querySelector('[data-dialog="closed"]').parentElement;
    const fundoFilho = document.querySelector('[data-dialog="conversation"]').parentElement;

    expect(Number(fundoFilho.dataset.dialogDepth)).toBeGreaterThan(Number(fundoPai.dataset.dialogDepth));
    expect(fundoPai).toHaveAttribute('inert');
    expect(fundoFilho).not.toHaveAttribute('inert');
  });

  test('arrastar de dentro e soltar no fundo NÃO fecha', () => {
    const onClose = vi.fn();
    render(<Formulario onClose={onClose} closeOnBackdrop />);
    const campo = screen.getByLabelText('Nome');
    const fundo = screen.getByRole('dialog').parentElement;

    // Seleção de texto começando no campo e terminando fora do diálogo.
    ponteiro(campo, 'pointerdown', 400, 300);
    ponteiro(fundo, 'pointerup', 40, 90);

    expect(onClose).not.toHaveBeenCalled();
  });

  test('descer e soltar no fundo longe do ponto de partida também não fecha', () => {
    const onClose = vi.fn();
    render(<Formulario onClose={onClose} closeOnBackdrop />);
    const fundo = screen.getByRole('dialog').parentElement;

    ponteiro(fundo, 'pointerdown', 40, 90);
    ponteiro(fundo, 'pointerup', 300, 90);

    expect(onClose).not.toHaveBeenCalled();
  });

  test('clique de verdade no fundo fecha quando é permitido', () => {
    const onClose = vi.fn();
    render(<Formulario onClose={onClose} closeOnBackdrop />);
    const fundo = screen.getByRole('dialog').parentElement;

    ponteiro(fundo, 'pointerdown', 40, 90);
    ponteiro(fundo, 'pointerup', 42, 91);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('formulário não fecha por clique no fundo (é o padrão)', () => {
    const onClose = vi.fn();
    render(<Formulario onClose={onClose} />);
    const fundo = screen.getByRole('dialog').parentElement;

    ponteiro(fundo, 'pointerdown', 40, 90);
    ponteiro(fundo, 'pointerup', 40, 90);

    expect(onClose).not.toHaveBeenCalled();
  });

  test('confirmação não fecha por clique no fundo', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open message="Excluir?" danger onConfirm={() => {}} onCancel={onCancel} />);
    const fundo = screen.getByRole('alertdialog').parentElement;

    ponteiro(fundo, 'pointerdown', 40, 90);
    ponteiro(fundo, 'pointerup', 40, 90);

    expect(onCancel).not.toHaveBeenCalled();
  });

  test('o corpo é o único eixo de rolagem: cabeçalho e rodapé ficam fora dele', () => {
    const { container } = render(<Formulario />);
    const painel = screen.getByRole('dialog');
    const corpo = painel.querySelector('.dw-dialog-body');
    const rodape = painel.querySelector('.dw-dialog-footer');
    const cabecalho = painel.querySelector('.dw-dialog-heading');

    expect(corpo).toBeTruthy();
    expect(corpo.contains(rodape)).toBe(false);
    expect(corpo.contains(cabecalho)).toBe(false);
    expect(painel.querySelectorAll('.dw-dialog-body')).toHaveLength(1);
    expect(container).toBeTruthy();
  });

  test('o botão fechar é acessível e o diálogo fecha por ele', async () => {
    const onClose = vi.fn();
    render(<Formulario onClose={onClose} />);
    const fechar = screen.getByRole('button', { name: 'Fechar' });
    expect(fechar).toHaveAttribute('data-dialog-close');

    await userEvent.click(fechar);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('o rodapé segue a ordem [secundária][primária]', () => {
    render(<Formulario />);
    const rodape = screen.getByRole('dialog').querySelector('.dw-dialog-footer');
    const nomes = [...within(rodape).getAllByRole('button')].map((b) => b.textContent);
    expect(nomes).toEqual(['Cancelar', 'Salvar']);
  });
});
