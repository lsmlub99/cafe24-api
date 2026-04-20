import { includesAny, findFirstAliasKey, findAllAliasKeys, uniq, lower } from './shared.js';

const PRICE_REGEX = /(\d{1,3})(\s?만원|\s?원)/g;

const NEGATIVE_SCOPE_CATEGORY_WORDS = ['카테고리', '전체가', '아예'];
const NEGATIVE_SCOPE_PRODUCT_WORDS = ['이거', '지금', '방금', '이 제품'];
const CATEGORY_EXIT_WORDS = [
  '아예 다른 카테고리',
  '카테고리 바꿔',
  '카테고리 변경',
  '선크림 말고 다른',
  '선케어 말고 다른',
  '전혀 다른 카테고리',
];
const VARIETY_WORDS = ['다른', '다른건', '다른 거', '말고', '또 뭐', '또 있', '없나요', '없어?', 'other option'];

const CONCERN_NORMALIZATION = [
  { key: 'sebum_control', words: ['유분', '번들', '피지', '기름짐', '번들거'] },
  { key: 'hydration', words: ['건조', '당김', '수분 부족', '속건조', '보습'] },
  { key: 'soothing', words: ['따가', '자극', '화끈', '붉어', '눈시림', '민감'] },
  { key: 'tone_up', words: ['톤업', '잡티', '커버', '톤 보정'] },
  { key: 'not_fit', words: ['안 맞', '별로', '불편', '실패', '못 쓰겠'] },
];

const FIT_ISSUE_NORMALIZATION = [
  { key: 'irritation', words: ['따가', '자극', '화끈', '붉어'] },
  { key: 'pilling', words: ['밀림', '밀려', '뭉침', '겉돌'] },
  { key: 'eye_sting', words: ['눈시림', '눈 따가'] },
  { key: 'breakout', words: ['트러블', '좁쌀', '여드름'] },
  { key: 'heavy_feel', words: ['답답', '무거'] },
  { key: 'oily_residue', words: ['번들', '유분', '기름짐'] },
];

function parsePriceIntent(text = '') {
  const src = String(text || '');
  let matched = null;
  let m;
  while ((m = PRICE_REGEX.exec(src)) !== null) matched = m;
  PRICE_REGEX.lastIndex = 0;
  if (!matched) return null;

  const amount = Number.parseInt(matched[1], 10);
  const unit = matched[2] || '';
  if (!Number.isFinite(amount)) return null;
  return unit.includes('만')
    ? { max_price_krw: amount * 10000, raw: matched[0] }
    : { max_price_krw: amount, raw: matched[0] };
}

function normalizeSemanticSignals(text = '') {
  const src = lower(text);
  const concern = [];
  const fit_issue = [];

  for (const rule of CONCERN_NORMALIZATION) {
    if (rule.words.some((w) => src.includes(lower(w)))) concern.push(rule.key);
  }
  for (const rule of FIT_ISSUE_NORMALIZATION) {
    if (rule.words.some((w) => src.includes(lower(w)))) fit_issue.push(rule.key);
  }

  return {
    concern: uniq(concern),
    fit_issue: uniq(fit_issue.length ? fit_issue : src.trim() ? [] : []),
  };
}

function detectNegativeScope(query = '', requestedCategory = '') {
  const q = lower(query);
  const { concern, fit_issue } = normalizeSemanticSignals(q);
  const hasNegative = concern.includes('not_fit') || fit_issue.length > 0;
  if (!hasNegative) return null;
  if (includesAny(q, NEGATIVE_SCOPE_CATEGORY_WORDS)) return 'category';
  if (includesAny(q, NEGATIVE_SCOPE_PRODUCT_WORDS)) return 'product';
  if (requestedCategory && q.includes(lower(requestedCategory))) return 'form';
  return 'form';
}

