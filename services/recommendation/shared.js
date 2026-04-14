export function lower(v) {
  return String(v || '').toLowerCase();
}

export function uniq(arr) {
  return [...new Set(arr)];
}

export function includesAny(text, words = []) {
  const t = lower(text);
  return words.some((w) => t.includes(lower(w)));
}

export function findFirstAliasKey(text, aliasMap) {
  const source = lower(text);
  for (const [key, aliases] of Object.entries(aliasMap || {})) {
    if ((aliases || []).some((a) => source.includes(lower(a)))) return key;
  }
  return null;
}

export function findAllAliasKeys(text, aliasMap) {
  const out = [];
  const source = lower(text);
  for (const [key, aliases] of Object.entries(aliasMap || {})) {
    if ((aliases || []).some((a) => source.includes(lower(a)))) out.push(key);
  }
  return uniq(out);
}

export function parsePrice(value) {
  const num = parseFloat(String(value || '0').replace(/,/g, ''));
  return Number.isFinite(num) ? Math.floor(num) : 0;
}

export function parseDateMs(v) {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? t : 0;
}

export function parseJsonObject(text = '') {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(text.slice(s, e + 1));
  } catch {
    return null;
  }
}

export function toBaseName(name = '') {
  return String(name || '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\b(1\+1|2\+1|3\+1)\b/gi, ' ')
    .replace(/\b(mini|미니|미니어처)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isPromoName(name = '') {
  const t = lower(name);
  return (
    t.includes('1+1') ||
    t.includes('2+1') ||
    t.includes('3+1') ||
    t.includes('미니') ||
    t.includes('mini') ||
    t.includes('증정') ||
    t.includes('기획') ||
    t.includes('한정')
  );
}

