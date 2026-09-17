import { useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { useConfirm } from '../../../hooks/useConfirm';
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
} from '../../../services/api';

const EMPTY_ERRORS = { triage: null, ai: null, aiTriage: null, aiNightMode: null, wabaId: null, action: null };

// Handlers vindos de AdminChannelsPage.jsx (Tasks 1-16), sem alteração de
// lógica: só o estado virou um objeto único (`errors`) e os `window.confirm`
// viraram `useConfirm`, para que a tela de detalhe use o mesmo ConfirmDialog
// das outras páginas de Configurações em vez do confirm() nativo do browser.
export function useChannelActions(refresh) {
  const { token } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [errors, setErrors] = useState(EMPTY_ERRORS);
  const [busyChannelId, setBusyChannelId] = useState(null);

  function setFieldError(field, value) {
    setErrors((prev) => ({ ...prev, [field]: value }));
  }

  async function runChannelAction(channel, action) {
    setFieldError('action', null);
    setBusyChannelId(channel.id);
    try {
      await action();
      refresh();
    } catch (err) {
      setFieldError('action', (err.body && err.body.error) || 'Não foi possível concluir a ação neste canal');
    } finally {
      setBusyChannelId(null);
    }
  }

  async function reconnect(channel) {
    if (channel.status === 'connected') {
      const ok = await confirm(
        `O canal "${channel.name}" está conectado. Reconectar vai derrubar a sessão atual e pedir um QR code novo. Continuar?`,
        { danger: true, confirmLabel: 'Continuar' }
      );
      if (!ok) return;
    }
    runChannelAction(channel, () => reconnectChannel(channel.id, token));
  }

  async function toggleHidden(channel) {
    const nextHidden = !channel.hidden;
    const message = nextHidden
      ? `Ocultar o canal "${channel.name}"? Ele sai da lista e a sessão do WhatsApp é encerrada. O histórico é preservado.`
      : `Reexibir o canal "${channel.name}"?`;
    const ok = await confirm(message, { danger: true, confirmLabel: nextHidden ? 'Ocultar' : 'Reexibir' });
    if (!ok) return;
    runChannelAction(channel, () => setChannelHidden(channel.id, nextHidden, token));
  }

  async function remove(channel) {
    const ok = await confirm(
      `Excluir o canal "${channel.name}" definitivamente? Só é possível se ele nunca teve conversas.`,
      { danger: true, confirmLabel: 'Excluir' }
    );
    if (!ok) return;
    runChannelAction(channel, () => deleteChannel(channel.id, token));
  }

  async function toggleTriage(channelId, triageEnabled) {
    setFieldError('triage', null);
    try {
      await setChannelTriageEnabled(channelId, triageEnabled, token);
      refresh();
    } catch (err) {
      setFieldError('triage', (err.body && err.body.error) || 'Falha ao atualizar a triagem deste canal');
    }
  }

  // Um robô por vez: ligar a IA num canal desliga a triagem dele na mesma
  // ação. A IA é ligada primeiro — se a segunda chamada falhar, o canal fica
  // com a IA respondendo e a triagem ainda marcada no banco, o que é seguro
  // (o backend já para de iniciar a triagem quando a IA está ligada); a ordem
  // inversa arriscaria deixar o canal sem nenhum robô caso a chamada da IA
  // falhasse. O refresh() roda sempre (sucesso ou falha) para que, se a
  // segunda chamada falhar, a tela pare de mostrar o estado antigo (anterior
  // ao clique) e passe a mostrar o estado real do canal junto com o erro —
  // sem isso o admin veria a tela como se nada tivesse mudado.
  async function toggleAi(channelId, aiEnabled) {
    setFieldError('ai', null);
    try {
      await setChannelAiEnabled(channelId, aiEnabled, token);
      if (aiEnabled) {
        await setChannelTriageEnabled(channelId, false, token);
      }
    } catch (err) {
      setFieldError('ai', (err.body && err.body.error) || 'Falha ao atualizar a IA deste canal');
    } finally {
      refresh();
    }
  }

  async function toggleAiTriage(channelId, aiTriageEnabled) {
    setFieldError('aiTriage', null);
    try {
      await setChannelAiTriageEnabled(channelId, aiTriageEnabled, token);
      refresh();
    } catch (err) {
      setFieldError('aiTriage', (err.body && err.body.error) || 'Falha ao atualizar a triagem com IA deste canal');
    }
  }

  async function toggleAiNightMode(channelId, aiNightModeEnabled) {
    setFieldError('aiNightMode', null);
    try {
      await setChannelAiNightModeEnabled(channelId, aiNightModeEnabled, token);
      refresh();
    } catch (err) {
      setFieldError('aiNightMode', (err.body && err.body.error) || 'Falha ao atualizar o atendimento noturno deste canal');
    }
  }

  async function saveWabaId(channelId, value) {
    setFieldError('wabaId', null);
    try {
      await setChannelWabaId(channelId, value, token);
      refresh();
    } catch (err) {
      setFieldError('wabaId', (err.body && err.body.error) || 'Falha ao atualizar o WABA ID');
    }
  }

  // Sem try/catch de proposito: o erro tem que chegar ao formulário da
  // migração, que mostra o motivo que a Meta deu ao lado dos campos. O refresh
  // só roda no sucesso, senão a tela recarregaria como se algo tivesse mudado.
  async function saveMetaCloudCredentials(channelId, credentials) {
    const channel = await setMetaCloudCredentials(channelId, credentials, token);
    refresh();
    return channel;
  }

  return {
    errors,
    busyChannelId,
    saveMetaCloudCredentials,
    toggleTriage,
    toggleAi,
    toggleAiTriage,
    toggleAiNightMode,
    saveWabaId,
    reconnect,
    toggleHidden,
    remove,
    confirmDialog,
  };
}
