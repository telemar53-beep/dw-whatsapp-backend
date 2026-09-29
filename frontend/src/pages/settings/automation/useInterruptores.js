import { useCallback, useEffect, useRef, useState } from 'react';
import { descreverErro } from '../../../utils/errorMessages';

// Interruptores que gravam na hora — Ações permitidas à IA e "Sugerir respostas
// ao atendente" (Fatia S0, 29/09/2026). Antes, o clique chamava a API sem
// tratar a resposta: uma falha não aparecia em lugar nenhum e virava rejeição
// não tratada, e dois cliques seguidos mandavam dois pedidos.
//
// Por controle (a chave):
//   - enquanto grava, o controle mostra o valor pedido, "Salvando…", e um novo
//     clique no MESMO controle não sai (controles diferentes seguem livres);
//   - se falha, o controle volta ao valor de antes e o erro fica disponível com
//     o valor que se tentou, para "Tentar novamente";
//   - se grava, o valor confirmado pelo servidor passa a valer sobre a lista:
//     uma releitura pedida antes e respondida depois (com o valor velho) não
//     desfaz a mudança na tela.
//
// O pedido em si (endpoint e corpo) é de quem chama — este hook não conhece
// nenhum dos dois.
export function useInterruptores() {
  const [estados, setEstados] = useState({});
  const emCurso = useRef(new Set());
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const atualizar = useCallback((chave, parcial) => {
    setEstados((atual) => ({ ...atual, [chave]: { ...atual[chave], ...parcial } }));
  }, []);

  // Devolve true só quando gravou; false quando o pedido não saiu (já havia um
  // a caminho) ou falhou.
  const alternar = useCallback(async (chave, novoValor, gravar) => {
    if (emCurso.current.has(chave)) return false;
    emCurso.current.add(chave);
    atualizar(chave, { pendente: novoValor, erro: null, tentado: undefined });
    try {
      await gravar(novoValor);
      if (montado.current) atualizar(chave, { pendente: undefined, confirmado: novoValor });
      return true;
    } catch (erro) {
      if (montado.current) {
        atualizar(chave, {
          pendente: undefined,
          erro: descreverErro(erro, 'Não foi possível salvar.'),
          tentado: novoValor,
        });
      }
      return false;
    } finally {
      emCurso.current.delete(chave);
    }
  }, [atualizar]);

  function valor(chave, doServidor) {
    const estado = estados[chave];
    if (estado && estado.pendente !== undefined) return estado.pendente;
    if (estado && estado.confirmado !== undefined) return estado.confirmado;
    return doServidor;
  }

  return {
    valor,
    alternar,
    salvando: (chave) => Boolean(estados[chave] && estados[chave].pendente !== undefined),
    erro: (chave) => (estados[chave] && estados[chave].erro) || null,
    tentado: (chave) => (estados[chave] ? estados[chave].tentado : undefined),
  };
}
