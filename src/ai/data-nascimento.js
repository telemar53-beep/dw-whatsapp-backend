/**
 * Data de nascimento em qualquer formato comum → 'AAAA-MM-DD', ou null.
 *
 * Mora num módulo próprio porque os dois lados da conferência precisam dela e
 * precisam concordar: o que o CLIENTE digita no chat (tool-registry.js,
 * confirmar_nascimento) e o que o SGP devolve no cadastro (sgp-client.js,
 * findClientRecord). Sem dependências — não há como formar ciclo de require.
 *
 * Formatos aceitos: AAAA-MM-DD, AAAA-MM-DDTHH:mm:ss… (corta no T, que é como
 * alguns cadastros do SGP vêm), DD/MM/AAAA, DD-MM-AAAA, DD.MM.AAAA e as
 * variantes com um dígito ou ano de dois dígitos. Qualquer outra coisa é null:
 * chutar uma data aqui seria confirmar identidade errada.
 */
function normalizarDataNascimento(texto) {
  if (typeof texto !== 'string') return null;
  // Corta a parte de hora antes de qualquer regra: '2001-05-10T00:00:00' e
  // '2001-05-10T03:00:00.000Z' são a mesma data para a conferência.
  const t = texto.trim().split('T')[0].trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 3) return null;
  // Ano de dois dígitos: acima de 30 é 19xx (ninguém nasceu em 2031).
  if (y.length === 2) y = (Number(y) > 30 ? '19' : '20') + y;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

module.exports = { normalizarDataNascimento };
