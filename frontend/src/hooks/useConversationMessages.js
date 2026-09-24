import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { getMessages, sendMessage as apiSendMessage } from '../services/api';

/**
 * Quantas mensagens a conversa abre mostrando.
 *
 * 50 cobre três a quatro telas de rolagem para trás, que é mais do que a
 * imensa maioria dos atendimentos ativos usa, e corta o caso que motivou a
 * mudança: a consulta não tinha limite, então abrir uma conversa antiga trazia
 * o histórico inteiro — medido em 12 nós de DOM por mensagem, 12.074 nós numa
 * conversa de mil.
 *
 * Não é número mágico: é o teto de "quanto o atendente lê sem pedir". Quem
 * precisa de mais clica uma vez.
 */
const POR_PAGINA = 50;

export function useConversationMessages(conversationId) {
  const { token } = useAuth();
  const socket = useSocket();
  const [messages, setMessages] = useState([]);
  // Antes a falha era engolida (`.catch(() => {})`) e a conversa abria vazia:
  // não dava para saber se o cliente não tinha falado nada ou se o histórico
  // não carregou. `status` separa os dois casos e habilita o "Tentar de novo".
  const [status, setStatus] = useState('ready');
  const [reloadToken, setReloadToken] = useState(0);
  const [temAnteriores, setTemAnteriores] = useState(false);
  const [carregandoAnteriores, setCarregandoAnteriores] = useState(false);
  // O hook não remonta ao trocar de conversa: a resposta de um pedido feito em
  // A pode voltar com B na tela. Quem responde depois de um await confere a
  // conversa aberta (envio) ou a abertura da lista (anteriores) antes de mexer
  // no estado.
  const conversaAbertaRef = useRef(conversationId);
  const aberturaRef = useRef(0);

  useEffect(() => {
    conversaAbertaRef.current = conversationId;
    aberturaRef.current += 1;
    setMessages([]);
    setTemAnteriores(false);
    setCarregandoAnteriores(false);
    if (!conversationId || !token) {
      setStatus('ready');
      return undefined;
    }
    // Trocar de conversa durante o carregamento não pode deixar a resposta
    // antiga sobrescrever a nova, nem marcar erro na conversa errada.
    let cancelado = false;
    setStatus('loading');
    // Pede UMA a mais do que vai mostrar. Se ela vier, existe trecho anterior —
    // e isso se descobre sem mudar o formato da resposta (que continua um
    // array), sem cabeçalho novo e sem uma requisição só para perguntar.
    getMessages(conversationId, token, { limit: POR_PAGINA + 1 })
      .then((lista) => {
        if (cancelado) return;
        const sobrou = lista.length > POR_PAGINA;
        // A extra é a mais ANTIGA do lote, porque a lista vem em ordem
        // crescente: descartar do começo é o que mantém as 50 mais novas.
        const historico = sobrou ? lista.slice(1) : lista;
        // Mesclar, e não substituir: o que chegou pelo socket (ou foi enviado)
        // com a carga no ar entrou na lista vazia da abertura. Se a consulta
        // rodou antes de essa mensagem ser gravada, substituir a apagava da
        // tela até reabrir a conversa. Ela é mais nova que o histórico: vai
        // depois dele.
        setMessages((naTela) => {
          const trouxe = new Set(historico.map((m) => m.id));
          return [...historico, ...naTela.filter((m) => !trouxe.has(m.id))];
        });
        setTemAnteriores(sobrou);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelado) return;
        setStatus('error');
      });
    return () => {
      cancelado = true;
    };
  }, [conversationId, token, reloadToken]);

  const reloadMessages = useCallback(() => setReloadToken((valor) => valor + 1), []);

  // Botão, e não rolagem infinita. Prepender mensagens enquanto o usuário rola
  // para cima exige recolocar a posição de scroll a cada lote, e errar isso faz
  // a timeline pular na mão de quem está lendo — num chat, esse é o defeito que
  // mais irrita. O botão também não briga com o scroll até o fim já homologado
  // na abertura da conversa.
  const carregarAnteriores = useCallback(() => {
    // O cursor sai da lista do render em que o botão foi clicado — a que está
    // na tela. Ele era lido de dentro de um updater de setMessages logo depois
    // de setCarregandoAnteriores(true): com atualização pendente na fibra, o
    // React 18 não roda o updater na hora, o cursor saía undefined e o pedido
    // repetia o da abertura (?limit=51).
    const cursor = messages[0] && messages[0].id;
    if (!conversationId || !token || !cursor) return Promise.resolve();
    const abertura = aberturaRef.current;
    setCarregandoAnteriores(true);
    return getMessages(conversationId, token, { limit: POR_PAGINA + 1, before: cursor })
      .then((lista) => {
        // Trocou de conversa, ou esta foi reaberta, no meio do pedido: o trecho
        // pertence a uma lista que não está mais na tela.
        if (aberturaRef.current !== abertura) return;
        const sobrou = lista.length > POR_PAGINA;
        const trecho = sobrou ? lista.slice(1) : lista;
        // Pelo id: um lote que se sobreponha ao que já está na tela — mensagem
        // nova chegando durante a busca, cursor repetido — não pode duplicar
        // bolha.
        setMessages((prev) => {
          const conhecidos = new Set(prev.map((m) => m.id));
          return [...trecho.filter((m) => !conhecidos.has(m.id)), ...prev];
        });
        setTemAnteriores(sobrou);
      })
      .catch(() => {
        // Falhar aqui não pode apagar o que já está na tela: o histórico
        // continua lendo-se normalmente, e o botão segue disponível.
      })
      .finally(() => {
        if (aberturaRef.current === abertura) setCarregandoAnteriores(false);
      });
  }, [conversationId, token, messages]);

  useEffect(() => {
    if (!socket || !conversationId) return undefined;

    // A mesma mensagem pode chegar duas vezes (o envio pelo GET e o
    // message:new do servidor; queue:new e message:new): pelo id, a segunda
    // só completa a primeira em vez de duplicar a bolha.
    function acrescentar(message) {
      setMessages((prev) => (prev.some((m) => m.id === message.id)
        ? prev.map((m) => (m.id === message.id ? { ...m, ...message } : m))
        : [...prev, message]));
    }

    function onNew({ conversation, message }) {
      if (conversation.id !== conversationId) return;
      acrescentar(message);
    }

    // Em Automação/Espera (sem atendente) a mensagem do cliente chega só como
    // queue:new (teste real 2026-09-15: a lista atualizava e o som tocava, mas
    // a conversa aberta só mostrava a bolha no F5).
    function onQueueNew({ conversation, message }) {
      if (!message || !conversation || conversation.id !== conversationId) return;
      acrescentar(message);
    }

    function onUpdated({ conversationId: updatedId, message }) {
      if (updatedId !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, ...message } : m)));
    }

    function onTranscription({ conversationId: msgConversationId, messageId, transcription, transcriptionStatus, transcriptionDetail }) {
      if (msgConversationId !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, transcription, transcriptionStatus, transcriptionDetail } : m
        )
      );
    }

    socket.on('message:new', onNew);
    socket.on('queue:new', onQueueNew);
    socket.on('message:updated', onUpdated);
    socket.on('message:transcription', onTranscription);
    return () => {
      socket.off('message:new', onNew);
      socket.off('queue:new', onQueueNew);
      socket.off('message:updated', onUpdated);
      socket.off('message:transcription', onTranscription);
    };
  }, [socket, conversationId]);

  // Quem chama depois de um await (os envios do SGP no ConversationView) pode
  // estar entregando a mensagem de uma conversa que já saiu da tela. Toda
  // mensagem da API traz conversationId; a de outra conversa não entra aqui.
  const appendMessage = useCallback((message) => {
    if (message && message.conversationId && message.conversationId !== conversaAbertaRef.current) return;
    setMessages((prev) => [...prev, message]);
  }, []);

  const sendMessage = useCallback(
    async (content, file, repliedToMessageId, isVoiceNote) => {
      const created = await apiSendMessage(conversationId, content, token, file, repliedToMessageId, isVoiceNote);
      // Continua enviada para a conversa em que o envio começou; só não vira
      // bolha na que estiver aberta agora, se o atendente trocou no meio.
      if (conversaAbertaRef.current === conversationId) appendMessage(created);
      return created;
    },
    [conversationId, token, appendMessage]
  );

  return {
    messages,
    status,
    reloadMessages,
    sendMessage,
    appendMessage,
    temAnteriores,
    carregandoAnteriores,
    carregarAnteriores,
  };
}
