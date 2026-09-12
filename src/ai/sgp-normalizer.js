// A garantia de que estes campos nunca saem é a seleção explícita de campos
// em cada normalizer (allowlist): normalizeContract e normalizeInvoices constroem
// seus outputs nomeando cada campo, então um campo novo da API não pode vazar por acaso.
// Este array é o fixture do teste que prova essa garantia: a poisoned contract contém
// todos os cinco, e o teste asserta que nenhum nome e nenhum valor sobrevivem.
const CAMPOS_BLOQUEADOS = [
  'servico_senha',
  'contratoCentralSenha',
  'contratoCentralLogin',
  'servico_wifi_password',
  'servico_wifi_password_5',
];

// Tabela oficial da documentação da API (coleção Postman do SGP, filtro
// `status` de consultacliente): 1 Ativo; 2 Inativo; 3 Cancelado; 4 Suspenso;
// 5 Inviabilidade Técnica; 6 Novo; 7 Ativo com Velocidade Reduzida.
// Só o 1 foi observado em contrato real; os demais vêm da documentação.
const STATUS_POR_CODIGO = {
  1: 'ativo',
  2: 'inativo',
  3: 'cancelado',
  4: 'suspenso',
  5: 'inviabilidade_tecnica',
  6: 'novo',
  7: 'velocidade_reduzida',
};

function maskDocument(doc) {
  if (!doc) return null;
  const texto = String(doc);
  if (texto.length <= 5) return texto;
  return `${texto.slice(0, 3)}.***.**${texto.slice(-4)}`;
}

function normalizeClient(raw) {
  if (!raw) return null;
  return { nome: raw.name, documento: maskDocument(raw.document) };
}

function normalizeContract(contract) {
  if (!contract) return null;
  return {
    id: contract.id,
    status: STATUS_POR_CODIGO[contract.statusCode] || 'desconhecido',
    statusLabel: contract.status,
    motivo: contract.statusReason || null,
    plano: contract.plan,
    velocidade: contract.internetPlan || null,
    // O endereço é como o cliente reconhece o próprio contrato: ele não sabe o
    // número. É o dado que permite à IA perguntar "o da Rua X ou o da Av. Y?".
    endereco: contract.address || null,
    loginPPPoE: contract.login || null,
    mac: contract.mac || null,
    vlan: contract.vlan || null,
    pop: contract.popName || null,
  };
}

function normalizeConnection(raw) {
  const status = raw && raw.status === 1 ? 'online' : raw && raw.status === 2 ? 'offline' : 'desconhecido';
  return { status, verificadoEm: new Date().toISOString(), fonte: 'sgp' };
}

function normalizeInvoices(faturas) {
  if (!Array.isArray(faturas)) return [];
  // linhadigitavel e codigopix ficam de fora de propósito: a listagem é consulta,
  // entregar o meio de pagamento é a ferramenta de 2ª via.
  return faturas.map((f) => ({
    faturaId: f.id,
    status: f.status,
    statusCode: f.statusid,
    valorOriginal: f.valor,
    valorAtualizado: f.valorcorrigido,
    vencimentoOriginal: f.vencimento,
    vencimentoAtualizado: f.vencimento_atualizado,
    dataPagamento: f.data_pagamento,
    permiteGerarPix: Boolean(f.gerapix),
  }));
}

module.exports = {
  normalizeClient, normalizeContract, normalizeConnection, normalizeInvoices,
  maskDocument, CAMPOS_BLOQUEADOS,
};
