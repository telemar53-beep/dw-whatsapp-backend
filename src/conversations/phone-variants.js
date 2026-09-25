// Brazilian mobiles gained a ninth digit, but plenty of WhatsApp accounts are still
// registered under the old 8-digit form (or vice versa). Given the digits the attendant
// typed, return the candidate forms to ask WhatsApp about, typed form first.
// [6-9] is safe here: Brazilian landlines start with 2-5, so an 8-digit landline never
// matches the "add a 9" branch and is left untouched.
//
// Mora aqui, e não no baileys.manager, porque a rota de disparo do SGP (Meta) e a
// identificação por telefone da IA precisam da mesma regra sem carregar o Baileys:
// no gateway da Meta o wa_id brasileiro fora dos DDDs 11-19/21/22/24/27/28 costuma
// vir na forma antiga, sem o 9, e o disparo e a resposta do mesmo celular caíam em
// dois contatos (Fase 0 de 25/09/2026: 226 pares em produção).
function brazilianNumberVariants(digits) {
  const withNine = digits.match(/^55(\d{2})9(\d{8})$/);
  if (withNine) {
    const [, ddd, rest8] = withNine;
    return [digits, `55${ddd}${rest8}`];
  }
  const withoutNine = digits.match(/^55(\d{2})([6-9]\d{7})$/);
  if (withoutNine) {
    const [, ddd, rest8] = withoutNine;
    return [digits, `55${ddd}9${rest8}`];
  }
  return [digits];
}

module.exports = { brazilianNumberVariants };
