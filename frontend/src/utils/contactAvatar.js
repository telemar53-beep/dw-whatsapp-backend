// Aplica o evento `contact:avatar-updated` (foto do contato trocada/removida no
// WhatsApp) a uma lista de conversas: toda conversa daquele contato passa a
// apontar para o novo arquivo, sem precisar recarregar a lista.
export function applyContactAvatarUpdate(list, { contactId, avatarPath }) {
  if (!contactId || !list.some((c) => c.contactId === contactId && c.contactAvatarPath !== avatarPath)) {
    return list;
  }
  return list.map((c) => (c.contactId === contactId ? { ...c, contactAvatarPath: avatarPath } : c));
}
