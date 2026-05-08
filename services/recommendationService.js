import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { RECOMMENDATION_POLICY, RECOMMENDATION_TAXONOMY } from '../config/recommendationPolicy.js';
import { parseUserIntent } from './recommendation/intentParser.js';
import { normalizeIntentWithLLM } from './recommendation/intentNormalizer.js';
import { normalizeCafe24Product } from './recommendation/productNormalizer.js';
import {
  calculateMainScoreBreakdown,
  dedupeByBase,
  getSecondaryRecommendations as rankerSecondaryRecommendations,
  retrievePrimaryCandidates,
  selectDiverseTopN,
} from './recommendation/ranker.js';
import { findFirstAliasKey, includesAny, parseJsonObject } from './recommendation/shared.js';
import {
  getRecommendationMetrics,
  trackCategoryLockViolation,
  trackExplanationMismatch,
  trackFallback,
  trackFormLockViolation,
  trackNoResult,
  trackNoExplanationMismatchForRequest,
  trackNoFallbackForRequest,
  trackReasonFallback,
  trackRepeatPenalty,
  trackRequest,
  trackSemanticNullInvalid,
} from './recommendation/metrics.js';
import { getSessionContext, updateSessionContext } from './recommendation/sessionContext.js';
import { applySemanticSignals } from './recommendation/semanticRetriever.js';

let openaiClient = null;
let openaiLoadAttempted = false;

async function getOpenAIClient() {
  if (openaiClient) return openaiClient;
  if (openaiLoadAttempted) return null;
  openaiLoadAttempted = true;
  if (!config.OPENAI_API_KEY) return null;

  try {
    const mod = await import('openai');
    const OpenAI = mod?.default;
    if (!OpenAI) return null;
    openaiClient = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
      timeout: 10000,
    });
    return openaiClient;
  } catch (error) {
    logger.warn(`[Rerank] OpenAI client unavailable: ${error.message}`);
    return null;
  }
}

function inferProductCategory(product) {
  return findFirstAliasKey(`${product?.name || ''} ${product?.text || ''}`, RECOMMENDATION_TAXONOMY.categories);
}

function hashQuery(input = '') {
  let hash = 2166136261;
  const str = String(input || '');
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `q_${(hash >>> 0).toString(16)}`;
}

function createSemanticDiagnostics() {
  return {
    semantic_enabled: false,
    embedding_model: null,
    semantic_candidates_count: 0,
    semantic_nonzero_count: 0,
    semantic_skip_reason: 'not_evaluated',
  };
}

function shouldFlagSemanticNullInvalid(diag = {}) {
  if (!diag || !diag.semantic_enabled) return false;
  if (diag.semantic_skip_reason !== null) return false;
  const count = Number(diag.semantic_nonzero_count || 0);
  const ratio = Number(diag.semantic_nonzero_ratio || 0);
  return count <= 0 || ratio <= 0;
}

function isSemanticActivationSuccess(diag = {}) {
  const count = Number(diag.semantic_nonzero_count || 0);
  const ratio = Number(diag.semantic_nonzero_ratio || 0);
  return count >= 3 || ratio >= 0.2;
}

function buildReasoningTags(parsedIntent) {
  const tags = [];
  if (parsedIntent.requested_category) tags.push(`category:${parsedIntent.requested_category}`);
  if (parsedIntent.requested_form) tags.push(`form:${parsedIntent.requested_form}`);
  if (parsedIntent.skin_type) tags.push(`skin_type:${parsedIntent.skin_type}`);
  for (const c of parsedIntent.concern || []) tags.push(`concern:${c}`);
  for (const s of parsedIntent.situation || []) tags.push(`situation:${s}`);
  for (const p of parsedIntent.preference || []) tags.push(`preference:${p}`);
  for (const f of parsedIntent.fit_issue || []) tags.push(`fit_issue:${f}`);
  if (parsedIntent.negative_scope) tags.push(`negative_scope:${parsedIntent.negative_scope}`);
  if (parsedIntent.variety_intent) tags.push('intent:variety');
  if (parsedIntent.sensitivity_signal) tags.push(`sensitivity:${parsedIntent.sensitivity_signal}`);
  if (parsedIntent.price_intent?.max_price_krw) tags.push(`price_max:${parsedIntent.price_intent.max_price_krw}`);
  if (parsedIntent.novelty_request) tags.push('novelty:new_arrival');
  tags.push(`sort:${parsedIntent.sort_intent}`);
  return tags;
}

function applySessionContextToIntent(parsedIntent = {}, sessionContext = {}) {
  const mergedConcern = new Set(parsedIntent.concern || []);
  const mergedPreference = new Set(parsedIntent.preference || []);
  const reactiveSignals = sessionContext.reactive_signals || [];
  const negativePreferences = sessionContext.negative_preferences || [];

  if (reactiveSignals.includes('irritation')) mergedConcern.add('soothing');
  if (reactiveSignals.includes('not_fit')) mergedConcern.add('not_fit');
  if (negativePreferences.includes('oily')) mergedConcern.add('sebum_control');
  if (negativePreferences.includes('heavy')) mergedPreference.add('lightweight');

  return {
    ...parsedIntent,
    concern: [...mergedConcern],
    preference: [...mergedPreference],
    fit_issue: [...new Set([...(parsedIntent.fit_issue || []), ...(reactiveSignals.includes('irritation') ? ['irritation'] : [])])],
    negative_scope: parsedIntent.negative_scope || (reactiveSignals.includes('not_fit') ? 'form' : null),
    session_context: {
      reactive_signals: reactiveSignals,
      negative_preferences: negativePreferences,
      recent_main_base_names: sessionContext.recent_main_base_names || [],
      recent_main_forms: sessionContext.recent_main_forms || [],
      recent_main_category: sessionContext.recent_main_category || null,
    },
  };
}

