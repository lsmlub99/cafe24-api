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

function normalizeForFuzzyMatch(text = '') {
  return lower(text).replace(/[\s_\-()[\]{}.,!?'"]/g, '');
}

function levenshteinDistance(a = '', b = '') {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const dp = new Array(bl + 1);
  for (let j = 0; j <= bl; j += 1) dp[j] = j;
  for (let i = 1; i <= al; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= bl; j += 1) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[bl];
}

// Typo/spacing-tolerant substring check: exact substring first, then a sliding
// fixed-length window edit-distance scan so slight typos in product names still
// match. Levenshtein distance already tolerates insertions/deletions on its own,
// so a single window length (== needle length) is enough — scanning a range of
// window lengths as well was redundant and multiplied the cost for no benefit.
export function fuzzyIncludes(haystack, needle, maxDistanceRatio = 0.25) {
  const h = normalizeForFuzzyMatch(haystack);
  const n = normalizeForFuzzyMatch(needle);
  if (!h || !n) return false;
  if (h.includes(n)) return true;
  if (n.length < 3 || h.length < n.length) return false;

  const maxDist = Math.max(1, Math.floor(n.length * maxDistanceRatio));
  for (let i = 0; i <= h.length - n.length; i += 1) {
    const window = h.slice(i, i + n.length);
    if (levenshteinDistance(window, n) <= maxDist) return true;
  }
  return false;
}

export function findFirstAliasKey(text, aliasMap) {
  const source = lower(text);
  let bestKey = null;
  let bestAliasLength = -1;
  for (const [key, aliases] of Object.entries(aliasMap || {})) {
    for (const alias of aliases || []) {
      const normalizedAlias = lower(alias);
      if (!normalizedAlias) continue;
      if (!source.includes(normalizedAlias)) continue;
      if (normalizedAlias.length > bestAliasLength) {
        bestAliasLength = normalizedAlias.length;
        bestKey = key;
      }
    }
  }
  return bestKey;
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
const K_COLLAB = '\uCF5C\uB77C\uBCF4';
const K_MARKET = '\uB9C8\uCF13';
const K_POPUP = '\uD31D\uC5C5';

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
  K_COLLAB,
  'collab',
  K_MARKET,
  'market',
  K_POPUP,
  'pop-up',
  'pop up',
];

const PROMO_PATTERN = new RegExp(
  [
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
    K_COLLAB,
    'collab',
    K_MARKET,
    'market',
    K_POPUP,
    '(^|\\s)x(\\s|$)', // standalone "X" denotes a brand collab (e.g. "\uC140\uD4E8\uC804\uC528 X \uB77D\uCC44\uC740")
  ].join('|'),
  'i'
);

export function toDisplayName(name = '') {
  const cleaned = String(name || '').replace(/^(\[[^\]]*\]\s*)+/, '').trim();
  return cleaned || String(name || '').trim();
}

export function toBaseName(name = '') {
  return String(name || '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\b(1\+1|2\+1|3\+1)\b/gi, ' ')
    .replace(/\b(mini|miniature|sample|trial|set|bundle|promo|event)\b/gi, ' ')
    .replace(new RegExp(`(${K_MINIATURE}|${K_MINI}|${K_SAMPLE}|${K_GIFT}|${K_PLAN}|${K_SET}|${K_LIMITED_EDITION}|${K_LIMITED})`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Quantity bundle prefix like [1+1], [1+1+1], [2+1] — these are real products, not samples/gifts
export const BUNDLE_PREFIX_RE = /\[(?:\d+\+)+\d+\]/;

export function hasExplicitCreamFormPhrase(text = '') {
  const src = String(text || '').toLowerCase();
  if (!src) return false;
  return ['크림 타입', '크림형', '크림 제형', '선케어 크림', 'cream type', 'cream-form', 'cream form'].some((token) =>
    src.includes(token)
  );
}

export function isPromoName(name = '') {
  const t = String(name || '');
  if (BUNDLE_PREFIX_RE.test(t)) return false;
  const lowered = lower(t);
  if (PROMO_PATTERN.test(t)) return true;
  return PROMO_TOKENS.some((token) => lowered.includes(lower(token)));
}
