import { includesAny, findFirstAliasKey, findAllAliasKeys, uniq, lower } from './shared.js';

const PRICE_REGEX = /(\d{1,3})(\s?만원|\s?만\s?원|\s?원)/g;
const IRRITATION_WORDS = [
  '\uB530\uAC00', // 따가
  '\uC790\uADF9', // 자극
  '\uB208\uC2DC\uB9BC', // 눈시림
  '\uD2B8\uB7EC\uBE14', // 트러블
  '\uC548 \uB9DE', // 안 맞
  '\uD654\uB048', // 화끈
  '\uAC04\uC9C0\uB7EC', // 간지러
];
const VARIETY_WORDS = ['다른', '다른거', '다른 건', '말고', '또 뭐', '더 있', '없나요', '없어?', 'other option'];
const PRODUCT_NEGATIVE_SCOPE_WORDS = ['이거', '이 제품', '지금 쓰는', '현재 쓰는', '이 선크림', '방금 추천'];
const CATEGORY_NEGATIVE_SCOPE_WORDS = ['자체가', '다 안', '전부 안', '전체가 안', '카테고리'];
const CATEGORY_EXIT_WORDS = [
  '아예 다른 카테고리',
  '카테고리 바꿔',
  '카테고리 변경',
  '선케어 말고 토너',
  '선크림 말고 토너',
  '선케어 말고 세럼',
  '선크림 말고 세럼',
  '완전 다른 카테고리',
];

function detectNegativeScope(query = '', requestedCategory = '') {
  const q = lower(query);
  const hasNegative = includesAny(q, IRRITATION_WORDS) || includesAny(q, ['안 맞', '안맞', '실패', '별로', '밀림', '뜨']);
  if (!hasNegative) return null;
  if (includesAny(q, CATEGORY_NEGATIVE_SCOPE_WORDS)) return 'category';
  if (includesAny(q, PRODUCT_NEGATIVE_SCOPE_WORDS)) return 'product';
  if (requestedCategory && includesAny(q, [requestedCategory])) return 'form';
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

function parsePriceIntent(text = '') {
  const src = String(text || '');
  let matched = null;
  let m;
  while ((m = PRICE_REGEX.exec(src)) !== null) {
    matched = m;
  }
  PRICE_REGEX.lastIndex = 0;
  if (!matched) return null;

  const amount = Number.parseInt(matched[1], 10);
  const unit = matched[2] || '';
  if (!Number.isFinite(amount)) return null;
  if (unit.includes('\uB9CC')) {
    return { max_price_krw: amount * 10000, raw: matched[0] };
  }
  return { max_price_krw: amount, raw: matched[0] };
}

function detectSensitivitySignal(q = '', concern = []) {
  if (concern.includes('soothing')) return 'irritation';
  if (includesAny(q, IRRITATION_WORDS)) return 'irritation';
  return null;
}

export function parseUserIntent(args = {}, taxonomy) {
  const q = `${args.q || ''} ${args.query || ''}`.trim();
  const categoryText = `${args.category || ''} ${q}`.trim();
  const formText = `${args.form || ''} ${args.category || ''} ${q}`.trim();

  const requestedCategory = findFirstAliasKey(categoryText, taxonomy.categories);
  const requestedForm = findFirstAliasKey(formText, taxonomy.forms);
  const skinTypeFromField = findFirstAliasKey(args.skin_type || '', taxonomy.skinTypes);
  const skinTypeFromQuery = findFirstAliasKey(q, taxonomy.skinTypes);
  const skinType = skinTypeFromField || skinTypeFromQuery || null;

  const concern = uniq([
    ...findAllAliasKeys(Array.isArray(args.concerns) ? args.concerns.join(' ') : '', taxonomy.concerns),
    ...findAllAliasKeys(q, taxonomy.concerns),
  ]);
  const situation = findAllAliasKeys(q, taxonomy.situations);
  const preference = findAllAliasKeys(q, taxonomy.preferences);
  const noveltyRequest = includesAny(q, taxonomy.noveltyKeywords || []);
  const popularityIntent = includesAny(q, taxonomy.popularityKeywords || []);
  const varietyIntent = includesAny(q, VARIETY_WORDS);
  const priceIntent = parsePriceIntent(q);
  const sensitivitySignal = detectSensitivitySignal(q, concern);
  const explicitFormRequest = Boolean(requestedForm);
  const negativeScope = detectNegativeScope(q, requestedCategory);
  const allowCategorySwitch = includesAny(q, CATEGORY_EXIT_WORDS);

  const contextText = [
    q,
    args.category || '',
    args.skin_type || '',
    Array.isArray(args.concerns) ? args.concerns.join(' ') : '',
  ].join(' ');

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
    fit_issue: [],
    negative_scope: negativeScope,
    allow_category_switch: allowCategorySwitch,
    sort_intent: 'popular',
    query: q,
  };

  parsed.sort_intent = detectSortIntent(parsed, q, taxonomy, contextText);
  return parsed;
}
