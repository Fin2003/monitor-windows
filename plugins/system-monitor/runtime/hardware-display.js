function stripHardwareBrand(value) {
  const text = String(value || '').trim();
  if (!text) return text;

  const trimLeadingBrand = name => name
    .replace(/^AMD\s+/i, '')
    .replace(/^NVIDIA\s+/i, '')
    .replace(/^Total\s+(?=Memory\b)/i, '')
    .replace(/^总计\s*(?=内存)/, '')
    .trim();

  const labeled = text.match(/^(.*?\s*[·•:：]\s*)(.+)$/u);
  if (labeled) return `${labeled[1]}${trimLeadingBrand(labeled[2])}`.trim();
  return trimLeadingBrand(text);
}

module.exports = { stripHardwareBrand };
