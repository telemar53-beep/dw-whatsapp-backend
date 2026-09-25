// Mensagem automática: a que o SISTEMA manda sem atendente e sem IA — disparo do SGP e
// campanha (Fase 1B, 25/09/2026). A própria linha em `messages` é a fonte permanente do
// contexto: `metadata.origem` diz de onde veio, e é por ela (nunca pela ausência de texto)
// que o resto do sistema a reconhece.
//
// Peça reutilizável: a Fase 1 (aviso de instabilidade como fato) deve acrescentar a sua origem
// aqui, com o seu resumo — o comportamento do aviso NÃO está implementado.
//
// Regra de privacidade: a metadata leva só o necessário e seguro. NUNCA CPF, token, valor,
// link de boleto ou dado do cliente. O texto que o cliente recebeu fica em `content`, para a
// atendente; para a IA vai um resumo seguro (resumoParaModelo), nunca o texto montado.

const ORIGENS_AUTOMATICAS = ['sgp', 'campanha'];

function ehMensagemAutomatica(message) {
  const origem = message && message.metadata && message.metadata.origem;
  return ORIGENS_AUTOMATICAS.includes(origem);
}

function semVazios(objeto) {
  return Object.fromEntries(Object.entries(objeto).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

/**
 * Metadata de uma mensagem que saiu pela rota de disparo do SGP.
 * `template` ({ name, bodyText }) só no modo template: o corpo aprovado, com os {{n}}, é texto
 * da empresa — não tem dado do cliente. `campos` vem de extrairCamposDoDisparo.
 */
function metadataDoDisparoSgp({ integrationId, modo, template, campos = {}, referenceId }) {
  return semVazios({
    origem: 'sgp',
    gatewayId: integrationId,
    modo,
    template: template && template.name,
    textoModelo: template && template.bodyText,
    tipo: campos.tipo || 'desconhecido',
    vencimento: campos.vencimento,
    faturaId: campos.faturaId,
    contratoId: campos.contratoId,
    referenciaSgp: referenceId,
  });
}

function metadataDaCampanha({ campaignId, templateName }) {
  return semVazios({ origem: 'campanha', campanhaId: campaignId, template: templateName });
}

const umaLinha = (texto) => String(texto || '').replace(/\s*\n+\s*/g, ' / ').trim();

/**
 * O que a IA recebe no lugar do conteúdo de uma mensagem automática. Devolve null para
 * mensagem que não é automática (quem chama segue a regra de sempre).
 *
 * SGP, modo template: template, tipo, vencimento informado (só se veio no bloco nomeado) e o
 * texto do MODELO, com os {{n}} — nunca o texto montado, que tem nome, valor e link.
 * SGP, texto livre: o conteúdo é omitido — num texto livre não há como separar nome, valor e
 * link do resto.
 * Campanha: só o rótulo e o template, conteúdo omitido. O texto renderizado nunca vai ao
 * modelo — a proteção não depende de a campanha de hoje não ter dado do cliente.
 */
function resumoParaModelo(message) {
  if (!ehMensagemAutomatica(message)) return null;
  const m = message.metadata;
  if (m.origem === 'campanha') {
    const template = m.template ? `template: ${m.template}; ` : '';
    return `[mensagem automática de campanha enviada ao cliente — ${template}conteúdo omitido]`;
  }
  const partes = [];
  if (m.modo === 'template') {
    if (m.template) partes.push(`template: ${m.template}`);
    partes.push(`tipo: ${m.tipo || 'desconhecido'}`);
    if (m.vencimento) partes.push(`vencimento informado: ${m.vencimento}`);
    if (m.textoModelo) partes.push(`texto do modelo (com {{n}} no lugar dos dados do cliente): "${umaLinha(m.textoModelo)}"`);
  } else {
    partes.push('texto livre, conteúdo omitido');
    partes.push(`tipo: ${m.tipo || 'desconhecido'}`);
  }
  return `[mensagem automática do SGP enviada ao cliente — ${partes.join('; ')}]`;
}

/**
 * O disparo automático a que a mensagem mais recente do cliente se relaciona.
 * Prioridade: 1) a mensagem automática que o cliente CITOU (a citada pode estar fora do
 * histórico carregado — quem chama a busca e passa em `mensagemCitada`); 2) a última mensagem
 * automática do histórico; 3) nenhuma → null (nenhum fato é criado).
 */
function encontrarDisparoRelacionado(historico, mensagemCitada = null) {
  const lista = Array.isArray(historico) ? historico : [];
  const ultimaEntrada = [...lista].reverse().find((m) => m && m.direction === 'inbound');
  const idCitado = ultimaEntrada && ultimaEntrada.repliedToMessageId;
  if (idCitado) {
    const citada = lista.find((m) => m && m.id === idCitado)
      || (mensagemCitada && mensagemCitada.id === idCitado ? mensagemCitada : null);
    if (ehMensagemAutomatica(citada)) return { mensagem: citada, citado: true };
  }
  const ultimaAutomatica = [...lista].reverse().find(ehMensagemAutomatica);
  return ultimaAutomatica ? { mensagem: ultimaAutomatica, citado: false } : null;
}

/** Só os campos seguros do disparo, para o contexto da IA. Nunca o conteúdo montado. */
function fatoDoDisparo(relacionado) {
  if (!relacionado || !relacionado.mensagem) return null;
  const m = relacionado.mensagem.metadata || {};
  return semVazios({
    origem: m.origem,
    modo: m.modo,
    template: m.template,
    tipo: m.origem === 'sgp' ? (m.tipo || 'desconhecido') : undefined,
    vencimento: m.vencimento,
    enviadoEm: relacionado.mensagem.createdAt,
    citado: Boolean(relacionado.citado),
  });
}

module.exports = {
  ORIGENS_AUTOMATICAS, ehMensagemAutomatica, metadataDoDisparoSgp, metadataDaCampanha, resumoParaModelo,
  encontrarDisparoRelacionado, fatoDoDisparo,
};
