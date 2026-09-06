function findMatchingOption(options, replyText) {
  const trimmed = (replyText || '').trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const sorted = [...options].sort((a, b) => a.optionNumber - b.optionNumber);
  return (
    sorted.find((option) => {
      if (trimmed === String(option.optionNumber)) return true;
      return (option.keywords || []).some((keyword) => lower.includes(keyword.toLowerCase()));
    }) || null
  );
}

module.exports = { findMatchingOption };
