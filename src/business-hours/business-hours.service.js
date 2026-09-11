const TIMEZONE = 'America/Sao_Paulo';

function getSaoPauloParts(date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday').value;
  let hour = Number(parts.find((p) => p.type === 'hour').value);
  const minute = Number(parts.find((p) => p.type === 'minute').value);
  if (hour === 24) hour = 0;
  return { weekday, hour, minute };
}

function timeStringToMinutes(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}

function isOutsideBusinessHours(config, now = new Date()) {
  const { weekday, hour, minute } = getSaoPauloParts(now);
  if (weekday === 'Sat' || weekday === 'Sun') return true;
  const nowMinutes = hour * 60 + minute;
  return nowMinutes < timeStringToMinutes(config.startTime) || nowMinutes >= timeStringToMinutes(config.endTime);
}

module.exports = { isOutsideBusinessHours };
