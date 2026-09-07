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

function substituteVariables(bodyText, variables) {
  return bodyText.replace(/\{\{(\d+)\}\}/g, (match, indexStr) => {
    const index = Number(indexStr) - 1;
    return variables[index] != null ? String(variables[index]) : match;
  });
}

module.exports = { isValidTemplateName, extractVariableCount, substituteVariables };
