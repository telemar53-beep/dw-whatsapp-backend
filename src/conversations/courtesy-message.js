// "Ótimo dia para você também", "obrigado", um joinha: mensagens de cortesia
// que o cliente manda DEPOIS de a IA encerrar o atendimento. Teste real
// (2026-09-13): a resposta educada do cliente chegou numa conversa já
// fechada, virou atendimento novo, e a triagem — sem ter o que fazer —
// encaminhou para o Suporte. Este módulo é só a classificação; quem decide o
// que fazer com ela é inbound-message.service.js.

// Palavras que sozinhas (ou combinadas entre si) fazem uma mensagem de
// cortesia. Normalizadas: minúsculas, sem acento.
const CORTESIA = new Set([
  'obrigado', 'obrigada', 'obrigados', 'obrigadas', 'brigado', 'brigada', 'obg', 'obgd', 'vlw', 'valeu',
  'ok', 'okay', 'okk', 'blz', 'beleza', 'certo', 'certinho', 'show', 'top', 'perfeito', 'otimo', 'otima',
  'entendi', 'entendido', 'combinado', 'fechado', 'fechou', 'tmj', 'joia', 'joinha', 'massa', 'legal',
  'nada', 'imagina', 'igualmente', 'tchau', 'xau', 'abraco', 'abracos', 'abraços', 'bjs', 'beijos', 'beijo',
  'amem', 'deus', 'abencoe', 'graca', 'dia', 'tarde', 'noite', 'bom', 'boa', 'bons', 'boas',
  'tambem', 'tbm', 'tb', 'voce', 'vc', 'vcs', 'voces', 'ate', 'logo', 'mais', 'breve', 'depois',
  'resolvido', 'resolvida', 'recebi', 'recebido', 'recebida', 'chegou', 'deu', 'certo', 'consegui', 'paguei', 'pago', 'pagamento', 'feito', 'feita', 'pronto',
  'agradeco', 'agradecido', 'agradecida', 'gentileza', 'atencao', 'ajuda', 'atendimento', 'parabens', 'sucesso',
]);
// Conectivos e enfeites que podem acompanhar a cortesia sem tirar o sentido.
const ENFEITE = new Set([
  'e', 'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'pra', 'para', 'por', 'pela', 'pelo', 'com', 'em', 'no', 'na',
  'muito', 'muita', 'mto', 'bem', 'tudo', 'ai', 'ta', 'tá', 'esta', 'estar', 'ne', 'viu', 'meu', 'minha', 'seu', 'sua',
  'querido', 'querida', 'amigo', 'amiga', 'moco', 'moca', 'senhor', 'senhora', 'tenha', 'tenham', 'mesmo', 'mesma', 'sim',
  'entao', 'ja', 'agora', 'foi', 'tudo', 'certo', 'isso', 'aqui', 'la', 'que', 'q', 'kk', 'kkk', 'kkkk', 'rs', 'rsrs', 'haha',
  'gente', 'equipe', 'pessoal', 'todos', 'todas', 'vou', 'vamos', 'fazer', 'ir', 'la', 'ver', 'assim',
]);

const MAXIMO_DE_PALAVRAS = 12;

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Emojis e símbolos somem: "👍", "🙏", "❤️" sozinhos viram texto vazio.
    .replace(/\p{Extended_Pictographic}|️|‍/gu, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
}

/**
 * Verdadeiro quando a mensagem é só cortesia: agradecimento, confirmação
 * curta, despedida, "pra você também", emoji/figurinha. Qualquer pergunta,
 * número (protocolo, CPF, valor), texto mais longo ou mídia real (áudio,
 * imagem, documento) NÃO é cortesia — pode ser um pedido novo.
 *
 * nomeDaEmpresa é OPCIONAL: sem ele a função funciona normalmente, só sem
 * reconhecer o nome comercial como enfeite (o produto é vendido para mais de
 * um provedor — nenhuma marca fica escrita no código; quem chama busca o
 * nome no painel, ex. getCompanyConfig().name).
 */
function ehMensagemDeCortesia({ content, messageType, nomeDaEmpresa }) {
  if (messageType === 'sticker') return true;
  if (messageType && messageType !== 'text') return false;
  const bruto = String(content || '');
  if (!bruto.trim()) return false;
  if (bruto.includes('?')) return false;
  const texto = normalizar(bruto);
  // Só emoji (ou só pontuação): cortesia.
  if (!texto) return true;
  if (/\d/.test(texto)) return false;
  const palavras = texto.split(/\s+/);
  if (palavras.length > MAXIMO_DE_PALAVRAS) return false;
  // Palavras do nome da empresa contam como enfeite só nesta checagem — não
  // entram no Set do módulo, que é compartilhado por toda chamada.
  const enfeiteDaEmpresa = new Set(normalizar(nomeDaEmpresa).split(/\s+/).filter(Boolean));
  const temCortesia = palavras.some((p) => CORTESIA.has(p));
  const todasConhecidas = palavras.every((p) => CORTESIA.has(p) || ENFEITE.has(p) || enfeiteDaEmpresa.has(p));
  return temCortesia && todasConhecidas;
}

module.exports = { ehMensagemDeCortesia };