function buildDetail(product, parsedIntent) {
  const reasons = [];
  const tips = [];
  const source = `${product.name} ${product.text}`;

  if (parsedIntent.skin_type === 'dry') reasons.push('건성 기준에서 당김 부담을 줄이는 보습/수분 신호가 확인됩니다.');
  if (parsedIntent.skin_type === 'oily' || parsedIntent.skin_type === 'combination') {
    reasons.push('지성/수부지 기준에서 유분 부담이 덜한 사용감 신호가 확인됩니다.');
  }
  if (parsedIntent.skin_type === 'sensitive') reasons.push('민감 피부 관점에서 저자극/진정 관련 신호가 상대적으로 잘 맞습니다.');

  if ((parsedIntent.concern || []).includes('sebum_control')) reasons.push('유분/번들거림 고민 조건과의 일치도가 높습니다.');
  if ((parsedIntent.concern || []).includes('hydration')) reasons.push('보습/수분 중심 조건을 함께 반영한 후보입니다.');
  if ((parsedIntent.concern || []).includes('soothing')) reasons.push('민감/진정 조건과 맞는 신호가 확인됩니다.');
  if ((parsedIntent.concern || []).includes('tone_up')) reasons.push('톤/잡티 보정 니즈를 함께 충족하기 좋은 타입입니다.');

  if ((parsedIntent.situation || []).includes('makeup_before')) {
    tips.push('메이크업 전에는 소량씩 2~3회 레이어링하면 밀림을 줄이기 좋습니다.');
  }
  if ((parsedIntent.situation || []).includes('outdoor')) {
    tips.push('야외 활동 시 2~3시간 간격 재도포로 차단력을 안정적으로 유지해 주세요.');
  }
  if (!tips.length) tips.push('기초 마지막 단계에서 얇게 2~3회 나눠 바르면 밀착감이 좋아집니다.');

  if (!reasons.length) {
    if (includesAny(source, ['가벼', '산뜻', '보송'])) reasons.push('가벼운 사용감 신호가 있어 데일리 사용에 무난한 후보입니다.');
    else if (includesAny(source, ['보습', '수분', '촉촉'])) reasons.push('보습/수분 중심 사용감 신호가 확인됩니다.');
    else reasons.push('요청 조건과의 종합 일치도가 높은 후보입니다.');
  }

  return {
    why_pick: reasons.slice(0, 2).join(' '),
    usage_tip: tips[0],
    caution: '야외 노출 시간이 길면 2~3시간 간격 재도포를 권장합니다.',
  };
}

function buildDetailFromReason(product, parsedIntent) {
  const breakdown = product?._score_breakdown || {};
  const reasonCode = breakdown.reason_code || null;
  const semanticBoost = Number(breakdown.semantic_boost || 0);

  let whyPick = '';
  if (reasonCode === 'SEMANTIC_MATCH' && semanticBoost > 0) {
    whyPick = '요청 문맥과 제품 특성의 의미 매칭 점수가 높아 우선 추천드렸어요.';
  } else if (reasonCode === 'CONDITION_MATCH') {
    if (parsedIntent.skin_type === 'sensitive') whyPick = '민감 피부 기준에서 자극 부담을 낮춘 사용감 신호가 상대적으로 좋아요.';
    else if (parsedIntent.skin_type === 'oily' || parsedIntent.skin_type === 'combination') {
      whyPick = '유분·번들거림 부담을 줄인 사용감 신호가 상대적으로 잘 맞아요.';
    } else if (parsedIntent.skin_type === 'dry') {
      whyPick = '건조함 부담을 줄이는 보습/수분 신호가 상대적으로 잘 맞아요.';
    } else {
      whyPick = '요청하신 조건과의 적합도 신호가 상대적으로 높아 상위로 선별됐어요.';
    }
  } else if (reasonCode === 'POPULAR_BASELINE') {
    whyPick = '요청 카테고리 내에서 최근 인기/품질 신호가 안정적인 제품이라 우선 추천드렸어요.';
  } else {
    trackReasonFallback();
    whyPick = '요청 카테고리 기준으로 무난하게 시작하기 좋은 기본 후보예요.';
  }

  const tips = [];
  if ((parsedIntent.situation || []).includes('makeup_before')) {
    tips.push('메이크업 전에는 한 번에 많이 바르기보다 2~3회 얇게 레이어링하면 밀림이 줄어요.');
  }
  if ((parsedIntent.situation || []).includes('outdoor')) {
    tips.push('야외 활동 시 2~3시간 간격으로 재도포해 차단력을 유지해주세요.');
  }
  if (!tips.length) tips.push('기초 마지막 단계에서 얇게 2~3회 나눠 바르면 밀착감이 좋아져요.');

  return {
    reason_code: reasonCode || 'FALLBACK_SAFE_BASELINE',
    reason_facts: breakdown.reason_facts || {},
    why_pick: whyPick,
    usage_tip: tips[0],
    caution: '야외 활동이 길면 2~3시간 간격 재도포를 권장합니다.',
  };
}

function toRecommendationItem(product, idx, parsedIntent) {
  const details = buildDetailFromReason(product, parsedIntent);
  return {
    rank: idx + 1,
    rank_label: idx === 0 ? '1위(BEST)' : `${idx + 1}위`,
    name: product.name,
    base_name: product.base_name,
    form: product.form,
    category_key: product.category_key || inferProductCategory(product) || null,
    category_ids: Array.isArray(product.category_ids) ? product.category_ids : [],
    price: product.price,
    key_point: details.why_pick,
    reason_code: details.reason_code,
    reason_facts: details.reason_facts,
    why_pick: details.why_pick || '요청 카테고리 기준으로 무난하게 시작하기 좋은 기본 후보예요.',
    usage_tip: details.usage_tip || '기초 마지막 단계에서 얇게 2~3회 나눠 바르면 밀착감이 좋아져요.',
    caution: details.caution,
    is_promo: !!product.is_promo,
    buy_url: `https://cellfusionc.co.kr/product/detail.html?product_no=${product.id}`,
    image: product.image,
  };
}

function toPromotionItem(product) {
  return {
    name: product.name,
    base_name: product.base_name,
    form: product.form,
    price: product.price,
    buy_url: `https://cellfusionc.co.kr/product/detail.html?product_no=${product.id}`,
    image: product.image,
  };
}

