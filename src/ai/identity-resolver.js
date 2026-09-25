const sgpClient = require('../integrations/sgp-client');
const { setContactSgpLink } = require('../conversations/contact.repository');
const { preencherCidadePeloSgp } = require('../cities/contact-city.service');
const { mensagemSegura } = require('./safe-error-log');
const { brazilianNumberVariants } = require('../conversations/phone-variants');

/**
 * Quem é o cliente, ANTES de o modelo falar. Ordem: memória (contato já
 * vinculado ao SGP) → telefone do WhatsApp no SGP → ninguém. O modelo só pede
 * CPF quando isto devolve 'none'.
 *
 * Nível 'forte' = telefone bateu (exatamente um cadastro) ou memória; a
 * confirmação leve é chamar pelo primeiro nome — se não for ele, ele diz.
 * CPF digitado na conversa é resolvido por buscar_cliente (tool-registry.js),
 * não por aqui: esta função só cobre telefone e memória, e só devolve
 * 'forte' ou 'none'.
 */
function primeiroNome(nome) {
  const token = String(nome || '').trim().split(/\s+/)[0];
  if (!token) return null;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/**
 * '5598985120338' → ['98985120338', '9885120338'] e '559885120338' → ['9885120338', '98985120338']:
 * sem o 55, a forma recebida primeiro e depois a outra forma do nono dígito.
 *
 * Fase 1A (25/09/2026): antes, o número de 8 dígitos não ganhava a forma com o 9. É a forma do
 * wa_id da Meta fora dos DDDs 11-19/21/22/24/27/28, e o SGP da DW guarda o celular com o 9 — a
 * busca não achava ninguém e a IA pedia CPF. A regra é a mesma do disparo
 * (brazilianNumberVariants): fixo, que começa com 2 a 5, nunca ganha variante de celular.
 */
function variantesTelefone(numero) {
  let d = String(numero || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return [];
  return brazilianNumberVariants(`55${d}`).map((forma) => forma.slice(2));
}

function vazio() {
  return { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], client: null, contestado: false };
}

async function porCpf(cpf, origem) {
  const { client, contracts } = await sgpClient.lookupClientByCpf(cpf);
  return {
    nivel: 'forte', origem, primeiroNome: primeiroNome(client.name), contracts,
    client: { id: client.id, document: client.document }, contestado: false,
  };
}

/**
 * O vínculo já está gravado e o SGP respondeu, mas o contato é antigo (foi
 * vinculado antes de existir sgp_first_name): grava o nome agora, uma vez só.
 * Nunca derruba a resolução — a identidade já está pronta, o UPDATE é bônus.
 */
async function backfillPrimeiroNome(contact, identidade) {
  if (contact.sgpFirstName || !identidade.primeiroNome) return;
  try {
    await setContactSgpLink(contact.id, {
      sgpClientId: contact.sgpClientId,
      sgpContractId: contact.sgpContractId,
      sgpDocument: contact.sgpDocument,
      sgpFirstName: identidade.primeiroNome,
    });
    contact.sgpFirstName = identidade.primeiroNome;
  } catch (err) {
    console.error(`First name backfill failed for contact ${contact.id}: ${mensagemSegura(err)}`);
  }
}

/**
 * Vínculo gravado + SGP fora do ar. O cliente JÁ foi identificado antes; pedir
 * o CPF de novo (o que o nivel 'none' manda o modelo fazer) é o pior desfecho
 * possível. Devolve a memória como identidade forte, sem contratos — o
 * prompt da triagem vê sgpIndisponivel e proíbe boleto, PIX e status, que
 * dependeriam do SGP de qualquer jeito.
 */
function porMemoriaSemSgp(contact) {
  return {
    nivel: 'forte', origem: 'memory', primeiroNome: contact.sgpFirstName || null,
    contracts: [], client: { id: contact.sgpClientId || null, document: contact.sgpDocument },
    contestado: false, sgpIndisponivel: true,
  };
}

/**
 * O preenchimento da cidade já engole os próprios erros, mas ele roda DENTRO
 * do try que decide entre identidade e vazio(): se algum dia escapar alguma
 * coisa dali, o cliente seria tratado como não identificado por causa de um
 * campo acessório. Esta casca garante que isso não acontece.
 */
async function preencherCidadeSemDerrubar(contact, identidade) {
  try {
    await preencherCidadePeloSgp(contact, identidade.contracts);
  } catch (err) {
    console.error(`City autofill failed for contact ${contact.id}: ${mensagemSegura(err)}`);
  }
}

async function resolverIdentidade({ contact, ignorarTelefone = false }) {
  try {
    if (contact.sgpDocument) {
      const identidade = await porCpf(contact.sgpDocument, 'memory');
      await backfillPrimeiroNome(contact, identidade);
      // O endereço do contrato é a única fonte de cidade que temos; com ela o
      // aviso de falha regional passa a valer para quem nunca foi editado à
      // mão.
      await preencherCidadeSemDerrubar(contact, identidade);
      return identidade;
    }
    // ignorarTelefone: true depois de esquecer_identificacao (contestação do
    // nome) — buscar de novo pelo MESMO telefone cumprimentaria a mesma
    // pessoa errada outra vez. A memória (acima) continua valendo.
    if (ignorarTelefone) return vazio();
    // As duas formas do nono dígito são consultadas SEMPRE, e não só até a primeira achar
    // alguém: se levarem a cadastros diferentes no SGP, não dá para saber quem está falando.
    const achados = [];
    for (const telefone of variantesTelefone(contact.phoneNumber)) {
      const rec = await sgpClient.findClientRecord({ telefone });
      if (rec.total === 0) continue;
      if (!rec.cliente) return vazio();          // vários: não adivinha
      achados.push(rec.cliente);
    }
    if (achados.length === 0) return vazio();
    if (new Set(achados.map((c) => String(c.id))).size > 1) {
      // Cadastros diferentes nas duas formas do mesmo celular: não adivinha. Nenhum dado do
      // cliente vai ao log, só o fato.
      console.error(`Identity by phone skipped for contact ${contact.id}: the two ninth-digit forms match different SGP clients`);
      return vazio();
    }
    const [cliente] = achados;
    const identidade = await porCpf(cliente.cpfcnpj, 'phone');
    await setContactSgpLink(contact.id, {
      sgpClientId: cliente.id,
      sgpContractId: identidade.contracts.length === 1 ? identidade.contracts[0].id : null,
      sgpDocument: cliente.cpfcnpj,
      sgpFirstName: identidade.primeiroNome,
    });
    await preencherCidadeSemDerrubar(contact, identidade);
    return identidade;
  } catch (err) {
    if (contact.sgpDocument) {
      console.error(`Identity resolved from memory only (SGP unavailable) for contact ${contact.id}: ${mensagemSegura(err)}`);
      return porMemoriaSemSgp(contact);
    }
    console.error(`Identity resolution failed for contact ${contact.id}: ${mensagemSegura(err)}`);
    return vazio();
  }
}

module.exports = { resolverIdentidade, variantesTelefone, primeiroNome };
