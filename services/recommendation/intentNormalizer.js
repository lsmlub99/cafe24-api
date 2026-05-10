import { parseJsonObject } from './shared.js';

const ALLOWED = {
  requested_category: ['sunscreen', 'toner', 'serum', 'cream', 'cushion', 'bb', 'cleansing', 'mask', 'inner'],
  requested_form: ['cream', 'lotion', 'serum', 'stick', 'spray', 'cushion', 'toner', 'mist', 'other'],
  sort_intent: ['popular', 'condition_based', 'new_arrival'],
  skin_type: ['dry', 'oily', 'combination', 'sensitive'],
  concern: ['hydration', 'soothing', 'sebum_control', 'tone_up', 'uv_protection', 'not_fit'],
  situation: ['outdoor', 'makeup_before', 'daily'],
  preference: ['lightweight', 'moisturizing', 'low_white_cast'],
  fit_issue: ['irritation', 'pilling', 'eye_sting', 'breakout', 'heavy_feel', 'oily_residue', 'unknown'],
  negative_scope: ['product', 'form', 'category'],
  product_keyword_constraints: [
    '\uC544\uCFE0\uC544\uD2F0\uCE74',
    '\uB354\uB9C8 \uB9B4\uB9AC\uD504',
    '\uC5B4\uB4DC\uBC24\uC2A4\uB4DC \uD074\uB9AC\uC5B4',
    '\uB808\uC774\uC800 UV',
    '\uC5D0\uC5B4\uB9AC \uD54F',
    '\uC7A1\uD2F0 \uD1A0\uB2DD',
    '\uCFFC\uB9C1',
    '\uD3EC\uC5B4',
    '\uC2DC\uCE74',
  ],
};