async function stage2Rerank(candidates, parsedIntent, policy) {
  if (!config.OPENAI_API_KEY) return candidates;
  if (!Array.isArray(candidates) || candidates.length < 2) return candidates;

  const openai = await getOpenAIClient();
  if (!openai) return candidates;

  const model = config.RERANK_MODEL || policy.rerank.model;
  const payload = candidates.map((p) => ({
    id: p.id,
    name: p.name,
    form: p.form,
    category_key: p.category_key || null,
    score: p._base_score,
    concern_tags: p.attributes?.concern_tags || [],
    texture_tags: p.attributes?.texture_tags || [],
    summary: p.summary_description,
  }));

  const systemPrompt = [
    'You rerank product candidates for a category-locked and form-aware recommendation engine.',
    'Never prioritize items that violate category/form policy.',
    'Focus on skin_type/concern/situation fit.',
    'Return JSON only: {"ordered_ids":["id1","id2"]}.',
  ].join(' ');

  try {
    const res = await openai.responses.create({
      model,
      temperature: 0.2,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({ intent: parsedIntent, candidates: payload }) },
      ],
    });

    const parsed = parseJsonObject((res.output_text || '').trim());
    const ordered = Array.isArray(parsed?.ordered_ids) ? parsed.ordered_ids.map(String) : [];
    if (!ordered.length) return candidates;

    const rankMap = new Map(ordered.map((id, i) => [id, ordered.length - i]));
    return candidates
      .map((p) => {
        const llm = rankMap.get(p.id) || 0;
        const llmNorm = (llm / Math.max(ordered.length, 1)) * 100;
        return {
          ...p,
          _final_score: p._base_score * (1 - policy.rerank.llmWeight) + llmNorm * policy.rerank.llmWeight,
        };
      })
      .sort((a, b) => (b._final_score || 0) - (a._final_score || 0));
  } catch (error) {
    logger.warn(`[Rerank] skipped: ${error.message}`);
    return candidates;
  }
}

function buildMcpRecommendationResponse(
  parsedIntent,
  mainRecs,
  secondaryRecs,
  promotions,
  categoryLocked,
  formLocked,
  allowedMainForms
) {
  const sortMode = parsedIntent.sort_intent || 'popular';
  const summaryMessage = mainRecs.length ? '고객님을 위한 최적 상품입니다.' : '조건에 맞는 결과가 없습니다.';
  const summaryConclusion = mainRecs.length
    ? `분석 결과, ${mainRecs[0].name} 제품이 현재 요청 조건에 가장 적합합니다.`
    : '요청 카테고리에서 조건에 맞는 후보를 찾지 못했습니다.';

  return {
    requested_category: parsedIntent.requested_category || null,
    main_recommendations: mainRecs,
    secondary_recommendations: secondaryRecs,
    reasoning_tags: buildReasoningTags(parsedIntent),
    applied_policy: {
      category_locked: Boolean(categoryLocked && parsedIntent.requested_category),
      form_locked: Boolean(formLocked),
      requested_form: parsedIntent.requested_form || null,
      allowed_main_forms: Array.isArray(allowedMainForms) ? allowedMainForms : [],
      sort_mode: sortMode,
    },

    // Backward compatibility
    recommendations: mainRecs,
    reference_recommendations: secondaryRecs,
    promotions: promotions || [],
    summary: {
      message: summaryMessage,
      strategy:
        sortMode === 'new_arrival'
          ? '요청 카테고리 내에서 신제품 우선 정책으로 정렬했습니다.'
          : sortMode === 'popular'
          ? '요청 카테고리 내 인기/품질 신호를 우선 반영해 정렬했습니다.'
          : '요청 카테고리 내 조건 적합도를 우선 반영해 정렬했습니다.',
      conclusion: summaryConclusion,
    },
  };
}

