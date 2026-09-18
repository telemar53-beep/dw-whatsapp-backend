// Renderiza os prompts em arquivo para revisão humana, sem subir nada nem
// chamar a OpenAI. Uso: node scripts/dump-prompt.js [pasta]
const fs = require('fs');
const path = require('path');
const { montarContexto } = require('../src/ai/prompt/montar');
// FERRAMENTAS_TRIAGEM e FERRAMENTAS_TRIAGEM_NOTURNO já são exportadas por
// ai-orchestrator.js. Desde a Task 18 ele não tem mais construtor próprio de
// prompt: o contexto da triagem vem deste mesmo montarContexto, então o que
// este script renderiza é literalmente o que a produção manda à OpenAI.
const { FERRAMENTAS_TRIAGEM, FERRAMENTAS_TRIAGEM_NOTURNO } = require('../src/ai/ai-orchestrator');

const CENARIOS = {
  'nao-identificado': { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
  identificado: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [{ id: 1 }], contestado: false },
};

// Setores, motivos e os dois textos do painel são exemplos: em produção vêm do
// banco. O que este script serve para conferir é o que o CÓDIGO acrescenta.
function estadoDe(identidade, noturno) {
  return {
    config: {
      systemPrompt: '[Prompt do sistema do painel]',
      triageExtraInstructions: '[Instruções adicionais da operação do painel]',
      triageResolvedReasonId: null,
      triageReadReceiptsDaytime: false,
    },
    identidade,
    contratos: identidade.nivel === 'forte'
      ? [{ id: 1, plano: 'Plano exemplo', velocidade: '000 Mega', endereco: '[endereço]', status: 'ativo' }]
      : [],
    triagem: { noturno: { ativo: noturno, retornoAs: '08:00' }, forcarConclusao: false, threshold: 0.8, maxQuestions: 2, attempts: 0 },
    avisoCidade: null,
    empresa: '[Empresa]',
    ferramentas: noturno ? FERRAMENTAS_TRIAGEM_NOTURNO : FERRAMENTAS_TRIAGEM,
    setores: [{ id: 's1', name: '[Setor 1]', aiHint: '[dica do setor]' }],
    motivos: [{ id: 'r1', name: '[Motivo 1]' }],
    terceiro: null,
    agora: new Date(),
  };
}

const destino = process.argv[2] || path.join(__dirname, '..', 'output', 'prompt');
fs.mkdirSync(destino, { recursive: true });

for (const [nome, identidade] of Object.entries(CENARIOS)) {
  for (const noturno of [false, true]) {
    if (nome === 'nao-identificado' && noturno) continue;
    const texto = montarContexto(estadoDe(identidade, noturno));
    const arquivo = path.join(destino, `${nome}${noturno ? '-noturno' : ''}.txt`);
    fs.writeFileSync(arquivo, texto, 'utf8');
    console.log(`${arquivo} — ${texto.length} caracteres`);
  }
}
