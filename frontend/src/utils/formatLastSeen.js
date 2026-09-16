function pad(n) {
  return String(n).padStart(2, '0');
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "hoje às 08:37", "ontem às 21:14" ou "12/09 às 09:05", no fuso do navegador.
// Sem registro → null (quem chama decide o texto).
export function formatLastSeen(value, now = new Date()) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay(date, now)) return `hoje às ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `ontem às ${time}`;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} às ${time}`;
}
