import { descreverErro } from '../../../utils/errorMessages';

// Mensagem segura para as telas de canais (S2).
//
// O backend dos canais fala em dois registros: frases em português escritas
// para a tela (a conferência com a Meta, o webhook da 360dialog, a recusa de
// exclusão) e validações técnicas em inglês ("name must be…", "… is
// required"). As primeiras podem chegar à pessoa; as segundas não, porque não
// dizem nada a quem administra o canal.
//
// A ordem: tradução local das validações dos canais; depois a tradução geral
// (descreverErro); e, se ainda sobrar uma frase técnica em inglês, a mensagem
// padrão de quem chamou — que diz o que não deu certo, sem inventar causa.
const LOCAIS = {
  'type, name and phoneNumber are required': 'Preencha o nome do canal e o telefone.',
  'phoneNumberId, accessToken and wabaId are required for meta_cloud channels': 'Preencha Phone Number ID, WABA ID e Access Token.',
  'apiKey and wabaId are required for 360dialog channels': 'Preencha a API Key e o WABA ID.',
  'type must be meta_cloud, baileys, or 360dialog': 'Escolha um tipo de conexão.',
  'Não foi possível registrar o webhook na 360dialog — confira a API Key':
    'Não foi possível validar a chave da 360dialog. Confira a API Key e tente novamente.',
  'name must be a non-empty string': 'Informe um nome para o canal.',
  'name must be 120 characters or fewer': 'Use no máximo 120 caracteres no nome do canal.',
  'wabaId must be a non-empty string': 'Informe o identificador da conta (WABA).',
  'aiTriageEnabled requires aiEnabled': 'Ligue o Atendimento com IA antes da Triagem com IA.',
  'aiNightModeEnabled requires aiTriageEnabled': 'Ligue a Triagem com IA antes do Atendimento noturno.',
  'aiNightModeEnabled requires the night window (nightStartTime/nightEndTime) in the AI triage config':
    'Defina a janela noturna em IA e automações › Atendimento noturno antes de ligar.',
};

const TECNICA_EM_INGLES = /\b(must|required|is|are|not|only|cannot|invalid|failed|should|requires|found)\b/i;

function textoDoServidor(erro) {
  const corpo = erro && erro.body;
  if (corpo && typeof corpo.error === 'string') return corpo.error;
  return null;
}

export function mensagemDoCanal(erro, padrao) {
  const bruta = textoDoServidor(erro);
  if (bruta && LOCAIS[bruta]) return LOCAIS[bruta];
  const traduzida = descreverErro(erro, padrao);
  if (bruta && traduzida === bruta && /^[\x20-\x7E]+$/.test(bruta) && TECNICA_EM_INGLES.test(bruta)) return padrao;
  return traduzida || padrao;
}

// A recusa de exclusão (409): o canal tem atendimentos ou integração SGP. Quem
// pergunta é a confirmação, que troca a saída por "Ocultar em vez de excluir".
export function exclusaoRecusada(erro) {
  return Boolean(erro && erro.status === 409);
}
