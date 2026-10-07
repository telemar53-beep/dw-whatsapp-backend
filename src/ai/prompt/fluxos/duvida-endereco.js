// Dúvida de endereço (revisão do pedido por endereço v4, 07/10/2026, achado A4): a dúvida gravada sobre de qual endereço
// (contrato dele) é a cobrança. Antes, a instrução sem documento só chegava ao modelo na recusa de uma ferramenta de cobrança;
// se ele respondesse sem chamar nenhuma, só via a regra geral de terceiros, que manda pedir o CPF quando o cliente cita "a
// fatura do [nome]" — e "a rua do João" se lê assim. Entra só com a dúvida gravada (escopo pendente sem contrato de terceiro).
//
// Fica depois dos fluxos gerais: é o fato específico do turno e vence a ordem geral de pedir o documento. Nada é liberado por
// este texto: a cobrança continua travada em código até o contrato ser identificado ou o alvo esclarecido.
const DUVIDAS_DE_ENDERECO = new Set(['endereco_ambiguo', 'endereco_desconhecido']);

module.exports = {
  nome: 'duvida-endereco',
  entra(estado) {
    const t = estado.terceiro;
    return Boolean(t) && DUVIDAS_DE_ENDERECO.has(t.alvoPendente) && (t.contratos || []).length === 0;
  },
  linhas() {
    return [
      '',
      'DÚVIDA DE ENDEREÇO: ele pediu uma cobrança e não ficou claro de qual endereço (contrato dele) ela é. Isso NÃO é pedido de outra pessoa: NÃO peça CPF ou CNPJ e NÃO envie nada até ele dizer de qual endereço é. Pergunte, curto, de qual endereço é a cobrança, citando o endereço completo (com o número) de cada contrato dele. Só se ele disser que a cobrança é de outra pessoa, siga as regras de pedido de outra pessoa.',
    ];
  },
};