function detectSortIntent(parsedIntent, query, taxonomy, contextText = '') {
  const q = lower(query);
  const context = lower(contextText || q);
  if (parsedIntent.novelty_request || includesAny(context, taxonomy.noveltyKeywords || [])) return 'new_arrival';
  if (parsedIntent.popularity_intent || includesAny(context, taxonomy.popularityKeywords || [])) return 'popular';
  if (parsedIntent.preference.length || parsedIntent.situation.length || parsedIntent.skin_type || parsedIntent.concern.length) {
    return 'condition_based';
  }
  return 'popular';
}

function detectSensitivitySignal(query = '', concern = [], fitIssue = []) {
  if (concern.includes('soothing')) return 'irritation';
  if (fitIssue.includes('irritation') || fitIssue.includes('eye_sting') || fitIssue.includes('breakout')) return 'irritation';
  if (includesAny(query, ['민감', '자극', '따가'])) return 'irritation';
  return null;
}

export function parseUserIntent(args = {}, taxonomy) {
  const q = `${args.q || ''} ${args.query || ''}`.trim();
  const concernsText = Array.isArray(args.concerns) ? args.concerns.join(' ') : '';
  const categoryText = `${args.category || ''} ${q}`.trim();
  const formText = `${args.form || ''} ${args.category || ''} ${q}`.trim();
  const fullSignalText = `${q} ${concernsText} ${args.category || ''}`.trim();

  const requestedCategory = findFirstAliasKey(categoryText, taxonomy.categories);
  const requestedForm = findFirstAliasKey(formText, taxonomy.forms);
  const skinTypeFromField = findFirstAliasKey(args.skin_type || '', taxonomy.skinTypes);
  const skinTypeFromQuery = findFirstAliasKey(q, taxonomy.skinTypes);
  const skinType = skinTypeFromField || skinTypeFromQuery || null;

  const aliasConcern = uniq([
    ...findAllAliasKeys(concernsText, taxonomy.concerns),
    ...findAllAliasKeys(q, taxonomy.concerns),
  ]);
  const normalizedSignals = normalizeSemanticSignals(fullSignalText);
  const concern = uniq([...aliasConcern, ...normalizedSignals.concern]);
  const fitIssue = uniq(normalizedSignals.fit_issue);

  const situation = findAllAliasKeys(q, taxonomy.situations);
  const preference = findAllAliasKeys(q, taxonomy.preferences);
  const noveltyRequest = includesAny(q, taxonomy.noveltyKeywords || []);
  const popularityIntent = includesAny(q, taxonomy.popularityKeywords || []);
  const varietyIntent = includesAny(q, VARIETY_WORDS);
  const priceIntent = parsePriceIntent(q);
  const explicitFormRequest = Boolean(requestedForm);
  const negativeScope = detectNegativeScope(fullSignalText, requestedCategory);
  const allowCategorySwitch = includesAny(fullSignalText, CATEGORY_EXIT_WORDS);
  const sensitivitySignal = detectSensitivitySignal(fullSignalText, concern, fitIssue);

  const contextText = [q, args.category || '', args.skin_type || '', concernsText].join(' ');

  const parsed = {
    requested_category: requestedCategory,
    requested_category_ids: Array.isArray(args.target_category_ids) ? args.target_category_ids : [],
    requested_form: requestedForm,
    explicit_form_request: explicitFormRequest,
    skin_type: skinType,
    concern,
    situation,
    preference,
    novelty_request: noveltyRequest,
    popularity_intent: popularityIntent,
    variety_intent: varietyIntent,
    price_intent: priceIntent,
    sensitivity_signal: sensitivitySignal,
    fit_issue: fitIssue,
    negative_scope: negativeScope,
    allow_category_switch: allowCategorySwitch,
    sort_intent: 'popular',
    query: q,
  };

  if (
    (fitIssue.includes('irritation') || fitIssue.includes('eye_sting') || fitIssue.includes('breakout')) &&
    !parsed.concern.includes('soothing')
  ) {
    parsed.concern.push('soothing');
  }

  parsed.sort_intent = detectSortIntent(parsed, q, taxonomy, contextText);
  return parsed;
}
