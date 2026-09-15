// Espelho de parseRecipients em src/api/campaigns.routes.js — só para a
// revisão mostrar contagens; o backend continua sendo a fonte de verdade.
export function parseRecipients(raw) {
  const lines = (raw || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const seen = new Set();
  const valid = [];
  let duplicates = 0;
  let invalid = 0;
  for (const line of lines) {
    const [phonePart, ...nameParts] = line.split(',');
    const phoneNumber = (phonePart || '').trim().replace(/\D/g, '');
    const displayName = nameParts.join(',').trim() || null;
    if (!phoneNumber) { invalid += 1; continue; }
    if (seen.has(phoneNumber)) { duplicates += 1; continue; }
    seen.add(phoneNumber);
    valid.push({ phoneNumber, displayName });
  }
  return { valid, duplicates, invalid };
}
