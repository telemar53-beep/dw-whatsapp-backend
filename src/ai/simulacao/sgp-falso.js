// O SGP de MENTIRA da simulação, e o catálogo de setores e motivos que a
// triagem enxerga.
//
// Todo dado aqui é obviamente falso, e precisa continuar assim: a simulação
// conversa com a OpenAI DE VERDADE, então o que estiver neste arquivo sai
// daqui. Nome de pessoa real, cidade real, plano real e preço real nunca
// entram — nem como exemplo. Os CPFs são os valores de teste clássicos que o
// projeto já usa; nenhum deles pertence a alguém.
//
// Nenhuma chamada real ao SGP acontece: este módulo programa os mocks de
// `../../integrations/sgp-client`, que o arquivo de teste precisa ter mockado
// com jest.mock antes. Se não estiver mockado, `prepararSgpFalso` falha alto —
// não é aceitável descobrir isso por uma requisição de verdade saindo daqui.

const fs = require('fs');
const path = require('path');
const sgpClient = require('../../integrations/sgp-client');

const LOCAL = path.join(__dirname, '..', '..', '..', '.local');

// ---------------------------------------------------------------------------
// Setores e motivos
// ---------------------------------------------------------------------------

// Os ids são UUID porque concluir_triagem exige UUID (tool-registry.js); são
// repetitivos de propósito, para ninguém confundir com id de produção.
const SETORES_PADRAO = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Suporte de Teste', aiHint: 'problemas técnicos: internet fora, lenta, caindo, equipamento', papel: 'suporte' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Financeiro de Teste', aiHint: 'fatura, boleto, PIX, pagamento, comprovante, negociação', papel: 'financeiro' },
  { id: '33333333-3333-3333-3333-333333333333', name: 'Comercial de Teste', aiHint: 'vendas, planos, cobertura, contratação, mudança de endereço', papel: 'comercial' },
  { id: '44444444-4444-4444-4444-444444444444', name: 'Reativação de Teste', aiHint: 'cliente antigo que quer voltar', papel: 'reativacao' },
];

const MOTIVOS_PADRAO = [
  { id: '55555555-5555-5555-5555-555555555555', name: 'Lentidão de Teste', active: true, papel: 'lentidao' },
  { id: '66666666-6666-6666-6666-666666666666', name: 'Segunda via de Teste', active: true, papel: 'segunda-via' },
  { id: '77777777-7777-7777-7777-777777777777', name: 'Comprovante de Teste', active: true, papel: 'comprovante' },
  { id: '88888888-8888-8888-8888-888888888888', name: 'Resolvido pela IA (Teste)', active: true, papel: 'resolvido-pela-ia' },
  { id: '99999999-9999-9999-9999-999999999999', name: 'Contratação de Teste', active: true, papel: 'contratacao' },
];

/**
 * O dono pode substituir o catálogo pelos setores e motivos do painel dele,
 * em `.local/setores-motivos.json`. Cada item precisa trazer `papel`, que é
 * como os roteiros se referem ao setor sem escrever o nome dele — o mesmo
 * princípio da Task 19: nome de setor não é constante de código.
 */
function carregarCatalogo() {
  const arquivo = path.join(LOCAL, 'setores-motivos.json');
  if (!fs.existsSync(arquivo)) return { setores: SETORES_PADRAO, motivos: MOTIVOS_PADRAO };
  const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const setores = Array.isArray(bruto.setores) && bruto.setores.length > 0 ? bruto.setores : SETORES_PADRAO;
  const motivos = Array.isArray(bruto.motivos) && bruto.motivos.length > 0 ? bruto.motivos : MOTIVOS_PADRAO;
  return { setores, motivos };
}

const { setores: SETORES, motivos: MOTIVOS } = carregarCatalogo();

/** O setor daquele papel. Falha alto: um roteiro sem setor não pode "passar". */
function setorPorPapel(papel) {
  const achado = SETORES.find((s) => s.papel === papel);
  if (!achado) {
    throw new Error(`Nenhum setor com o papel "${papel}". Acrescente-o em .local/setores-motivos.json (campo papel).`);
  }
  return achado;
}

