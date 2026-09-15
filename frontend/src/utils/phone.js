// "5598999991002" vira "+55 (98) 99999-1002"; número fora do padrão BR sai como veio.
export function formatPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const match = digits.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (!match) return phone;
  return `+55 (${match[1]}) ${match[2]}-${match[3]}`;
}