function buildDeterministicNarrative(mainRecommendations = [], promotions = [], secondaryRecommendations = [], args = {}) {
  if (!mainRecommendations.length) return '요청하신 조건에 맞는 본품 후보를 찾지 못했어요.';

  const lines = [];
  const skinType = String(args.skin_type || '').trim();
  const concerns = Array.isArray(args.concerns) ? args.concerns.filter(Boolean) : [];
  const conditionText = [skinType ? `${skinType} 피부` : '', concerns.length ? `고민: ${concerns.join(', ')}` : '']
    .filter(Boolean)
    .join(' / ');

  lines.push(conditionText ? `요청 조건(${conditionText}) 기준으로 본품 위주로 정리해드릴게요.` : '요청하신 카테고리에서 본품 위주로 먼저 추천드릴게요.');
  lines.push('');

  mainRecommendations.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.name}`);
    lines.push(`- 추천 이유: ${item.why_pick || '요청 조건과의 일치도가 높은 후보입니다.'}`);
    lines.push(`- 사용 팁: ${item.usage_tip || '기초 마지막 단계에서 얇게 2~3회 나눠 발라 주세요.'}`);
    lines.push('');
  });

  if (promotions.length > 0) {
    lines.push('현재 행사도 함께 진행 중이에요. 카드 하단 행사 섹션에서 확인해 주세요.');
    lines.push('');
  }
  if (secondaryRecommendations.length > 0) {
    lines.push('제형을 넓혀서 함께 볼 만한 참고 추천도 아래에 정리해두었어요.');
    lines.push('');
  }
  lines.push('원하시면 다음으로 예산 기준 루틴이나 함께 쓰기 좋은 조합까지 바로 맞춰드릴게요.');
  return lines.join('\n');
}

async function generateNarrativeWithLLM(mainRecommendations = [], promotions = [], secondaryRecommendations = [], args = {}) {
  const openai = await getOpenAIClient();
  if (!openai) return null;

  const compactItems = mainRecommendations.slice(0, 3).map((x) => ({
    name: x.name,
    why_pick: x.why_pick || x.key_point || '',
    usage_tip: x.usage_tip || '',
  }));

  const promptPayload = {
    user_context: {
      category: args.category || '',
      skin_type: args.skin_type || '',
      concerns: Array.isArray(args.concerns) ? args.concerns : [],
      query: args.query || args.q || '',
    },
    main_recommendations: compactItems,
    secondary_count: secondaryRecommendations.length,
    promotions_count: promotions.length,
  };

  const systemPrompt = [
    '너는 백화점 뷰티 카운터의 전문 상담사 톤으로 한국어 안내문을 작성한다.',
    '추천 결과는 바꾸지 말고, 이미 주어진 main_recommendations를 설명만 자연스럽게 정리한다.',
    '공감 과장/과도한 감탄/반말 금지. 핵심 중심으로 8~14문장 내 작성.',
    '카드와 중복되는 가격 나열은 피하고, 선택 기준/사용 가이드를 실용적으로 정리한다.',
    '반드시 JSON만 반환: {"text":"..."}',
  ].join(' ');

  try {
    const res = await openai.responses.create({
      model: config.NARRATOR_MODEL || config.RERANK_MODEL || RECOMMENDATION_POLICY.rerank.model,
      temperature: 0.3,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(promptPayload) },
      ],
    });
    const parsed = parseJsonObject((res.output_text || '').trim());
    const text = String(parsed?.text || '').trim();
    return text || null;
  } catch (error) {
    logger.warn(`[Narrator] skipped: ${error.message}`);
    return null;
  }
}

function hasCategoryLockViolation(mainRecommendations, parsedIntent, categoryLocked) {
  if (!categoryLocked || !parsedIntent.requested_category || !Array.isArray(mainRecommendations)) return false;
  const requestedIds = (parsedIntent.requested_category_ids || []).map((n) => Number(n)).filter((n) => Number.isFinite(n));

  if (requestedIds.length > 0) {
    return mainRecommendations.some((item) => {
      const ids = Array.isArray(item?.category_ids) ? item.category_ids : [];
      return !ids.some((id) => requestedIds.includes(Number(id)));
    });
  }
  return mainRecommendations.some((item) => item?.category_key && item.category_key !== parsedIntent.requested_category);
}

function hasFormLockViolation(mainRecommendations, allowedMainForms, formLocked) {
  if (!formLocked || !Array.isArray(allowedMainForms) || !allowedMainForms.length) return false;
  return mainRecommendations.some((item) => item?.form && !allowedMainForms.includes(item.form));
}

function hasExplanationMismatch(mainRecommendations = []) {
  const conditionTerms = ['지성', '건성', '민감', '수부지', '고민', '조건'];
  return mainRecommendations.some((item) => {
    const why = String(item?.why_pick || '');
    const code = String(item?.reason_code || '');
    const facts = item?.reason_facts || {};
    const semanticBoost = Number(facts.semantic_boost || 0);
    if (!code) return true;
    if (code === 'POPULAR_BASELINE') {
      return conditionTerms.some((t) => why.includes(t));
    }
    if (code.startsWith('SEMANTIC') && !(semanticBoost > 0)) return true;
    return false;
  });
}

function categoryMatches(item, parsedIntent) {
  const requestedIds = (parsedIntent.requested_category_ids || []).map((n) => Number(n)).filter((n) => Number.isFinite(n));
  if (requestedIds.length > 0) {
    return (item.category_ids || []).some((id) => requestedIds.includes(Number(id)));
  }
  return item.category_key === parsedIntent.requested_category;
}

function collectPromotions(normalizedProducts, parsedIntent, mainRecommendations, maxCount = 4) {
  const usedBase = new Set((mainRecommendations || []).map((item) => item.base_name));

  const promos = normalizedProducts
    .filter((p) => p.is_promo)
    .filter((p) => !usedBase.has(p.base_name))
    .filter((p) => !parsedIntent.requested_category || categoryMatches(p, parsedIntent))
    .sort((a, b) => b.price_value - a.price_value);

  return dedupeByBase(promos).slice(0, maxCount).map(toPromotionItem);
}

function isCategoryMatchedByIntent(item = {}, parsedIntent = {}) {
  const requestedIds = (parsedIntent.requested_category_ids || []).map((n) => Number(n)).filter((n) => Number.isFinite(n));
  if (requestedIds.length > 0) {
    const ids = Array.isArray(item.category_ids) ? item.category_ids : [];
    return ids.some((id) => requestedIds.includes(Number(id)));
  }
  if (!parsedIntent.requested_category) return true;
  return item.category_key === parsedIntent.requested_category;
}

function isExplicitBbRequest(parsedIntent = {}, args = {}) {
  if (parsedIntent?.requested_category === 'bb') return true;
  const merged = `${args.category || ''} ${args.query || ''} ${args.q || ''} ${
    Array.isArray(args.concerns) ? args.concerns.join(' ') : ''
  }`.toLowerCase();
  return /(비비\s*크림|bb\s*cream|bb\s*크림|bbcream|비비크림)/i.test(merged);
}

function isBbLikeCandidate(item = {}, parsedIntent = {}) {
  const source = `${item?.name || ''} ${item?.text || ''}`.toLowerCase();

  const requestedIds = (parsedIntent.requested_category_ids || [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));
  if (requestedIds.length > 0) {
    const ids = Array.isArray(item.category_ids) ? item.category_ids.map((n) => Number(n)) : [];
    if (ids.some((id) => requestedIds.includes(id))) return true;
  }

  if (item?.category_key === 'bb') return true;

  const strongPositive = /(비비|bb|베이스|선베이스|blemish|블레미쉬|밤|쿠션|cushion|커버|메이크업)/i.test(source);
  const hasToneup = /(톤업|tone up|toneup)/i.test(source);
  const toneupAssist =
    hasToneup &&
    /(bb|cushion|blemish|cover|makeup|base|\ube44\ube44|쿠션|블레미쉬|커버|메이크업|베이스)/i.test(source);
  const negativeOnlySkincare =
    /(수분\s*크림|진정\s*크림|카밍\s*크림|아쿠아\s*크림|리커버리\s*크림|아이\s*크림|토너|세럼|앰플)/i.test(source);

  const genericCreamOnly =
    /(\ud06c\ub9bc|cream)/i.test(source) &&
    !/(bb|cushion|cover|makeup|base|\ube44\ube44|\ucfe0\uc158|\ucee4\ubc84|\uba54\uc774\ud06c\uc5c5|\ubca0\uc774\uc2a4)/i.test(source);

  if (!strongPositive && !toneupAssist) return false;
  if (hasToneup && !toneupAssist) return false;
  if (genericCreamOnly) return false;
  if (negativeOnlySkincare && !strongPositive) return false;
  return true;
}

function isBbLikeCandidateStrict(item = {}, parsedIntent = {}) {
  const requestedIds = (parsedIntent.requested_category_ids || [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));
  const categoryIds = Array.isArray(item.category_ids) ? item.category_ids.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : [];
  if (requestedIds.length > 0 && categoryIds.some((id) => requestedIds.includes(id))) return true;
  if (item?.category_key === 'bb') return true;

  const roleTags = Array.isArray(item?.attributes?.role_tags) ? item.attributes.role_tags.map((x) => String(x || '').toLowerCase()) : [];
  const hasRoleTags = roleTags.length > 0;

  const hasRoleBbSignal =
    roleTags.includes('bb') ||
    roleTags.includes('base_makeup') ||
    roleTags.includes('cover') ||
    (roleTags.includes('tone_up') && (roleTags.includes('bb') || roleTags.includes('base_makeup') || roleTags.includes('cover')));
  if (hasRoleTags) return hasRoleBbSignal;

  const name = String(item?.name || '').toLowerCase();
  const fallbackNameSignal = /(\ube44\ube44|bb|blemish\s*balm|블레미쉬\s*밤)/i.test(name);
  return fallbackNameSignal;
}

function enforceBbMainMix(selected = [], deduped = [], parsedIntent = {}, sameScoreBand = 3) {
  const _sameScoreBand = sameScoreBand;
  if (parsedIntent.requested_category !== 'bb') {
    return {
      selected,
      bb_like_candidate_count: 0,
      main_bb_like_count: 0,
      non_bb_dropped_from_main: 0,
      _same_score_band: _sameScoreBand,
    };
  }

  const scoreOf = (item) => Number(item?._final_score ?? item?._base_score ?? item?._score_breakdown?.base_score ?? 0);
  const finalLimit = Math.max(1, selected.length);
  const bbLikePool = (deduped || [])
    .filter((item) => isBbLikeCandidateStrict(item, parsedIntent))
    .sort((a, b) => scoreOf(b) - scoreOf(a));
  const selectedBbOnly = bbLikePool.slice(0, finalLimit);
  const selectedIds = new Set(selectedBbOnly.map((item) => String(item?.id || '')));
  const nonBbDropped = (selected || []).filter((item) => !selectedIds.has(String(item?.id || ''))).length;

  return {
    selected: selectedBbOnly,
    bb_like_candidate_count: bbLikePool.length,
    main_bb_like_count: selectedBbOnly.length,
    non_bb_dropped_from_main: nonBbDropped,
    _same_score_band: _sameScoreBand,
  };
}

function enforceMainPolicyOnRanked(
  ranked = [],
  parsedIntent = {},
  categoryLocked = false,
  formLocked = false,
  allowedMainForms = [],
  limit = RECOMMENDATION_POLICY.limits.defaultMain,
  options = {}
) {
  const scoreOf = (item) => Number(item?._final_score ?? item?._base_score ?? item?._score_breakdown?.base_score ?? 0);
  const formPolicy = RECOMMENDATION_POLICY.formPolicy || {};
  const sameScoreBand = Number(formPolicy.sameScoreBand || 3);
  const configuredMinMatch = Number(formPolicy.minFormMatchInMain || 2);

  const drop = {
    DROP_CATEGORY_MISMATCH: 0,
    DROP_FORM_MISMATCH: 0,
    DROP_PROMO_MAIN: 0,
    DROP_DUP_BASE: 0,
  };

  const passed = [];
  for (const item of ranked || []) {
    if (!item) continue;
    if (item.is_promo) {
      drop.DROP_PROMO_MAIN += 1;
      continue;
    }
    if (categoryLocked && !isCategoryMatchedByIntent(item, parsedIntent)) {
      drop.DROP_CATEGORY_MISMATCH += 1;
      continue;
    }
    passed.push(item);
  }

  const seen = new Set();
  const deduped = [];
  for (const item of passed) {
    const key = String(item.base_name || '').trim();
    if (!key) continue;
    if (seen.has(key)) {
      drop.DROP_DUP_BASE += 1;
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  const finalLimit = Math.max(1, limit);
  const isBbRequest = parsedIntent.requested_category === 'bb';
  const strictExplicitForm = Boolean(options?.strict_explicit_form);
  if (!isBbRequest && !(formLocked && Array.isArray(allowedMainForms) && allowedMainForms.length > 0)) {
    return {
      selected: deduped.slice(0, finalLimit),
      drop_stats: drop,
      pre_policy_count: (ranked || []).length,
      pass_count: passed.length,
      bb_policy: {
        bb_like_candidate_count: 0,
        main_bb_like_count: 0,
        non_bb_dropped_from_main: 0,
      },
    };
  }

  const isMatch = (item) => Boolean(item?.form && allowedMainForms.includes(item.form));
  if (strictExplicitForm && !isBbRequest) {
    const strictOnly = deduped.filter(isMatch).slice(0, finalLimit);
    return {
      selected: strictOnly,
      drop_stats: drop,
      pre_policy_count: (ranked || []).length,
      pass_count: passed.length,
      bb_policy: {
        bb_like_candidate_count: 0,
        main_bb_like_count: 0,
        non_bb_dropped_from_main: 0,
      },
    };
  }

  const matchedCount = deduped.filter(isMatch).length;
  const minFormMatch = Math.min(finalLimit, Math.max(0, configuredMinMatch), matchedCount);

  // Soft policy: start with pure score ranking, then minimally swap to satisfy min form-match.
  const selected = deduped.slice(0, finalLimit);
  const selectedIds = new Set(selected.map((item) => String(item?.id || '')));
  const selectedMatchCount = () => selected.filter(isMatch).length;

  if (!isBbRequest && formLocked && Array.isArray(allowedMainForms) && allowedMainForms.length > 0) {
    while (selectedMatchCount() < minFormMatch) {
      const missing = minFormMatch - selectedMatchCount();
      if (missing <= 0) break;

      const remainingMatched = deduped
        .filter((item) => isMatch(item) && !selectedIds.has(String(item?.id || '')))
        .sort((a, b) => scoreOf(b) - scoreOf(a));
      if (!remainingMatched.length) break;

      const selectedNonMatched = selected
        .filter((item) => !isMatch(item))
        .sort((a, b) => scoreOf(a) - scoreOf(b));
      if (!selectedNonMatched.length) break;

      const candidateIn = remainingMatched[0];
      const candidateOut = selectedNonMatched[0];
      const shouldSwap = scoreOf(candidateIn) >= scoreOf(candidateOut) - sameScoreBand;
      if (!shouldSwap) break;

      const outIdx = selected.findIndex((x) => String(x?.id || '') === String(candidateOut?.id || ''));
      if (outIdx < 0) break;
      selected[outIdx] = candidateIn;
      selectedIds.delete(String(candidateOut?.id || ''));
      selectedIds.add(String(candidateIn?.id || ''));
    }
  }

  selected.sort((a, b) => scoreOf(b) - scoreOf(a));
  const bbPolicy = enforceBbMainMix(selected, deduped, parsedIntent, sameScoreBand);

  return {
    selected: bbPolicy.selected,
    drop_stats: drop,
    pre_policy_count: (ranked || []).length,
    pass_count: passed.length,
    bb_policy: {
      bb_like_candidate_count: Number(bbPolicy.bb_like_candidate_count || 0),
      main_bb_like_count: Number(bbPolicy.main_bb_like_count || 0),
      non_bb_dropped_from_main: Number(bbPolicy.non_bb_dropped_from_main || 0),
    },
  };
}

export const recommendationService = {
  parse_user_request(args = {}) {
    return parseUserIntent(args, RECOMMENDATION_TAXONOMY);
  },

  normalizeUserIntent(args = {}) {
    const parsed = this.parse_user_request(args);
    return {
      ...parsed,
      target_categories: parsed.requested_category ? [parsed.requested_category] : [],
    };
  },

  get_primary_candidates(products = [], parsedIntent = {}, options = {}) {
    return retrievePrimaryCandidates(products, parsedIntent, RECOMMENDATION_TAXONOMY, RECOMMENDATION_POLICY, options);
  },

  async rank_primary_recommendations(
    candidates = [],
    parsedIntent = {},
    limit = RECOMMENDATION_POLICY.limits.defaultMain,
    categoryLocked = false
  ) {
    const softContext = {
      lineCounts: new Map(),
      formCounts: new Map(),
    };

    const scored = candidates
      .map((p) => {
        const breakdown = calculateMainScoreBreakdown(p, parsedIntent, categoryLocked, RECOMMENDATION_POLICY, softContext);
        return {
          ...p,
          _score_breakdown: breakdown,
          _base_score: breakdown.base_score,
        };
      })
      .sort((a, b) => b._base_score - a._base_score)
      .slice(0, RECOMMENDATION_POLICY.limits.stage1TopK);

    logger.info(
      `[Rank Pool] candidates=${candidates.length} stage1=${scored.length} requested_category=${parsedIntent.requested_category || 'none'} requested_form=${parsedIntent.requested_form || 'none'}`
    );

    const deduped = dedupeByBase(scored).slice(0, RECOMMENDATION_POLICY.limits.stage2TopK);
    const reranked = await stage2Rerank(deduped, parsedIntent, RECOMMENDATION_POLICY);
    const finalSelected = selectDiverseTopN(reranked, Math.max(1, limit), RECOMMENDATION_POLICY);

    finalSelected.forEach((item, idx) => {
      const breakdown = item._score_breakdown || {};
      if (Number(breakdown.repeat_penalty || 0) > 0) {
        trackRepeatPenalty(Number(breakdown.repeat_penalty || 0));
        logger.info(
          `[RepeatPenalty] product="${item.name}" penalty=${breakdown.repeat_penalty} axis=${breakdown.repeat_penalty_axis || 'unknown'} session_ref=${breakdown.repeat_penalty_session_ref || 'none'}`
        );
      }
      logger.info(
        `[Rank Debug] rank=${idx + 1} product="${item.name}" form=${item.form} base_score=${breakdown.base_score ?? item._base_score ?? 0} condition_score=${breakdown.condition_score ?? 0} quality_score=${breakdown.quality_score ?? 0} intent_score=${breakdown.intent_score ?? 0} novelty_score=${breakdown.novelty_score ?? 0} semantic_score=${breakdown.semantic_score ?? 0} semantic_boost=${breakdown.semantic_boost ?? 0} form_match_bonus=${breakdown.form_match_bonus ?? 0} price_intent_score=${breakdown.price_intent_score ?? 0} query_match_score=${breakdown.query_match_score ?? 0} reactive_penalty=${breakdown.reactive_penalty ?? 0} repeat_penalty=${breakdown.repeat_penalty ?? 0} negative_scope_penalty=${breakdown.negative_scope_penalty ?? 0} reason_code=${breakdown.reason_code || 'none'} final_rank_reason="${breakdown.final_rank_reason || 'n/a'}"`
      );
    });

    return finalSelected;
  },

  get_secondary_recommendations(
    products = [],
    parsedIntent = {},
    mainItems = [],
    limit = RECOMMENDATION_POLICY.limits.defaultSecondary
  ) {
    const picked = rankerSecondaryRecommendations(
      products,
      parsedIntent,
      mainItems,
      RECOMMENDATION_TAXONOMY,
      RECOMMENDATION_POLICY
    );
    return picked.slice(0, Math.max(0, limit));
  },

  build_recommendation_response(
    parsedIntent,
    mainRecs = [],
    secondaryRecs = [],
    promotions = [],
    categoryLocked = false,
    formLocked = false,
    allowedMainForms = []
  ) {
    return buildMcpRecommendationResponse(
      parsedIntent,
      mainRecs,
      secondaryRecs,
      promotions,
      categoryLocked,
      formLocked,
      allowedMainForms
    );
  },

  getMetricsSnapshot() {
    return getRecommendationMetrics();
  },

  async generate_consult_narrative(mainRecommendations = [], promotions = [], secondaryRecommendations = [], args = {}) {
    const llmText = await generateNarrativeWithLLM(mainRecommendations, promotions, secondaryRecommendations, args);
    if (llmText) return llmText;
    return buildDeterministicNarrative(mainRecommendations, promotions, secondaryRecommendations, args);
  },

  async scoreAndFilterProducts(cachedProducts, args = {}, limit = RECOMMENDATION_POLICY.limits.defaultMain) {
    trackRequest();

    if (!Array.isArray(cachedProducts) || !cachedProducts.length) {
      trackNoResult();
      trackNoFallbackForRequest();
      trackNoExplanationMismatchForRequest();
      return {
        requested_category: null,
        main_recommendations: [],
        secondary_recommendations: [],
        reasoning_tags: ['empty_cache'],
        applied_policy: { category_locked: false, form_locked: false, sort_mode: 'popular' },
        recommendations: [],
        reference_recommendations: [],
        promotions: [],
        summary: { message: '데이터가 없습니다.', strategy: '', conclusion: '' },
      };
    }

    const normalized = cachedProducts.map((p) => {
      const item = normalizeCafe24Product(p, RECOMMENDATION_TAXONOMY);
      return { ...item, category_key: inferProductCategory(item) };
    });
    const sessionKey = String(args.__session_key || args.session_key || 'global');
    const sessionContext = getSessionContext(sessionKey);
    const ruleParsed = this.parse_user_request(args);
    const openai = await getOpenAIClient();
    const normalizedIntentResult = await normalizeIntentWithLLM(
      openai,
      args,
      ruleParsed,
      config.INTENT_NORMALIZER_MODEL || config.RERANK_MODEL || RECOMMENDATION_POLICY.rerank.model
    );
    let parsed = applySessionContextToIntent(normalizedIntentResult.intent, sessionContext);
    if (isExplicitBbRequest(parsed, args) && parsed.requested_category !== 'bb') {
      parsed = {
        ...parsed,
        requested_category: 'bb',
      };
    }
    logger.info(
      `[Intent] source=${normalizedIntentResult.source} category=${parsed.requested_category || 'none'} form=${parsed.requested_form || 'none'} skin=${parsed.skin_type || 'none'} concerns=${(parsed.concern || []).join('|') || 'none'} fit_issue=${(parsed.fit_issue || []).join('|') || 'none'} negative_scope=${parsed.negative_scope || 'none'} allow_category_switch=${parsed.allow_category_switch ? '1' : '0'} variety=${parsed.variety_intent ? '1' : '0'}`
    );

    const shouldRelaxFormAtStart = Boolean(parsed.variety_intent || (parsed.concern || []).includes('not_fit'));
    const isExplicitStrictMain = Boolean(parsed.explicit_form_request && parsed.requested_form);
    const shouldUnlockCategoryForMain = Boolean(parsed.allow_category_switch && parsed.negative_scope === 'category');
    const retrievalIntent = shouldUnlockCategoryForMain
      ? { ...parsed, requested_category: null, requested_category_ids: [], requested_form: null, explicit_form_request: false }
      : parsed;

    const strictPrimary = this.get_primary_candidates(normalized, retrievalIntent, {
      relaxForm: false,
      includePromo: false,
    });
    const broadPrimary = this.get_primary_candidates(normalized, retrievalIntent, {
      relaxForm: true,
      includePromo: false,
    });

    let { category_locked, form_locked, allowed_main_forms = [] } = strictPrimary;
    let candidates = Array.isArray(broadPrimary.candidates) ? broadPrimary.candidates : [];
    if (isExplicitStrictMain) {
      candidates = Array.isArray(strictPrimary.candidates) ? strictPrimary.candidates : [];
      form_locked = true;
      allowed_main_forms = parsed.requested_form ? [parsed.requested_form] : [];
    } else if (shouldRelaxFormAtStart && Array.isArray(strictPrimary.candidates) && strictPrimary.candidates.length > candidates.length) {
      candidates = strictPrimary.candidates;
    }
    parsed.allowed_main_forms = Array.isArray(allowed_main_forms) ? allowed_main_forms : [];

    let usedFallback = false;
    const fallbackSteps = [];
    const queryHash = hashQuery(parsed.query || args.query || args.q || '');
    let semanticDiagnostics = createSemanticDiagnostics();

    const runSemantic = async (candidatePool, intent) => {
      const semanticResult = await applySemanticSignals(candidatePool, intent, {
        openai,
        enabled: Boolean(config.SEMANTIC_RETRIEVAL_ENABLED && RECOMMENDATION_POLICY.semantic?.enabled),
        model: config.EMBEDDING_MODEL || RECOMMENDATION_POLICY.semantic?.model || 'text-embedding-3-small',
        minCandidateCount: RECOMMENDATION_POLICY.semantic?.minCandidateCount || 3,
        maxPool: RECOMMENDATION_POLICY.semantic?.maxPool || RECOMMENDATION_POLICY.limits.stage1TopK,
        batchSize: RECOMMENDATION_POLICY.semantic?.batchSize || 32,
        semanticWeight: RECOMMENDATION_POLICY.scoring?.semanticWeight || 1.1,
        logger,
      });
      semanticDiagnostics = semanticResult?.diagnostics || createSemanticDiagnostics();
      if (shouldFlagSemanticNullInvalid(semanticDiagnostics)) {
        trackSemanticNullInvalid();
        logger.warn(
          `[SemanticDiag] invalid_null_skip_reason model=${semanticDiagnostics.embedding_model || 'none'} nonzero=${semanticDiagnostics.semantic_nonzero_count || 0} ratio=${semanticDiagnostics.semantic_nonzero_ratio || 0}`
        );
      }
      const semanticSuccess = isSemanticActivationSuccess(semanticDiagnostics);
      logger.info(
        `[SemanticDiag] enabled=${semanticDiagnostics.semantic_enabled ? 1 : 0} model=${semanticDiagnostics.embedding_model || 'none'} candidates=${semanticDiagnostics.semantic_candidates_count || 0} nonzero=${semanticDiagnostics.semantic_nonzero_count || 0} nonzero_ratio=${semanticDiagnostics.semantic_nonzero_ratio || 0} query_source=${semanticDiagnostics.semantic_query_source || 'unknown'} query_tokens=${semanticDiagnostics.semantic_query_token_count || 0} skip_reason=${semanticDiagnostics.semantic_skip_reason ?? 'null'} success=${semanticSuccess ? 1 : 0}`
      );
      return Array.isArray(semanticResult?.candidates) ? semanticResult.candidates : candidatePool;
    };

    let semanticCandidates = await runSemantic(candidates, parsed);

    let ranked = await this.rank_primary_recommendations(semanticCandidates, parsed, Math.max(limit * 3, 8), category_locked);
    let policyGate = enforceMainPolicyOnRanked(
      ranked,
      parsed,
      category_locked,
      form_locked,
      allowed_main_forms,
      limit,
      { strict_explicit_form: isExplicitStrictMain }
    );
    let policyMain = policyGate.selected;
    logger.info(
      `[Main Policy Gate] pre=${policyGate.pre_policy_count} pass=${policyGate.pass_count} final=${policyMain.length} drops=${JSON.stringify(
        policyGate.drop_stats
      )}`
    );
    if (parsed.requested_category === 'bb') {
      const mainItems = policyMain.map((item) => ({
        name: item?.name || '',
        category_key: item?.category_key || null,
        form: item?.form || null,
        bb_like: isBbLikeCandidateStrict(item, parsed),
      }));
      logger.info(
        `[BB Policy] requested_category=bb bb_like_candidate_count=${policyGate.bb_policy?.bb_like_candidate_count || 0} main_bb_like_count=${policyGate.bb_policy?.main_bb_like_count || 0} non_bb_dropped_from_main=${policyGate.bb_policy?.non_bb_dropped_from_main || 0} main_items=${JSON.stringify(
          mainItems
        )}`
      );
    }

    if (!policyMain.length && category_locked && !isExplicitStrictMain) {
      usedFallback = true;
      fallbackSteps.push('popular_same_category');
      const relaxed = { ...parsed, concern: [], situation: [], preference: [], sort_intent: 'popular' };
      semanticCandidates = await runSemantic(candidates, relaxed);
      ranked = await this.rank_primary_recommendations(semanticCandidates, relaxed, Math.max(limit * 3, 8), category_locked);
      policyGate = enforceMainPolicyOnRanked(
        ranked,
        parsed,
        category_locked,
        form_locked,
        allowed_main_forms,
        limit,
        { strict_explicit_form: isExplicitStrictMain }
      );
      policyMain = policyGate.selected;
      logger.info(
        `[Main Policy Gate] pre=${policyGate.pre_policy_count} pass=${policyGate.pass_count} final=${policyMain.length} drops=${JSON.stringify(
          policyGate.drop_stats
        )}`
      );
    }

    if (!policyMain.length && category_locked && !isExplicitStrictMain) {
      usedFallback = true;
      fallbackSteps.push('relax_form');
      const fallbackPrimary = this.get_primary_candidates(normalized, parsed, { relaxForm: true, includePromo: false });
      candidates = fallbackPrimary.candidates;
      category_locked = strictPrimary.category_locked;
      form_locked = strictPrimary.form_locked;
      allowed_main_forms = strictPrimary.allowed_main_forms || [];
      parsed.allowed_main_forms = Array.isArray(allowed_main_forms) ? allowed_main_forms : [];
      semanticCandidates = await runSemantic(candidates, parsed);
      ranked = await this.rank_primary_recommendations(semanticCandidates, parsed, Math.max(limit * 3, 8), category_locked);
      policyGate = enforceMainPolicyOnRanked(
        ranked,
        parsed,
        category_locked,
        form_locked,
        allowed_main_forms,
        limit,
        { strict_explicit_form: isExplicitStrictMain }
      );
      policyMain = policyGate.selected;
      logger.info(
        `[Main Policy Gate] pre=${policyGate.pre_policy_count} pass=${policyGate.pass_count} final=${policyMain.length} drops=${JSON.stringify(
          policyGate.drop_stats
        )}`
      );
    }

    const mainRecommendations = policyMain.map((p, idx) => toRecommendationItem(p, idx, parsed));
    const promotions = collectPromotions(normalized, parsed, mainRecommendations, 4);
    logger.info(
      `[Form Policy] strict_explicit_form=${isExplicitStrictMain ? 1 : 0} requested_form=${parsed.requested_form || 'none'} allowed_main_forms=${(
        allowed_main_forms || []
      ).join(',')} main_forms=${mainRecommendations.map((x) => x.form || 'unknown').join(',')}`
    );

    if (!mainRecommendations.length && category_locked) {
      usedFallback = true;
      trackNoResult();
      fallbackSteps.push('secondary_only');
      trackFallback({
        timestamp: new Date().toISOString(),
        requested_category: parsed.requested_category || null,
        requested_form: parsed.requested_form || null,
        fit_issue: parsed.fit_issue || [],
        negative_scope: parsed.negative_scope || null,
        fallback_step: fallbackSteps[fallbackSteps.length - 1] || 'secondary_only',
        reason_code: 'FALLBACK_SAFE_BASELINE',
        query_hash: queryHash,
      });

      const secondaryOnly = this.get_secondary_recommendations(
        normalized,
        parsed,
        [],
        RECOMMENDATION_POLICY.limits.defaultSecondary
      );
      trackNoExplanationMismatchForRequest();
      return {
        requested_category: parsed.requested_category,
        main_recommendations: [],
        secondary_recommendations: secondaryOnly,
        reasoning_tags: [...buildReasoningTags(parsed), 'fallback:secondary_only'],
        applied_policy: {
          category_locked: true,
          form_locked: Boolean(form_locked),
          requested_form: parsed.requested_form || null,
          allowed_main_forms: Array.isArray(allowed_main_forms) ? allowed_main_forms : [],
          sort_mode: parsed.sort_intent,
        },
        recommendations: [],
        reference_recommendations: secondaryOnly,
        promotions,
        summary: {
          message: '요청 카테고리 상품이 부족해 참고용 후보를 먼저 안내드렸습니다.',
          strategy: '카테고리 잠금 정책을 유지한 상태에서 fallback이 적용되었습니다.',
          conclusion: '요청 카테고리 내 매칭 가능한 본품 후보가 충분하지 않았습니다.',
        },
      };
    }

    if (usedFallback) {
      trackFallback({
        timestamp: new Date().toISOString(),
        requested_category: parsed.requested_category || null,
        requested_form: parsed.requested_form || null,
        fit_issue: parsed.fit_issue || [],
        negative_scope: parsed.negative_scope || null,
        fallback_step: fallbackSteps[fallbackSteps.length - 1] || 'relax_condition',
        reason_code: mainRecommendations[0]?.reason_code || 'FALLBACK_SAFE_BASELINE',
        query_hash: queryHash,
      });
    } else {
      trackNoFallbackForRequest();
    }
    if (!mainRecommendations.length) trackNoResult();

    if (hasCategoryLockViolation(mainRecommendations, parsed, category_locked)) {
      trackCategoryLockViolation();
      logger.warn(
        `[Policy] category lock violation detected requested=${parsed.requested_category} main=${mainRecommendations
          .map((x) => `${x.name}:${x.category_key || 'unknown'}`)
          .join(', ')}`
      );
    }
    if (hasFormLockViolation(mainRecommendations, allowed_main_forms, form_locked)) {
      trackFormLockViolation();
      logger.warn(
        `[Policy] form lock violation detected strict_explicit_form=${isExplicitStrictMain ? 1 : 0} requested_form=${parsed.requested_form || 'default'} allowed=${(
          allowed_main_forms || []
        ).join(',')} main=${mainRecommendations.map((x) => `${x.name}:${x.form || 'unknown'}`).join(', ')}`
      );
    }

    if (hasExplanationMismatch(mainRecommendations)) {
      trackExplanationMismatch();
      logger.warn('[Explain] explanation mismatch detected between reason_code and rendered why_pick');
    } else {
      trackNoExplanationMismatchForRequest();
    }

    const secondary = this.get_secondary_recommendations(
      normalized,
      { ...parsed, allowed_main_forms },
      mainRecommendations,
      RECOMMENDATION_POLICY.limits.defaultSecondary
    );
    if (parsed.requested_category === 'bb') {
      const secondaryBbLikeCount = (secondary || []).filter((item) => isBbLikeCandidateStrict(item, parsed)).length;
      logger.info(`[BB Policy] secondary_bb_like_count=${secondaryBbLikeCount}`);
    }

    updateSessionContext(sessionKey, {
      query: `${args.query || args.q || ''}`.trim(),
      parsedIntent: parsed,
      mainRecommendations,
    });

    return this.build_recommendation_response(
      parsed,
      mainRecommendations,
      secondary,
      promotions,
      category_locked,
      form_locked,
      allowed_main_forms
    );
  },
};
