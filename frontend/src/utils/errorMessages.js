// O backend responde em inglês. Até a Etapa 7 essas frases chegavam cruas à
// tela como mensagem principal: quem errava a senha lia "Invalid credentials",
// quem tentava assumir uma conversa já tomada lia "Conversation already
// assigned or closed". Traduzir na origem seria mexer no backend, que está
// fora de escopo — então a tradução acontece aqui, na borda.
//
// Três regras que esta função não quebra:
//   1. Nunca inventa significado. Só traduz o que está mapeado.
//   2. Sem mapeamento, devolve o texto original — nunca engole o erro.
//   3. O texto técnico continua recuperável por `detalheTecnicoDoErro`, para
//      as telas onde ele ajuda no diagnóstico.

const TRADUCOES = {
  // Autenticação e permissão
  'Invalid credentials': 'E-mail ou senha incorretos.',
  'Account disabled': 'Esta conta está desativada. Procure um administrador.',
  'Current password is incorrect': 'A senha atual está incorreta.',
  'Invalid or expired token': 'Sua sessão expirou. Entre de novo.',
  'Missing authorization token': 'Sua sessão expirou. Entre de novo.',
  'Missing token': 'Sua sessão expirou. Entre de novo.',
  'Insufficient permissions': 'Sua conta não tem permissão para esta ação.',
  'Managers can only create attendant accounts': 'Gerentes só podem criar contas de atendente.',
  'Managers can only manage attendant accounts': 'Gerentes só podem gerenciar contas de atendente.',
  'You cannot deactivate your own account': 'Você não pode desativar a própria conta.',
  'You cannot reset your own password here': 'Troque a sua própria senha pelo "Meu perfil".',
  'Too many requests, please try again later': 'Muitas tentativas seguidas. Espere um pouco e tente de novo.',
  'Internal server error': 'O servidor encontrou um erro. Tente de novo em instantes.',

  // Atendimento
  'Conversation not found': 'Atendimento não encontrado.',
  'Conversation is closed': 'Este atendimento já foi encerrado.',
  'Conversation already assigned or closed': 'Este atendimento já foi assumido por outra pessoa ou já foi encerrado.',
  'Conversation is not currently assigned to you, or is closed': 'Este atendimento não está com você, ou já foi encerrado.',
  'This conversation is not assigned to you': 'Este atendimento não está com você.',
  'Only the assigned agent can act on this conversation': 'Só quem está com o atendimento pode fazer isso.',
  'Only the assigned agent can change the sector': 'Só quem está com o atendimento pode trocar o setor.',
  'Only the assigned agent can send messages on this conversation': 'Só quem está com o atendimento pode enviar mensagens nele.',
  'There is already an open conversation with this contact on this channel': 'Já existe um atendimento aberto com este cliente neste canal.',
  'Invalid or inactive reasonId': 'Esse motivo de contato não existe mais ou foi desativado.',
  'Unknown sectorId': 'Esse setor não existe mais.',
  'Message not found': 'Mensagem não encontrada.',
  'Suggestion not found': 'Essa sugestão da IA não está mais disponível.',
  'Only messages with text can be replied to': 'Só dá para responder mensagens com texto.',
  'This message has not been delivered yet; wait before replying to it':
    'Esta mensagem ainda não foi entregue. Espere a entrega para respondê-la.',

  // Envio e mídia
  'This phone number is not on WhatsApp': 'Este número não tem WhatsApp.',
  'This channel is not connected': 'Este canal não está conectado.',
  'The configured channel is not connected': 'O canal configurado não está conectado.',
  'The configured channel no longer exists': 'O canal configurado não existe mais.',
  'Could not convert this audio to a format WhatsApp accepts':
    'Não foi possível converter este áudio para um formato que o WhatsApp aceita.',
  'Audio and sticker messages cannot include a caption; send the text as a separate message':
    'Áudio e figurinha não aceitam legenda. Mande o texto em uma mensagem separada.',
  'File must be an image (jpeg, png, webp or gif)': 'O arquivo precisa ser uma imagem (JPG, PNG, WEBP ou GIF).',
  'Media not found': 'Este arquivo não está mais disponível.',
  'Avatar not found': 'Esta foto não está mais disponível.',
  'content or file is required': 'Escreva uma mensagem ou anexe um arquivo.',
  'content is required': 'O conteúdo é obrigatório.',
  'content must be a string': 'O conteúdo precisa ser um texto.',

  // Canais
  'Channel not found': 'Canal não encontrado.',
  'Channel not found or not an official channel (meta_cloud or 360dialog)':
    'Canal não encontrado, ou não é um canal oficial (Meta Cloud ou 360dialog).',
  'A channel with this phone number already exists': 'Já existe um canal com este número.',
  'Unsupported channel type': 'Tipo de canal não suportado para esta ação.',
  'Only baileys channels connect through a QR code': 'Só canais Baileys conectam por QR code.',
  'No QR code available for this channel': 'Não há QR code disponível para este canal agora.',
  'apiKey and wabaId are required for 360dialog channels': 'Canais 360dialog precisam de API Key e WABA ID.',

  // Templates
  'Template not found': 'Template não encontrado.',
  'This template is not approved': 'Este template ainda não foi aprovado pela Meta.',
  "This template does not belong to this channel's WABA": 'Este template não pertence à WABA deste canal.',
  'A template with this name and language already exists for this WABA':
    'Já existe um template com este nome e idioma nesta WABA.',
  'Each template variable must be a non-empty string': 'Preencha todas as variáveis do template.',
  'buttons must be a list of texts': 'Os botões precisam ser uma lista de textos.',
  'channelId, name and language are required': 'Informe canal, nome e idioma.',
  'channelId, name, category, language and bodyText are required':
    'Informe canal, nome, categoria, idioma e o texto do template.',

  // Campanhas
  'Campaign not found': 'Campanha não encontrada.',
  'No valid recipient found in the list': 'Nenhum destinatário válido na lista.',

  // SGP
  'Failed to reach SGP': 'Não foi possível falar com o SGP.',
  'SGP integration is not configured': 'A integração com o SGP não está configurada.',
  'SGP integration is not enabled': 'A integração com o SGP está desligada.',
  'Client not found': 'Cliente não encontrado no SGP.',
  'Invalid API key': 'API Key inválida.',
  'barCode is invalid': 'O código de barras é inválido.',
  'boletoLink is required': 'O link do boleto é obrigatório.',
  'cpf is required': 'Informe o CPF.',

  // IA
  'No API key configured': 'Nenhuma chave da OpenAI está configurada.',
  'apiKey is required': 'Informe a chave da API.',
  'Automatic mode is not available yet': 'O modo automático ainda não está disponível.',
  'Tool not found': 'Ferramenta não encontrada.',

  // Cadastros
  'Agent not found': 'Atendente não encontrado.',
  'An agent with this email already exists': 'Já existe um atendente com este e-mail.',
  'Sector not found': 'Setor não encontrado.',
  'Reason not found': 'Motivo não encontrado.',
  'City not found': 'Cidade não encontrada.',
  'Notice not found': 'Aviso não encontrado.',
  'Quick reply not found': 'Resposta rápida não encontrada.',
  'Contact not found': 'Contato não encontrado.',
  'Integration not found': 'Integração não encontrada.',
  'Triage option not found': 'Opção de triagem não encontrada.',
  'An option with this number already exists': 'Já existe uma opção com este número.',

  // Busca da Supervisão
  'No contact found with that phone number': 'Nenhum cliente encontrado com esse telefone.',
  'No conversation found with that protocol number': 'Nenhum atendimento encontrado com esse protocolo.',
};

