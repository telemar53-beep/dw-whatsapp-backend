// De onde vêm preço, planos e cobertura NESTE turno.
//
// Mora num lugar só porque cinco módulos do compositor falam do assunto —
// principios, fatos, painel, comercial-novo, comercial-cliente e
// suporte-geral. Com a checagem repetida em cada um, bastava esquecer de
// atualizar um para o prompt sair com duas ordens conflitantes sobre a mesma
// coisa, que foi exatamente o defeito corrigido em 2026-09-22.
//
// A disponibilidade é conferida POR FERRAMENTA, nunca em bloco: mandar chamar
// uma ferramenta ausente do perfil é o jeito conhecido de o modelo afirmar que
// consultou. Quando falta, o caminho antigo (as instruções da operação)
// continua valendo — sem inventar consulta nem resultado.
function temFerramenta(estado, nome) {
  const disponiveis = estado && Array.isArray(estado.ferramentas) ? estado.ferramentas : [];
  return disponiveis.includes(nome);
}

function fontesComerciais(estado) {
  return {
    planos: temFerramenta(estado, 'consultar_planos'),
    cobertura: temFerramenta(estado, 'verificar_cobertura'),
  };
}

module.exports = { temFerramenta, fontesComerciais };
