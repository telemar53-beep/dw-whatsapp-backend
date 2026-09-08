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
    throw new SgpRequestError(`Failed to reach SGP at ${path}`, { cause: err });
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
    plan: c.servico_plano,
    openInvoicesCount: c.contratoTitulosAReceber,
    openAmount: c.contratoValorAberto,
    address: formatAddress(c),
    phones: (c.telefones || []).map((t) => t.contato),
    emails: (c.emails || []).map((e) => e.contato),
  };
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
      let pixCode = link.codigopix || null;
      try {
        const pixResponse = await postSgp(config, `/api/ura/pagamento/pix/${link.id}`, { contrato: contratoId });
        if (pixResponse.data.pix) pixCode = pixResponse.data.pix;
      } catch (err) {
        // Keep fatura2via's own codigopix as a fallback rather than failing the whole action.
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
    throw new SgpRequestError('Failed to download boleto PDF', { cause: err });
  }
}

module.exports = {
  lookupClientByCpf,
  getDuplicateInvoice,
  downloadBoletoPdf,
  SgpNotConfiguredError,
  SgpDisabledError,
  SgpClientNotFoundError,
  SgpRequestError,
};