// O backend monta algumas frases com valor interpolado. A regra captura o
// valor e o recoloca na frase em português — o número continua sendo o do
// servidor, não um número inventado aqui.
const REGRAS = [
  [/^File exceeds the (\d+)MB upload limit$/, (m) => `O arquivo passa do limite de ${m[1]} MB.`],
  [/^File exceeds the (\d+)MB limit for (.+)$/, (m) => `O arquivo passa do limite de ${m[1]} MB para ${m[2]}.`],
  [/^This template requires exactly (\d+) variable\(s\)$/, (m) => `Este template exige exatamente ${m[1]} variável(is).`],
  [/^Template "(.+)" not found for this channel$/, (m) => `O template "${m[1]}" não existe neste canal.`],
  [/^Template "(.+)" requires exactly (\d+) variable/, (m) => `O template "${m[1]}" exige exatamente ${m[2]} variável(is).`],
  [/^Template "(.+)" header type mismatch$/, (m) => `O cabeçalho do template "${m[1]}" não confere.`],
  [/^(\w+) is required$/, (m) => `O campo "${m[1]}" é obrigatório.`],
  [/^(\w+) must be a boolean$/, (m) => `O campo "${m[1]}" precisa ser verdadeiro ou falso.`],
  [/^(\w+) must be an array$/, (m) => `O campo "${m[1]}" precisa ser uma lista.`],
];

// Aceita o erro do apiFetch (`err.body.error`), um Error comum ou uma string.
function textoCru(erro) {
  if (!erro) return null;
  if (typeof erro === 'string') return erro;
  if (erro.body && typeof erro.body.error === 'string') return erro.body.error;
  if (typeof erro.error === 'string') return erro.error;
  return null;
}

function traduzir(cru) {
  if (!cru) return null;
  const exata = TRADUCOES[cru];
  if (exata) return exata;
  for (const [padrao, montar] of REGRAS) {
    const m = cru.match(padrao);
    if (m) return montar(m);
  }
  return null;
}

export function descreverErro(erro, padrao = 'Não foi possível concluir a ação.') {
  const cru = textoCru(erro);
  if (!cru) return padrao;
  // Sem mapeamento o texto original vai para a tela: um erro desconhecido em
  // inglês ainda é melhor que uma frase genérica que esconde o que aconteceu.
  return traduzir(cru) || cru;
}

// Só devolve algo quando a frase FOI traduzida — nesses casos o original ainda
// serve para diagnóstico (buscar o código, mandar para o suporte). Quando não
// houve tradução, o texto técnico já é o que está na tela.
export function detalheTecnicoDoErro(erro) {
  const cru = textoCru(erro);
  if (!cru) return null;
  return traduzir(cru) ? cru : null;
}