function sanitizeArray(input, allowed) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const set = new Set(allowed);
  for (const item of input) {
    const v = String(item || '').trim();
    if (set.has(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

function sanitizeEnum(value, allowed) {
  const v = String(value || '').trim();
  return allowed.includes(v) ? v : null;
}

function hasExplicitCreamFormPhrase(text = '') {
  const src = String(text || '').toLowerCase();
  if (!src) return false;
  return [
    '크림 타입',
    '크림형',
    '크림 제형',
    '선케어 크림',
    'cream type',
    'cream-form',
    'cream form',
  ].some((token) => src.includes(token));
}

function sanitizeStringArray(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const item of input) {
    const v = String(item || '').trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function mergeIntent(base = {}, normalized = {}) {
  const mergedConcern = [...new Set([...(base.concern || []), ...(normalized.concern || [])])];
  const mergedSituation = [...new Set([...(base.situation || []), ...(normalized.situation || [])])];
  const mergedPreference = [...new Set([...(base.preference || []), ...(normalized.preference || [])])];
  const mergedFitIssue = [...new Set([...(base.fit_issue || []), ...(normalized.fit_issue || [])])];
  const mergedProductKeywordConstraints = [
    ...new Set([...(base.product_keyword_constraints || []), ...(normalized.product_keyword_constraints || [])]),
  ];

  return {
    ...base,
    requested_category: base.requested_category || normalized.requested_category || null,
    requested_form: base.explicit_form_request ? base.requested_form : normalized.requested_form || base.requested_form || null,
    sort_intent: normalized.sort_intent || base.sort_intent || 'popular',
    novelty_request: Boolean(base.novelty_request || normalized.novelty_request),
    popularity_intent: Boolean(base.popularity_intent || normalized.popularity_intent),
    negative_scope: base.negative_scope || normalized.negative_scope || null,
    allow_category_switch: base.requested_category
      ? Boolean(base.allow_category_switch)
      : Boolean(base.allow_category_switch || normalized.allow_category_switch),
    skin_type:
      base.skin_type && base.skin_type !== '모든 피부'
        ? base.skin_type
        : normalized.skin_type || base.skin_type || null,
    concern: mergedConcern,
    situation: mergedSituation,
    preference: mergedPreference,
    fit_issue: mergedFitIssue,
    product_keyword_constraints: mergedProductKeywordConstraints,
    variety_intent: Boolean(base.variety_intent || normalized.variety_intent),
  };
}

function buildSystemPrompt() {
  return [
    '너는 뷰티 추천 질의를 구조화하는 intent normalizer다.',
    '반드시 JSON만 반환하고, 스키마 키 외 텍스트를 쓰지 마라.',
    '사용자 부정/불만 표현(안 맞음, 답답, 밀림, 눈시림, 트러블)을 fit_issue로 정규화한다.',
    '값은 허용된 enum만 사용한다.',
    'JSON schema:',
    '{"requested_category":"sunscreen|toner|serum|cream|cushion|bb|cleansing|mask|inner|null","requested_form":"cream|lotion|serum|stick|spray|cushion|toner|mist|other|null","sort_intent":"popular|condition_based|new_arrival|null","novelty_request":false,"popularity_intent":false,"skin_type":"dry|oily|combination|sensitive|null","concern":[],"situation":[],"preference":[],"fit_issue":[],"negative_scope":"product|form|category|null","allow_category_switch":false,"variety_intent":false,"product_keyword_constraints":[]}',
  ].join(' ');
}

function buildUserPrompt(args = {}, parsedIntent = {}) {
  return JSON.stringify({
    user_input: {
      q: args.q || args.query || '',
      category: args.category || '',
      skin_type: args.skin_type || '',
      concerns: Array.isArray(args.concerns) ? args.concerns : [],
    },
    rule_parsed_intent: {
      requested_category: parsedIntent.requested_category || null,
      requested_form: parsedIntent.requested_form || null,
      sort_intent: parsedIntent.sort_intent || 'popular',
      novelty_request: Boolean(parsedIntent.novelty_request),
      popularity_intent: Boolean(parsedIntent.popularity_intent),
      skin_type: parsedIntent.skin_type || null,
      concern: parsedIntent.concern || [],
      situation: parsedIntent.situation || [],
      preference: parsedIntent.preference || [],
      fit_issue: parsedIntent.fit_issue || [],
      product_keyword_constraints: parsedIntent.product_keyword_constraints || [],
      negative_scope: parsedIntent.negative_scope || null,
      allow_category_switch: Boolean(parsedIntent.allow_category_switch),
      variety_intent: Boolean(parsedIntent.variety_intent),
    },
  });
}

export async function normalizeIntentWithLLM(openai, args = {}, parsedIntent = {}, model = 'gpt-4o-mini') {
  if (!openai) return { intent: parsedIntent, source: 'rule' };

  try {
    const res = await openai.responses.create({
      model,
      temperature: 0.1,
      input: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(args, parsedIntent) },
      ],
    });

    const parsed = parseJsonObject((res.output_text || '').trim());
    if (!parsed || typeof parsed !== 'object') {
      return { intent: parsedIntent, source: 'rule' };
    }

    const normalized = {
      requested_category: sanitizeEnum(parsed.requested_category, ALLOWED.requested_category),
      requested_form: sanitizeEnum(parsed.requested_form, ALLOWED.requested_form),
      sort_intent: sanitizeEnum(parsed.sort_intent, ALLOWED.sort_intent),
      novelty_request: Boolean(parsed.novelty_request),
      popularity_intent: Boolean(parsed.popularity_intent),
      skin_type: ALLOWED.skin_type.includes(parsed.skin_type) ? parsed.skin_type : null,
      concern: sanitizeArray(parsed.concern, ALLOWED.concern),
      situation: sanitizeArray(parsed.situation, ALLOWED.situation),
      preference: sanitizeArray(parsed.preference, ALLOWED.preference),
      fit_issue: sanitizeArray(parsed.fit_issue, ALLOWED.fit_issue),
      product_keyword_constraints: sanitizeStringArray(parsed.product_keyword_constraints).filter((x) =>
        ALLOWED.product_keyword_constraints.includes(x)
      ),
      negative_scope: sanitizeEnum(parsed.negative_scope, ALLOWED.negative_scope),
      allow_category_switch: Boolean(parsed.allow_category_switch),
      variety_intent: Boolean(parsed.variety_intent),
    };

    const rawQueryText = `${args.q || ''} ${args.query || ''} ${args.category || ''}`.trim();
    if (
      normalized.requested_category === 'sunscreen' &&
      normalized.requested_form === 'cream' &&
      !hasExplicitCreamFormPhrase(rawQueryText)
    ) {
      normalized.requested_form = null;
    }

    return {
      intent: mergeIntent(parsedIntent, normalized),
      source: 'llm',
    };
  } catch {
    return { intent: parsedIntent, source: 'rule' };
  }
}
