import { createElement, useCallback, useRef, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  setChannelTriageEnabled,
  setChannelWabaId,
  reconnectChannel,
  setChannelHidden,
  deleteChannel,
  setChannelAiEnabled,
  setChannelAiTriageEnabled,
  setChannelAiNightModeEnabled,
  setMetaCloudCredentials,
  setChannelName,
} from '../../../services/api';
import { mensagemDoCanal, exclusaoRecusada } from './mensagensDoCanal';
import { ConfirmacaoDoCanal } from './ConfirmacaoDoCanal';

// As ações sobre um canal, na lista e no detalhe (Fatia S2).
//
// Antes, a confirmação fechava na hora e a ação corria depois: a falha (um
// 409 ao excluir, por exemplo) aparecia longe, no topo da página, e o cartão
// não mostrava nada enquanto isso. Agora:
//
// - excluir, ocultar, reexibir e reconectar um canal conectado pedem
//   confirmação, e a confirmação ESPERA a resposta: fica aberta, com o botão
//   dizendo o que acontece ("Excluindo…"), sem Cancelar, Esc ou clique fora, e
//   sem segundo envio. Deu errado → o motivo aparece nela mesma;
// - a exclusão recusada (o canal tem atendimentos ou integração SGP) oferece
//   "Ocultar em vez de excluir", que é o caminho que o próprio backend indica;
// - reconectar um canal que não está conectado não pergunta nada (como
//   antes); o andamento e o erro ficam no cartão de onde saiu a ação;
// - o cartão mostra o andamento ("Ocultando canal…") durante a ação;
// - no fim, quem usa decide o sucesso (aviso na lista, volta para a lista
//   depois de excluir no detalhe) por `aoConcluir(tipo, canal)`.
//
// As APIs, os métodos e os payloads são os de antes. A ordem do "um robô por
// vez" (IA primeiro, depois desliga a triagem) também.
const ANDAMENTO = {
  excluir: 'Excluindo canal…',
  ocultar: 'Ocultando canal…',
  reexibir: 'Reexibindo canal…',
  reconectar: 'Reconectando…',
};

const PADRAO = {
  excluir: 'Não foi possível excluir o canal. Tente novamente.',
  ocultar: 'Não foi possível ocultar o canal. Tente novamente.',
  reexibir: 'Não foi possível reexibir o canal. Tente novamente.',
  reconectar: 'Não foi possível reconectar o canal. Tente novamente.',
};

const RECUSA_DE_EXCLUSAO =
  'Este canal já tem atendimentos ou uma integração SGP e não pode ser excluído sem perder esse histórico. Oculte o canal para tirá-lo da lista.';

function falhaSegura(erro, padrao) {
  return Object.assign(new Error(mensagemDoCanal(erro, padrao)), { causa: erro });
}

