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

const K_MINI = '\uBBF8\uB2C8';
const K_MINIATURE = '\uBBF8\uB2C8\uC5B4\uCC98';
const K_SAMPLE = '\uC0D8\uD50C';
const K_TRIAL = '\uD2B8\uB77C\uC774\uC5BC';
const K_GIFT = '\uC99D\uC815';
const K_PLAN = '\uAE30\uD68D';
const K_SET = '\uC138\uD2B8';
const K_LIMITED = '\uD55C\uC815';
const K_LIMITED_EDITION = '\uD55C\uC815\uD310';

const PROMO_TOKENS = [
  '1+1',
  '2+1',
  '3+1',
  'mini',
  'miniature',
  K_MINI,
  K_MINIATURE,
  K_SAMPLE,
  K_TRIAL,
  'trial',
  'sample',
  K_GIFT,
  K_PLAN,
  K_SET,
  'bundle',
  K_LIMITED,
  K_LIMITED_EDITION,
  'event',
  'promo',
];

const PROMO_PATTERN = new RegExp(
  [
    '\\[(?:[^\\]]*?)\\]',
    '1\\+1',
    '2\\+1',
    '3\\+1',
    'mini',
    'miniature',
    K_MINI,
    K_MINIATURE,
    K_SAMPLE,
    K_TRIAL,
    K_GIFT,
    K_PLAN,
    K_SET,
    K_LIMITED,
    K_LIMITED_EDITION,
    'sample',
    'trial',
    'bundle',
    'promo',
    'event',
  ].join('|'),
  'i'
);

export function toBaseName(name = '') {
  return String(name || '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\b(1\+1|2\+1|3\+1)\b/gi, ' ')
    .replace(/\b(mini|miniature|sample|trial|set|bundle|promo|event)\b/gi, ' ')
    .replace(new RegExp(`(${K_MINIATURE}|${K_MINI}|${K_SAMPLE}|${K_GIFT}|${K_PLAN}|${K_SET}|${K_LIMITED_EDITION}|${K_LIMITED})`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isPromoName(name = '') {
  const t = String(name || '');
  const lowered = lower(t);
  if (PROMO_PATTERN.test(t)) return true;
  return PROMO_TOKENS.some((token) => lowered.includes(lower(token)));
}