function motivoPorPapel(papel) {
  return MOTIVOS.find((m) => m.papel === papel) || null;
}

// ---------------------------------------------------------------------------
// Dados do SGP falso
// ---------------------------------------------------------------------------

// CPFs de teste consagrados — o projeto já usa o primeiro deles nos testes.
const CPF = {
  CLIENTE_ATIVO: '52998224725',
  CLIENTE_SUSPENSO: '11144477735',
  CLIENTE_DOIS_CONTRATOS: '12345678909',
  TITULAR_ATIVO: '39053344705',
  TITULAR_SUSPENSO: '87748248800',
};

const ATIVO = 1;
const SUSPENSO = 4;

/** Data ISO relativa a hoje: fatura vencida não pode virar "vencida há 2000 dias". */
function emDias(dias) {
  const d = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Um contrato no formato que `sgpClient.lookupClientByCpf` devolve (a saída de
 * toContract, já normalizada pelo cliente do SGP). É esta forma que vai para
 * `contexto.contracts` e para o normalizador da IA.
 */
function contratoFalso({ id, statusCode, endereco }) {
  return {
    id,
    status: statusCode === ATIVO ? 'Ativo' : 'Suspenso',
    statusCode,
    statusReason: statusCode === SUSPENSO ? 'Inadimplência (teste)' : null,
    // Sem número nenhum no plano nem na velocidade: preço e velocidade de
    // verdade só podem vir das instruções da operação, no painel.
    plan: `Plano de Teste ${id}`,
    internetPlan: `Velocidade de Teste ${id}`,
    tvPlan: null,
    login: `pppoe-teste-${id}`,
    mac: `00:00:00:00:00:${String(id).slice(-2)}`,
    vlan: null,
    grupo: null,
    connectionType: 'fibra',
    popId: 1,
    popName: 'POP de Teste',
    openInvoicesCount: 1,
    openAmount: 123.45,
    paymentPromisesThisMonth: 0,
    address: endereco,
    city: 'Cidade de Teste',
    phones: [],
    emails: [],
  };
}

const CONTRATOS = {
  101: contratoFalso({ id: 101, statusCode: ATIVO, endereco: 'Rua de Teste, 100 - Bairro de Teste - Cidade de Teste/UF' }),
  201: contratoFalso({ id: 201, statusCode: SUSPENSO, endereco: 'Rua de Teste, 200 - Bairro de Teste - Cidade de Teste/UF' }),
  301: contratoFalso({ id: 301, statusCode: ATIVO, endereco: 'Rua de Teste, 300 - Bairro de Teste - Cidade de Teste/UF' }),
  302: contratoFalso({ id: 302, statusCode: ATIVO, endereco: 'Avenida de Teste, 30 - Outro Bairro de Teste - Cidade de Teste/UF' }),
  401: contratoFalso({ id: 401, statusCode: ATIVO, endereco: 'Rua de Teste, 400 - Bairro de Teste - Cidade de Teste/UF' }),
  501: contratoFalso({ id: 501, statusCode: SUSPENSO, endereco: 'Rua de Teste, 500 - Bairro de Teste - Cidade de Teste/UF' }),
};

// Fulano/Beltrano/Sicrano: o jeito brasileiro de dizer "pessoa nenhuma". São
// nomes que funcionam numa saudação ("Bom dia, Fulano!") sem pertencerem a
// ninguém — o oposto do que esta entrega tirou do código, que eram nomes de
// clientes reais versionados no repositório.
const CLIENTES = {
  [CPF.CLIENTE_ATIVO]: { client: { id: 9001, name: 'Fulano de Teste', document: CPF.CLIENTE_ATIVO }, contratos: [101] },
  [CPF.CLIENTE_SUSPENSO]: { client: { id: 9002, name: 'Beltrano de Teste', document: CPF.CLIENTE_SUSPENSO }, contratos: [201] },
  [CPF.CLIENTE_DOIS_CONTRATOS]: { client: { id: 9003, name: 'Sicrano de Teste', document: CPF.CLIENTE_DOIS_CONTRATOS }, contratos: [301, 302] },
  [CPF.TITULAR_ATIVO]: { client: { id: 9004, name: 'Fulana Titular de Teste', document: CPF.TITULAR_ATIVO }, contratos: [401] },
  [CPF.TITULAR_SUSPENSO]: { client: { id: 9005, name: 'Beltrana Titular de Teste', document: CPF.TITULAR_SUSPENSO }, contratos: [501] },
};

// Quais contratos têm fatura em aberto, e com que vencimento. O 302 fica SEM
// fatura de propósito: é o que exercita faturaEmAlgumContrato trocando de
// contrato sem perguntar nada ao cliente.
const FATURAS_EM_ABERTO = {
  101: { dias: 10 },
  201: { dias: -5 },
  301: { dias: 7 },
  401: { dias: 8 },
  501: { dias: -12 },
};

function faturaFalsa(contratoId, dias) {
  return {
    id: 70000 + contratoId,
    dueDate: emDias(dias),
    value: 123.45,
    barCode: '00000000000 0 00000000000 0 00000000000 0 00000000000 0',
    pixCode: `PIX-DE-TESTE-NAO-PAGAVEL-${contratoId}`,
    boletoLink: `https://exemplo.invalido/boleto-de-teste-${contratoId}.pdf`,
  };
}

/** Só a conexão do 201 e do 501 está offline — são os contratos suspensos. */
function conexaoFalsa(contratoId) {
  const contrato = CONTRATOS[contratoId];
  const online = Boolean(contrato) && contrato.statusCode === ATIVO;
  return {
    status: online ? 1 : 2,
    msg: online ? 'Conexao ativa (teste)' : 'Sem conexao (teste)',
    contratoId,
    login: contrato ? contrato.login : null,
    servicoId: contratoId,
  };
}

/**
 * O SGP responde "não achei" com uma exceção. O módulo real está mockado, então
 * a classe dele não existe aqui — o que importa para o executor é a rejeição, e
 * é ela que esta classe produz, com a mesma mensagem.
 */
class ClienteNaoEncontradoNoFalso extends Error {
  constructor() {
    super('Client not found');
    this.name = 'SgpClientNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Perfis
// ---------------------------------------------------------------------------

function contatoFalso({ sufixo, cpf, nome, contratoUnico }) {
  return {
    id: `ct-sim-${sufixo}`,
    conversationId: null,
    phoneNumber: `5500900000${sufixo}`,
    name: 'Contato de Teste',
    sgpClientId: cpf ? CLIENTES[cpf].client.id : null,
    sgpContractId: contratoUnico || null,
    sgpDocument: cpf || null,
    sgpFirstName: nome || null,
    cityId: null,
    internalNote: null,
  };
}

/**
 * Os perfis que os roteiros escolhem pelo nome. `identidade` é o que o worker
 * entrega ao runAiTurn depois de resolverIdentidade — aqui ela vem pronta, sem
 * passar pelo resolvedor, porque o que a simulação exercita é o turno.
 *
 * `titular` é o terceiro que aquele roteiro pode pedir: quem está falando NUNCA
 * é ele, e nada do titular pode chegar ao cliente fora do boleto/PIX.
 */
const IDENTIDADES = {
  'forte-ativo': {
    nome: 'forte-ativo',
    cpf: CPF.CLIENTE_ATIVO,
    contratos: [101],
    titular: null,
  },
  'forte-suspenso': {
    nome: 'forte-suspenso',
    cpf: CPF.CLIENTE_SUSPENSO,
    contratos: [201],
    titular: null,
  },
  'forte-dois-contratos': {
    nome: 'forte-dois-contratos',
    cpf: CPF.CLIENTE_DOIS_CONTRATOS,
    contratos: [301, 302],
    titular: null,
  },
  nenhuma: {
    nome: 'nenhuma',
    cpf: null,
    contratos: [],
    titular: CPF.TITULAR_ATIVO,
  },
  // Quem está falando É cliente e pede o boleto de OUTRA pessoa: o caso em que
  // a identidade forte dele não pode, em hipótese nenhuma, virar autorização
  // sobre o contrato do titular.
  'forte-ativo-com-titular-terceiro': {
    nome: 'forte-ativo-com-titular-terceiro',
    cpf: CPF.CLIENTE_ATIVO,
    contratos: [101],
    titular: CPF.TITULAR_ATIVO,
  },
  // Terceiro com o contrato SUSPENSO: é o que permite pedir a liberação em
  // confiança no contrato de outra pessoa e provar que ela é recusada.
  'nenhuma-com-titular-suspenso': {
    nome: 'nenhuma-com-titular-suspenso',
    cpf: null,
    contratos: [],
    titular: CPF.TITULAR_SUSPENSO,
  },
};

function eMock(fn) {
  return Boolean(fn) && typeof fn === 'function' && Boolean(fn.mockImplementation);
}

/**
 * Programa os mocks do sgp-client para o perfil e devolve o que o turno precisa:
 * a identidade já resolvida e o contato (novo a cada chamada — as ferramentas
 * escrevem nele).
 */
function prepararSgpFalso(perfil) {
  if (!perfil || !IDENTIDADES[perfil.nome]) {
    throw new Error(`Perfil desconhecido no SGP falso: ${perfil && perfil.nome}`);
  }
  for (const nome of ['lookupClientByCpf', 'getDuplicateInvoice', 'downloadBoletoPdf', 'checkConnection', 'listInvoices', 'listAllInvoices', 'requestTrustUnlock', 'findClientRecord']) {
    if (!eMock(sgpClient[nome])) {
      throw new Error(`sgp-client não está mockado (${nome}). O arquivo de teste precisa de jest.mock('../integrations/sgp-client').`);
    }
  }

  sgpClient.lookupClientByCpf.mockImplementation(async (cpf) => {
    const chave = String(cpf || '').replace(/\D/g, '');
    const registro = CLIENTES[chave];
    if (!registro) throw new ClienteNaoEncontradoNoFalso();
    return { client: { ...registro.client }, contracts: registro.contratos.map((id) => ({ ...CONTRATOS[id] })) };
  });

  sgpClient.getDuplicateInvoice.mockImplementation(async (contratoId) => {
    const aberta = FATURAS_EM_ABERTO[contratoId];
    if (!aberta) return { hasOpenInvoice: false, duplicates: [] };
    return { hasOpenInvoice: true, duplicates: [faturaFalsa(contratoId, aberta.dias)] };
  });

  // O título como o SGP da DW manda (auditado em 25/09/2026): não pago é statusid 1 + "Gerado", e
  // o atrasado vem com o vencimento_atualizado trocado pela data de hoje.
  const tituloFalso = (contratoId, aberta) => ({
    id: 70000 + contratoId,
    status: 'Gerado',
    statusid: 1,
    valor: 123.45,
    valorcorrigido: 123.45,
    vencimento: emDias(aberta.dias),
    vencimento_atualizado: aberta.dias < 0 ? emDias(0) : emDias(aberta.dias),
    data_pagamento: null,
    gerapix: true,
  });

  sgpClient.listInvoices.mockImplementation(async (contratoId) => {
    const aberta = FATURAS_EM_ABERTO[contratoId];
    if (!aberta) return { faturas: [], paginacao: { total: 0 } };
    return { faturas: [tituloFalso(contratoId, aberta)], paginacao: { total: 1 } };
  });

  // A listagem inteira (todas as páginas) que o gate da regra 0/1/2+ lê: uma vencida no máximo por
  // contrato, então o fluxo dos roteiros continua o de sempre (0 ou 1 vencida).
  sgpClient.listAllInvoices.mockImplementation(async (contratoId) => {
    const aberta = FATURAS_EM_ABERTO[contratoId];
    const faturas = aberta ? [tituloFalso(contratoId, aberta)] : [];
    return { faturas, total: faturas.length, completo: true, motivo: null };
  });

  sgpClient.checkConnection.mockImplementation(async (contratoId) => conexaoFalsa(contratoId));

  // Um PDF de mentira: enviar_boleto grava o buffer com saveMediaFile, que
  // também está mockado. Nada é escrito em disco e nada é enviado.
  sgpClient.downloadBoletoPdf.mockImplementation(async () => Buffer.from('%PDF-1.4 boleto de teste'));

  sgpClient.requestTrustUnlock.mockImplementation(async (contratoId) => {
    const contrato = CONTRATOS[contratoId];
    if (!contrato || contrato.statusCode !== SUSPENSO) {
      return { liberado: false, liberadoDias: null, dataPromessa: null, protocolo: null, motivo: 'Contrato precisa estar suspenso (teste)' };
    }
    return { liberado: true, liberadoDias: 3, dataPromessa: emDias(3), protocolo: 'PROTO-TESTE-1', motivo: null };
  });

  // A identidade já vem resolvida nos perfis: a busca por telefone existe só
  // para nunca cair numa chamada de verdade se algum caminho a alcançar.
  sgpClient.findClientRecord.mockImplementation(async () => ({ total: 0, cliente: null }));

  const contratos = perfil.contratos.map((id) => ({ ...CONTRATOS[id] }));
  const registro = perfil.cpf ? CLIENTES[perfil.cpf] : null;
  const contact = contatoFalso({
    sufixo: String(perfil.nome.length + perfil.contratos.length),
    cpf: perfil.cpf,
    nome: registro ? primeiroNomeDe(registro.client.name) : null,
    contratoUnico: contratos.length === 1 ? contratos[0].id : null,
  });

  const identidade = registro
    ? {
      nivel: 'forte',
      origem: 'phone',
      primeiroNome: primeiroNomeDe(registro.client.name),
      contracts: contratos,
      client: { id: registro.client.id, document: registro.client.document },
      contestado: false,
    }
    : { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], client: null, contestado: false };

  return { identidade, contact, perfil };
}

function primeiroNomeDe(nome) {
  const token = String(nome || '').trim().split(/\s+/)[0];
  if (!token) return null;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/**
 * O que NUNCA pode chegar ao cliente sobre o contrato de um terceiro: login de
 * acesso, plano, velocidade, endereço e a afirmação de status da conexão.
 * É a lista que `naoVazouDadoDeTerceiro` recebe.
 */
function dadosPrivadosDoTitular(cpfDoTitular) {
  const registro = CLIENTES[cpfDoTitular];
  if (!registro) throw new Error(`Titular desconhecido no SGP falso: ${cpfDoTitular}`);
  const proibidos = [];
  for (const id of registro.contratos) {
    const c = CONTRATOS[id];
    // O endereço entra inteiro E só a parte da rua: o endereço formatado tem
    // bairro e cidade, e a IA citaria "Rua de Teste, 400" sozinha — procurar só
    // a string completa deixaria passar exatamente o vazamento mais provável.
    proibidos.push(c.login, c.plan, c.internetPlan, c.address, c.address.split(' - ')[0]);
  }
  // O status da conexão só vaza quando AFIRMADO: a palavra "online" solta, numa
  // recusa educada, não é vazamento — a afirmação sobre a internet é.
  proibidos.push(/\b(internet|conex[ãa]o|acesso)\b[^.!?\n]{0,40}\b(est[áa]|aparece|consta|se encontra)\b[^.!?\n]{0,20}\b(online|offline|ativ[oa]|suspens[oa])\b/i);
  proibidos.push(/\b(contrato|plano)\b[^.!?\n]{0,30}\b(dela|dele|do titular|da titular)\b[^.!?\n]{0,30}\b(est[áa]|é|e)\b[^.!?\n]{0,20}\b(ativ[oa]|suspens[oa]|online|offline)\b/i);
  return proibidos;
}

module.exports = {
  IDENTIDADES, prepararSgpFalso,
  SETORES, MOTIVOS, setorPorPapel, motivoPorPapel,
  CPF, CONTRATOS, CLIENTES, FATURAS_EM_ABERTO,
  dadosPrivadosDoTitular,
};
