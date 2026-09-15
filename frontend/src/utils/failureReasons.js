// Traduz os códigos de erro mais comuns que a Meta manda quando uma mensagem
// falha (marketing fora da janela de 24h, template pausado, etc.) para uma
// frase que o atendente entenda sem precisar procurar o número no Google. O
// backend já grava o motivo como "(código) texto original da Meta" - aqui só
// extraímos o código do prefixo "(NNNN)" e, se for um dos conhecidos, trocamos
// pela explicação em português. Qualquer motivo sem prefixo reconhecido (erro
// de rede, mensagem livre) passa direto, sem alteração.
const EXPLICACOES_POR_CODIGO = {
  131047: 'Fora da janela de 24 h: só é possível mandar template aprovado',
  131049: 'A Meta limitou mensagens de marketing para este contato (baixo engajamento). Tente um template de utilidade ou espere o cliente responder',
  131026: 'Número não recebe mensagens (não tem WhatsApp, bloqueou a empresa ou está indisponível)',
  131051: 'Tipo de mensagem não suportado pelo canal',
  132001: 'Template não encontrado na Meta com esse nome/idioma',
  132015: 'Template pausado pela Meta',
  132016: 'Template desativado pela Meta',
  131042: 'Problema de pagamento na conta da Meta',
  130472: 'Contato faz parte de um experimento da Meta e não recebe marketing',
};

const CODIGO_NO_INICIO = /^\((\d+)\)/;

export function descreverFalha(motivo) {
  if (!motivo) return null;
  const match = motivo.match(CODIGO_NO_INICIO);
  if (!match) return motivo;
  const explicacao = EXPLICACOES_POR_CODIGO[match[1]];
  if (!explicacao) return motivo;
  return `${explicacao} (código ${match[1]})`;
}
