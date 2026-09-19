/** Estado de entrada do compositor, com o que cada teste variar. */
function estadoBase(extra = {}) {
  return {
    config: { systemPrompt: 'Você é a assistente da empresa.', triageExtraInstructions: null, triageResolvedReasonId: null },
    identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
    contratos: [], triagem: { noturno: { ativo: false }, forcarConclusao: false },
    avisoCidade: null, empresa: 'Provedor X', ferramentas: ['buscar_cliente', 'concluir_triagem'],
    setores: [{ id: 's1', name: 'Suporte', aiHint: 'internet com problema' }],
    motivos: [{ id: 'r1', name: 'Lentidão' }],
    terceiro: null, agora: new Date('2026-09-17T14:00:00.000Z'),
    ...extra,
  };
}

module.exports = { estadoBase };
