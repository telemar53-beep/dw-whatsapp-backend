const axios = require('axios');
const { getSgpQueryConfig } = require('./sgp-query-config.repository');

class SgpNotConfiguredError extends Error {}
class SgpDisabledError extends Error {}
class SgpClientNotFoundError extends Error {}
class SgpRequestError extends Error {}

async function requireConfig() {
  const config = await getSgpQueryConfig();
  if (!config) throw new SgpNotConfiguredError('SGP integration is not configured');
  if (!config.enabled) throw new SgpDisabledError('SGP integration is not enabled');
  return config;
}

async function postSgp(config, path, params) {
  try {
    return await axios.post(`${config.baseUrl}${path}`, new URLSearchParams({ token: config.token, app: config.app, ...params }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
  } catch (err) {
    console.error(`SGP request failed: ${path}`, err.response ? { status: err.response.status } : { message: err.message });
    // A causa anexada ao erro precisa ser saneada aqui, na origem: err bruto
    // carrega err.config.data, o corpo form-encoded com o token do SGP e o
    // CPF/CNPJ do cliente. Mesmo formato de causa que openai-client.js usa
    // para o mesmo problema (token da OpenAI em vez do token do SGP).
    const cause = { status: err.response && err.response.status, message: err.message };
    throw new SgpRequestError(`Failed to reach SGP at ${path}`, { cause });
  }
}

function formatAddress(c) {
  const parts = [];
  if (c.endereco_logradouro) {
    parts.push(c.endereco_numero ? `${c.endereco_logradouro}, ${c.endereco_numero}` : c.endereco_logradouro);
  }
  if (c.endereco_bairro) parts.push(c.endereco_bairro);
  const cityUf = [c.endereco_cidade, c.endereco_uf].filter(Boolean).join('/');
  if (cityUf) parts.push(cityUf);
  return parts.join(' - ');
}

function toContract(c) {
  return {
    id: c.contratoId,
    status: c.contratoStatusDisplay,
    statusCode: c.contratoStatus,
    statusReason: c.motivo_status,
    plan: c.servico_plano,
    internetPlan: c.planointernet,
    tvPlan: c.planotv,
    login: c.servico_login,
    mac: c.servico_mac,
    vlan: c.servico_vlan,
    grupo: c.servico_grupo,
    connectionType: c.servico_tipo_conexao,
    popId: c.popId,
    popName: c.popNome,
    openInvoicesCount: c.contratoTitulosAReceber,
    openAmount: c.contratoValorAberto,
    // Contador do SGP de promessas de pagamento no mês corrente. É a única
    // visão que temos de liberações feitas por fora do sistema (app da Central,
    // atendente no SGP): a listagem de promessas não existe nesta instalação.
    paymentPromisesThisMonth: Number(c.promessasPagamentoMes) || 0,
    address: formatAddress(c),
    // Cidade crua, separada do endereço formatado: é o que o preenchimento
    // automático da cidade do contato casa com as cidades cadastradas aqui.
    // Uso interno — o normalizador da IA não expõe este campo ao modelo.
    city: c.endereco_cidade || null,
    phones: (c.telefones || []).map((t) => t.contato),
    emails: (c.emails || []).map((e) => e.contato),
  };
  // servico_senha, contratoCentralSenha e contratoCentralLogin são
  // deliberadamente omitidos: senhas do cliente não saem deste módulo.
}

async function lookupClientByCpf(cpf) {
  const config = await requireConfig();
  const response = await postSgp(config, '/api/ura/consultacliente', { cpfcnpj: cpf });
  const data = response.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new SgpRequestError('Unexpected response from SGP');
  }
  const contratos = data.contratos;
  if (!Array.isArray(contratos) || contratos.length === 0) {
    throw new SgpClientNotFoundError('Client not found');
  }
  return {
    client: { id: contratos[0].clienteId, name: contratos[0].razaoSocial, document: contratos[0].cpfCnpj },
    contracts: contratos.map(toContract),
  };
}

async function getDuplicateInvoice(contratoId) {
  const config = await requireConfig();
  // Mirrors the exact call chain observed in the user's real Chat Mix test
  // captures. This first call's response is unused — it exists only to
  // replicate the real flow.
  try {
    await postSgp(config, '/api/central/titulos', { contrato: contratoId, nao_gerar_os: 1 });
  } catch (err) {
    // Mirrors the real Chat Mix call sequence for parity only — its response was already
    // unused, and a failure here must never block generating the duplicate invoice itself.
  }

  const generated = await postSgp(config, '/api/ura/fatura2via', { contrato: contratoId, nao_gerar_os: 1 });
  const links = generated.data.links;
  if (!generated.data.status || !Array.isArray(links) || links.length === 0) {
    return { hasOpenInvoice: false, duplicates: [] };
  }

  const duplicates = await Promise.all(
    links.map(async (link) => {
      // Regra do Financeiro: o código PIX correto é o que o SGP já devolve em
      // codigopix na 2ª via (o mesmo que o Financeiro usa). Só chamamos
      // pagamento/pix quando a fatura não trouxer nenhum código pronto.
      let pixCode = typeof link.codigopix === 'string' && link.codigopix.trim() ? link.codigopix : null;
      if (!pixCode) {
        try {
          const pixResponse = await postSgp(config, `/api/ura/pagamento/pix/${link.id}`, { contrato: contratoId });
          if (pixResponse.data.pix) pixCode = pixResponse.data.pix;
        } catch (err) {
          // Sem codigopix no Financeiro e sem sucesso ao gerar: pixCode fica null
          // em vez de falhar a ação inteira.
        }
      }
      return {
        id: link.id,
        dueDate: link.vencimento,
        value: link.valor,
        barCode: link.linhadigitavel,
        pixCode,
        boletoLink: link.link,
      };
    })
  );

  return { hasOpenInvoice: true, duplicates };
}

async function downloadBoletoPdf(link) {
  try {
    const response = await axios.get(link, { responseType: 'arraybuffer', timeout: 15000 });
    return Buffer.from(response.data);
  } catch (err) {
    // Mesmo saneamento de postSgp: nunca anexar o err bruto como causa.
    const cause = { status: err.response && err.response.status, message: err.message };
    throw new SgpRequestError('Failed to download boleto PDF', { cause });
  }
}

async function checkConnection(contratoId) {
  const config = await requireConfig();
  const response = await postSgp(config, '/api/ura/verificaacesso', { contrato: contratoId });
  const data = response.data;
  if (!data || typeof data !== 'object') {
    throw new SgpRequestError('Unexpected response from SGP');
  }
  return {
    status: data.status,
    msg: data.msg,
    contratoId: data.contratoId,
    login: data.login,
    servicoId: data.servico_id,
  };
}

async function listInvoices(contratoId) {
  const config = await requireConfig();
  const response = await postSgp(config, '/api/central/titulos', { contrato: contratoId, nao_gerar_os: 1 });
  const data = response.data;
  if (!data || typeof data !== 'object') {
    throw new SgpRequestError('Unexpected response from SGP');
  }
  return { faturas: Array.isArray(data.faturas) ? data.faturas : [], paginacao: data.paginacao || {} };
}

/**
 * Desbloqueio em confiança (liberação por promessa de pagamento). Endpoint
 * documentado na coleção oficial da API do SGP: POST /api/ura/liberacaopromessa/.
 * Só `contrato` é enviado — `data_promessa` fica de fora de propósito: quem
 * decide os dias é a configuração do SGP (URA_PROMESSA_DIAS), nunca o chamador.
 *
 * A `msg` de sucesso traz o login PPPoE do cliente e por isso não sai daqui;
 * a de recusa é a explicação legível ("Contrato precisa estar ativo, suspenso
 * ou com velocidade reduzida", "já atingiu quantidade permitida"...) e essa
 * sim volta ao chamador.
 */
async function requestTrustUnlock(contratoId) {
  const config = await requireConfig();
  const response = await postSgp(config, '/api/ura/liberacaopromessa/', { contrato: contratoId });
  const data = response.data;
  if (!data || typeof data !== 'object') {
    throw new SgpRequestError('Unexpected response from SGP');
  }
  // API form-encoded: booleanos e números podem chegar como texto ("true",
  // "1", "3"). Ler estrito demais aqui viraria uma liberação REAL em "não
  // liberou" — e ela ficaria sem registro. Coerção deliberada.
  const liberado = data.liberado === true || data.liberado === 1
    || ['true', '1'].includes(String(data.liberado).trim().toLowerCase());
  const dias = Number(data.liberado_dias);
  return {
    liberado,
    liberadoDias: liberado && Number.isInteger(dias) && dias > 0 ? dias : null,
    // Observado no teste real (2026-09-12), embora ausente do exemplo da
    // documentação: a data-limite da promessa, 'AAAA-MM-DD'. É o que o
    // cliente quer saber ("até quando?").
    dataPromessa: liberado && /^\d{4}-\d{2}-\d{2}$/.test(String(data.data_promessa || '')) ? data.data_promessa : null,
    protocolo: liberado ? (data.protocolo != null ? String(data.protocolo) : null) : null,
    motivo: liberado ? null : (data.msg || 'Liberação não permitida'),
  };
}

/**
 * Localiza UM cliente por telefone ou CPF/CNPJ em /api/ura/clientes/.
 * Allowlist estrita: a resposta traz contratoCentralSenha, contratoCentralLogin,
 * endereço e contatos — nada disso sai daqui, só id e cpfcnpj.
 * `cliente` só vem preenchido quando o total é exatamente 1 — telefone zerado
 * casa com vários cadastros no SGP da DW (sondagem de 2026-09-12).
 */
async function findClientRecord(filtro) {
  const config = await requireConfig();
  const params = { omitir_titulos: 1, omitir_contatos: 1, limit: 2 };
  if (filtro.telefone) params.telefone = filtro.telefone;
  else if (filtro.cpfcnpj) params.cpfcnpj = filtro.cpfcnpj;
  else throw new SgpRequestError('findClientRecord needs telefone or cpfcnpj');
  const response = await postSgp(config, '/api/ura/clientes/', params);
  const data = response.data;
  if (!data || typeof data !== 'object') throw new SgpRequestError('Unexpected response from SGP');
  const clientes = Array.isArray(data.clientes) ? data.clientes : [];
  const total = data.paginacao && Number.isInteger(Number(data.paginacao.total)) ? Number(data.paginacao.total) : clientes.length;
  if (total !== 1 || clientes.length !== 1) return { total, cliente: null };
  const c = clientes[0];
  return {
    total: 1,
    cliente: {
      id: c.id,
      cpfcnpj: String(c.cpfcnpj || '').replace(/\D/g, ''),
    },
  };
}

module.exports = {
  lookupClientByCpf,
  getDuplicateInvoice,
  downloadBoletoPdf,
  checkConnection,
  listInvoices,
  requestTrustUnlock,
  findClientRecord,
  SgpNotConfiguredError,
  SgpDisabledError,
  SgpClientNotFoundError,
  SgpRequestError,
};
