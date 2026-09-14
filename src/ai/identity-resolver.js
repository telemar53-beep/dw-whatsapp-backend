const sgpClient = require('../integrations/sgp-client');
const { setContactSgpLink } = require('../conversations/contact.repository');
const { preencherCidadePeloSgp } = require('../cities/contact-city.service');
const { mensagemSegura } = require('./safe-error-log');

/**
 * Quem é o cliente, ANTES de o modelo falar. Ordem: memória (contato já
 * vinculado ao SGP) → telefone do WhatsApp no SGP → ninguém. O modelo só pede
 * CPF quando isto devolve 'none'.
 *
 * Nível 'forte' = telefone bateu (exatamente um cadastro) ou memória; a
 * confirmação leve é chamar pelo primeiro nome — se não for ele, ele diz.
 * CPF digitado por número desconhecido é 'fraca' e é elevado pela ferramenta
 * confirmar_nascimento; a elevação acontece dentro do turno, não aqui — mas a
 * identidade fraca em si volta por aqui nos turnos seguintes, via
 * documentoPendente (ai_triage_pending_document da conversa).
 *
 * dataNascimento fica neste objeto para a comparação em código. Nunca vai ao
 * modelo nem a log — o contexto do sistema só usa nivel/origem/primeiroNome.
 */
function primeiroNome(nome) {
  const token = String(nome || '').trim().split(/\s+/)[0];
  if (!token) return null;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/** '5598985120338' → ['98985120338', '9885120338']: sem o 55, e sem o 9º dígito. */
function variantesTelefone(numero) {
  let d = String(numero || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return [];
  const variantes = [d];
  if (d.length === 11 && d[2] === '9') variantes.push(d.slice(0, 2) + d.slice(3));
  return variantes;
}

function vazio() {
  return { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], client: null, dataNascimento: null, contestado: false, nascimentoTentado: false };
}

async function porCpf(cpf, origem) {
  const { client, contracts } = await sgpClient.lookupClientByCpf(cpf);
  let dataNascimento = null;
  try {
    const rec = await sgpClient.findClientRecord({ cpfcnpj: cpf });
    dataNascimento = rec.cliente ? rec.cliente.dataNascimento : null;
  } catch (err) {
    console.error(`Birth date lookup failed: ${mensagemSegura(err)}`);
  }
  return {
    nivel: 'forte', origem, primeiroNome: primeiroNome(client.name), contracts,
    client: { id: client.id, document: client.document }, dataNascimento,
    contestado: false, nascimentoTentado: false,
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
 * possível. Devolve a memória como identidade forte, sem contratos e sem data
 * de nascimento — o prompt da triagem vê sgpIndisponivel e proíbe boleto, PIX
 * e status, que dependeriam do SGP de qualquer jeito.
 */
function porMemoriaSemSgp(contact) {
  return {
    nivel: 'forte', origem: 'memory', primeiroNome: contact.sgpFirstName || null,
    contracts: [], client: { id: contact.sgpClientId || null, document: contact.sgpDocument },
    dataNascimento: null, contestado: false, nascimentoTentado: false, sgpIndisponivel: true,
  };
}

/**
 * O CPF que o cliente DIGITOU num turno anterior e que ainda não passou pela
 * data de nascimento. Reconstrói a identidade FRACA (porCpf devolve forte —
 * rebaixa aqui) sem tocar no contato: nada de setContactSgpLink, porque o
 * dono do CPF digitado pode não ser quem está no WhatsApp. Só
 * confirmar_nascimento persiste o vínculo.
 *
 * Sem isto (defeito A, teste real 2026-09-14), o turno seguinte devolvia
 * 'none' e o modelo pedia o CPF de novo — "me informe o CPF novamente".
 */
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

async function porDocumentoPendente(documentoPendente) {
  const identidade = await porCpf(documentoPendente, 'cpf');
  return { ...identidade, nivel: 'fraca', origem: 'cpf' };
}

async function resolverIdentidade({ contact, ignorarTelefone = false, documentoPendente = null }) {
  try {
    if (contact.sgpDocument) {
      const identidade = await porCpf(contact.sgpDocument, 'memory');
      await backfillPrimeiroNome(contact, identidade);
      // O endereço do contrato é a única fonte de cidade que temos; com ela o
      // aviso de falha regional passa a valer para quem nunca foi editado à
      // mão. Só nos caminhos FORTES: identidade fraca não encosta no contato.
      await preencherCidadeSemDerrubar(contact, identidade);
      return identidade;
    }
    // ignorarTelefone: true depois de esquecer_identificacao (contestação do
    // nome) — buscar de novo pelo MESMO telefone cumprimentaria a mesma
    // pessoa errada outra vez. A memória (acima) continua valendo.
    if (ignorarTelefone) {
      // `return await` de propósito (nos dois pontos): sem o await a promise
      // escaparia deste try/catch e uma falha do SGP viraria rejeição em vez
      // de vazio().
      if (documentoPendente) return await porDocumentoPendente(documentoPendente);
      return vazio();
    }
    for (const telefone of variantesTelefone(contact.phoneNumber)) {
      const rec = await sgpClient.findClientRecord({ telefone });
      if (rec.total === 0) continue;
      if (!rec.cliente) return vazio();          // vários: não adivinha
      const identidade = await porCpf(rec.cliente.cpfcnpj, 'phone');
      await setContactSgpLink(contact.id, {
        sgpClientId: rec.cliente.id,
        sgpContractId: identidade.contracts.length === 1 ? identidade.contracts[0].id : null,
        sgpDocument: rec.cliente.cpfcnpj,
        sgpFirstName: identidade.primeiroNome,
      });
      await preencherCidadeSemDerrubar(contact, identidade);
      return identidade;
    }
    if (documentoPendente) return await porDocumentoPendente(documentoPendente);
    return vazio();
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
