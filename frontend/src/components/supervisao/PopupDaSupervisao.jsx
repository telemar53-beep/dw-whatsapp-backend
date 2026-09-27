import { memo } from 'react';
import ConversationModal from '../ConversationModal';

// O popup de sempre (ConversationModal), sem mudança nenhuma, só com memo e
// chegando sob demanda: este módulo é o ponto de corte do `lazy` na página,
// e com ele vêm a conversa, o compositor e os painéis — nada disso é baixado
// por quem só olha a fila.
//
// memo com comparação rasa: a página passa a conversa com a mesma referência
// enquanto o evento for de outra conversa, e callbacks estáveis. É a mesma
// fronteira do A2 da mesa (ConversaAbertaDaMesa), no nível do popup.
export default memo(ConversationModal);
