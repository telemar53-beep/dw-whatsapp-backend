const { listWabaPhoneNumbers, listWabaSubscribedApps } = require('../whatsapp-adapters/meta-cloud.adapter');
const { motivoDaMeta } = require('../whatsapp-adapters/meta-error');

// Confere um cadastro de canal Meta Cloud contra a propria Meta ANTES de
// gravar, do jeito que o 360dialog ja faz ao registrar o webhook. Sem isso o
// canal nasce "conectado" com qualquer dado, e o erro so aparece quando o
// cliente manda mensagem e nada chega.
//
// Duas consultas cobrem os quatro campos: /phone_numbers valida de uma vez o
// Access Token, o WABA ID, o Phone Number ID e o Telefone; /subscribed_apps
// pega o passo que e facil esquecer num numero novo - a inscricao no webhook e
// POR WABA, entao ter inscrito a WABA anterior nao vale para esta.

function soDigitos(telefone) {
  return String(telefone || '').replace(/\D/g, '');
}

function motivoOuRecado(err) {
  return (
    motivoDaMeta(err.response && err.response.data && err.response.data.error) ||
    'Não foi possível conferir os dados com a Meta. Tente de novo em instantes.'
  );
}

async function checkMetaCloudSetup({ phoneNumberId, accessToken, wabaId, phoneNumber }) {
  let numeros;
  try {
    numeros = await listWabaPhoneNumbers(wabaId, accessToken);
  } catch (err) {
    return { ok: false, error: motivoOuRecado(err) };
  }

  const numero = numeros.find((n) => n.id === phoneNumberId);
  if (!numero) {
    return { ok: false, error: 'Esse Phone Number ID não pertence à WABA informada — confira os dois no painel da Meta.' };
  }
  if (soDigitos(numero.display_phone_number) !== soDigitos(phoneNumber)) {
    return { ok: false, error: `Esse Phone Number ID é do número ${numero.display_phone_number}, não do que você digitou.` };
  }

  let apps;
  try {
    apps = await listWabaSubscribedApps(wabaId, accessToken);
  } catch (err) {
    return { ok: false, error: motivoOuRecado(err) };
  }
  if (apps.length === 0) {
    return {
      ok: false,
      error:
        'Nenhum app está inscrito no webhook dessa WABA, então as mensagens não chegariam. Inscreva o app na conta do WhatsApp no painel da Meta e cadastre de novo.',
    };
  }

  return { ok: true };
}

module.exports = { checkMetaCloudSetup };
