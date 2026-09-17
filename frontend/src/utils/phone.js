// "5598999991002" vira "+55 (98) 99999-1002"; número fora do padrão BR sai como veio.
//
// Os prefixos não geográficos (0300, 0500, 0800, 0900) vêm antes da regra de
// DDD: neles o prefixo tem três dígitos, e a regra de DDD, que assume dois,
// cortava no lugar errado — o canal do 0800 445 4546 aparecia na lista como
// "+55 (80) 0445-4546".
const NAO_GEOGRAFICO = /^55(300|500|800|900)(\d{3})(\d{4})$/;
const BRASILEIRO = /^55(\d{2})(\d{4,5})(\d{4})$/;

export function formatPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const especial = digits.match(NAO_GEOGRAFICO);
  if (especial) {
    return `0${especial[1]} ${especial[2]} ${especial[3]}`;
  }
  const match = digits.match(BRASILEIRO);
  if (!match) return phone;
  return `+55 (${match[1]}) ${match[2]}-${match[3]}`;
}
