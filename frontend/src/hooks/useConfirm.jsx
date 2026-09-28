import { useState, useCallback, useRef } from 'react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
// A folha clara vem com o hook, e não com o componente: o barril ui/index.js
// exporta a Confirmação e o Aviso, e o CSS importado por eles entraria no CSS
// de entrada (o do Login) por efeito colateral do barril.
import '../components/ui/dialogo-claro.css';
import { descreverErro } from '../utils/errorMessages';

// `confirm(mensagem, opções)` devolve uma Promise: true se confirmou, false se
// desistiu. Opções: `title`, `danger`, `confirmLabel`, `cancelLabel`.
//
// Com `acao` (uma função que devolve Promise), a confirmação ESPERA a resposta
// antes de fechar (A4-4): o botão vira `busyLabel`, as saídas ficam presas e o
// segundo clique não conta. Deu certo → fecha e resolve true. Falhou → o erro
// (em português, por descreverErro, com `erroPadrao` quando o servidor não
// diz nada) aparece no diálogo, que continua aberto para tentar de novo ou
// cancelar. Antes, "Finalizar sem motivo" fechava antes do resultado e a falha
// sumia calada.
export function useConfirm() {
  const [state, setState] = useState(null);
  const resolver = useRef(null);
  const emCurso = useRef(false);

  const confirm = useCallback((message, options = {}) => {
    // Se já há uma confirmação pendente, resolve false imediatamente sem alterar o diálogo aberto
    if (resolver.current) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      resolver.current = resolve;
      setState({ message, ...options, ocupado: false, erro: null });
    });
  }, []);

  function settle(value) {
    const resolve = resolver.current;
    resolver.current = null;
    emCurso.current = false;
    setState(null);
    if (resolve) resolve(value);
  }

  async function confirmar() {
    const atual = state;
    if (!atual || emCurso.current) return;
    if (!atual.acao) {
      settle(true);
      return;
    }
    emCurso.current = true;
    setState((s) => s && { ...s, ocupado: true, erro: null });
    try {
      await atual.acao();
      settle(true);
    } catch (err) {
      emCurso.current = false;
      setState((s) => s && { ...s, ocupado: false, erro: descreverErro(err, atual.erroPadrao || 'Não foi possível concluir. Tente de novo.') });
    }
  }

  function cancelar() {
    if (emCurso.current) return;
    settle(false);
  }

  const confirmDialog = (
    <ConfirmDialog
      open={Boolean(state)}
      title={state?.title}
      message={state?.message}
      danger={state?.danger}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      busyLabel={state?.busyLabel}
      ocupado={Boolean(state?.ocupado)}
      erro={state?.erro}
      onConfirm={confirmar}
      onCancel={cancelar}
    />
  );

  return { confirm, confirmDialog };
}