export function useChannelActions(refresh, { aoConcluir } = {}) {
  const { token } = useAuth();
  const [confirmacao, setConfirmacao] = useState(null);
  const [pendentes, setPendentes] = useState({});
  const [erros, setErros] = useState({});
  const emCurso = useRef(false);

  const chamar = useCallback(
    (tipo, canal) => {
      if (tipo === 'excluir') return deleteChannel(canal.id, token);
      if (tipo === 'ocultar') return setChannelHidden(canal.id, true, token);
      if (tipo === 'reexibir') return setChannelHidden(canal.id, false, token);
      return reconnectChannel(canal.id, token);
    },
    [token]
  );

  function marcar(canal, tipo) {
    setPendentes((atual) => ({ ...atual, [canal.id]: ANDAMENTO[tipo] }));
  }
  function desmarcar(canal) {
    setPendentes((atual) => {
      const { [canal.id]: _fora, ...resto } = atual;
      return resto;
    });
  }
  function limparErro(id) {
    setErros((atual) => {
      const { [id]: _fora, ...resto } = atual;
      return resto;
    });
  }

  async function concluir(tipo, canal) {
    if (refresh) await refresh();
    if (aoConcluir) aoConcluir(tipo, canal);
  }

  // Ação sem confirmação: andamento e erro no cartão de origem.
  async function executarDireto(tipo, canal) {
    if (pendentes[canal.id]) return;
    limparErro(canal.id);
    marcar(canal, tipo);
    try {
      await chamar(tipo, canal);
      desmarcar(canal);
      await concluir(tipo, canal);
    } catch (erro) {
      desmarcar(canal);
      setErros((atual) => ({
        ...atual,
        [canal.id]: { mensagem: mensagemDoCanal(erro, PADRAO[tipo]), repetir: () => executarDireto(tipo, canal) },
      }));
    }
  }

  function pedir(tipo, canal) {
    if (pendentes[canal.id] || confirmacao) return;
    limparErro(canal.id);
    if (tipo === 'reconectar' && canal.status !== 'connected') {
      executarDireto(tipo, canal);
      return;
    }
    setConfirmacao({ tipo, canal, ocupado: false, erro: null, recusada: false, emAndamento: tipo });
  }

  async function confirmar(tipoDaAcao) {
    const atual = confirmacao;
    if (!atual || emCurso.current) return;
    const tipo = tipoDaAcao || atual.tipo;
    emCurso.current = true;
    setConfirmacao({ ...atual, ocupado: true, erro: null, emAndamento: tipo });
    marcar(atual.canal, tipo);
    try {
      await chamar(tipo, atual.canal);
      emCurso.current = false;
      desmarcar(atual.canal);
      setConfirmacao(null);
      await concluir(tipo, atual.canal);
    } catch (erro) {
      emCurso.current = false;
      desmarcar(atual.canal);
      const recusada = tipo === 'excluir' && exclusaoRecusada(erro);
      setConfirmacao({
        ...atual,
        ocupado: false,
        recusada: atual.recusada || recusada,
        emAndamento: tipo,
        erro: recusada ? RECUSA_DE_EXCLUSAO : mensagemDoCanal(erro, PADRAO[tipo]),
      });
    }
  }

  function cancelar() {
    if (emCurso.current) return;
    setConfirmacao(null);
  }

  // ---- Atendimento, identificação e credenciais ----
  // Cada uma devolve uma promessa que falha com a mensagem segura: quem chama
  // (o interruptor, o editor do nome, o diálogo das credenciais) mostra o erro
  // junto de si e restaura o que precisar.
  async function comRecarga(fazer, padrao, { recarregarSempre = false } = {}) {
    try {
      await fazer();
    } catch (erro) {
      if (recarregarSempre && refresh) await refresh();
      throw falhaSegura(erro, padrao);
    }
    if (refresh) await refresh();
  }

  const definirTriagem = (id, ligado) =>
    comRecarga(() => setChannelTriageEnabled(id, ligado, token), 'Não foi possível salvar a triagem por menu. Tente novamente.');

  // Um robô por vez: ligar a IA num canal desliga a triagem dele na mesma
  // ação. A IA é ligada primeiro — se a segunda chamada falhar, o canal fica
  // com a IA respondendo e a triagem ainda marcada no banco, o que é seguro (o
  // backend já para de iniciar a triagem quando a IA está ligada). A releitura
  // roda também na falha, para a tela mostrar o estado real junto do erro.
  const definirIa = (id, ligado) =>
    comRecarga(
      async () => {
        await setChannelAiEnabled(id, ligado, token);
        if (ligado) await setChannelTriageEnabled(id, false, token);
      },
      'Não foi possível salvar o atendimento com IA. Tente novamente.',
      { recarregarSempre: true }
    );

  const definirTriagemIa = (id, ligado) =>
    comRecarga(() => setChannelAiTriageEnabled(id, ligado, token), 'Não foi possível salvar a triagem com IA. Tente novamente.');

  const definirNoturno = (id, ligado) =>
    comRecarga(() => setChannelAiNightModeEnabled(id, ligado, token), 'Não foi possível salvar o atendimento noturno. Tente novamente.');

  const salvarNome = (id, nome) => comRecarga(() => setChannelName(id, nome, token), 'Não foi possível salvar o nome. Tente novamente.');

  const salvarWaba = (id, valor) => comRecarga(() => setChannelWabaId(id, valor, token), 'Não foi possível salvar o WABA ID. Tente novamente.');

  // O motivo que a Meta deu chega em português (conferência do backend) e
  // aparece no próprio diálogo. A releitura só roda no sucesso.
  async function salvarCredenciaisMeta(id, credenciais) {
    let canal;
    try {
      canal = await setMetaCloudCredentials(id, credenciais, token);
    } catch (erro) {
      throw falhaSegura(erro, 'Não foi possível salvar as credenciais. Confira os dados e tente novamente.');
    }
    if (refresh) await refresh();
    return canal;
  }

  const dialogo = confirmacao
    ? createElement(ConfirmacaoDoCanal, {
        tipo: confirmacao.tipo,
        canal: confirmacao.canal,
        ocupado: confirmacao.ocupado,
        emAndamento: confirmacao.emAndamento,
        erro: confirmacao.erro,
        recusada: confirmacao.recusada,
        onConfirmar: () => confirmar(),
        onOcultarEmVez: () => confirmar('ocultar'),
        onCancelar: cancelar,
      })
    : null;

  return {
    pedir,
    pendentes,
    erros,
    limparErro,
    dialogo,
    definirTriagem,
    definirIa,
    definirTriagemIa,
    definirNoturno,
    salvarNome,
    salvarWaba,
    salvarCredenciaisMeta,
  };
}
