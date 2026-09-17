const NAME_PATTERN = /^[a-z0-9_]+$/;

function isValidTemplateName(name) {
  return typeof name === 'string' && NAME_PATTERN.test(name);
}

function extractVariableCount(bodyText) {
  const matches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  if (matches.length === 0) return 0;
  const uniqueSorted = [...new Set(matches)].sort((a, b) => a - b);
  for (let i = 0; i < uniqueSorted.length; i += 1) {
    if (uniqueSorted[i] !== i + 1) {
      throw new Error('Template variables must be sequential starting at {{1}} with no gaps');
    }
  }
  return uniqueSorted.length;
}

const MAX_BUTTONS = 3;
const MAX_BUTTON_TEXT = 25;

// Limites da Meta, nao nossos. Barrar aqui e o que separa um erro imediato na
// tela de um template que fica PENDING e volta REJECTED horas depois, sem
// motivo legivel — e o atendente descobre isso no meio de um atendimento.
function validateQuickReplyButtons(buttons) {
  if (!buttons || buttons.length === 0) return;
  if (buttons.length > MAX_BUTTONS) {
    throw new Error(`Um template aceita no maximo ${MAX_BUTTONS} botoes de resposta rapida`);
  }
  const vistos = new Set();
  for (const texto of buttons) {
    if (typeof texto !== 'string' || !texto.trim()) {
      throw new Error('Todo botao precisa de um texto');
    }
    if (texto.length > MAX_BUTTON_TEXT) {
      throw new Error(`O texto do botao deve ter no maximo ${MAX_BUTTON_TEXT} caracteres`);
    }
    if (/\{\{\d+\}\}/.test(texto)) {
      throw new Error('O texto do botao nao aceita variaveis');
    }
    const chave = texto.trim().toLowerCase();
    if (vistos.has(chave)) {
      throw new Error('Os botoes nao podem ter textos repetidos');
    }
    vistos.add(chave);
  }
}

function substituteVariables(bodyText, variables) {
  return bodyText.replace(/\{\{(\d+)\}\}/g, (match, indexStr) => {
    const index = Number(indexStr) - 1;
    return variables[index] != null ? String(variables[index]) : match;
  });
}

module.exports = { validateQuickReplyButtons, isValidTemplateName, extractVariableCount, substituteVariables };
