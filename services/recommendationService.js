import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { RECOMMENDATION_POLICY, RECOMMENDATION_TAXONOMY } from '../config/recommendationPolicy.js';
import { parseUserIntent } from './recommendation/intentParser.js';
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
  trackFallback,
  trackFormLockViolation,
  trackNoResult,
  trackRequest,
} from './recommendation/metrics.js';

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

function buildReasoningTags(parsedIntent) {
  const tags = [];
  if (parsedIntent.requested_category) tags.push(`category:${parsedIntent.requested_category}`);
  if (parsedIntent.requested_form) tags.push(`form:${parsedIntent.requested_form}`);
  if (parsedIntent.skin_type) tags.push(`skin_type:${parsedIntent.skin_type}`);
  for (const c of parsedIntent.concern || []) tags.push(`concern:${c}`);
  for (const s of parsedIntent.situation || []) tags.push(`situation:${s}`);
  for (const p of parsedIntent.preference || []) tags.push(`preference:${p}`);
  if (parsedIntent.novelty_request) tags.push('novelty:new_arrival');
  tags.push(`sort:${parsedIntent.sort_intent}`);
  return tags;
}

function buildDetail(product, parsedIntent) {
  const reasons = [];
  const tips = [];
  const source = `${product.name} ${product.text}`;

  if (parsedIntent.skin_type === 'dry') reasons.push('건성 기준으로 당김 부담을 줄이고 보습감 유지에 유리한 후보예요.');
  if (parsedIntent.skin_type === 'oily' || parsedIntent.skin_type === 'combination')
    reasons.push('지성/수부지 기준으로 유분 부담이 덜한 사용감 신호가 확인돼요.');
  if (parsedIntent.skin_type === 'sensitive') reasons.push('민감 피부 기준으로 저자극·진정 관련 신호가 잘 맞는 후보예요.');

  if ((parsedIntent.concern || []).includes('sebum_control')) reasons.push('유분/번들거림 고민 조건과의 일치도가 높아요.');
  if ((parsedIntent.concern || []).includes('hydration')) reasons.push('보습/수분 니즈를 반영한 제품으로 매칭됐어요.');
  if ((parsedIntent.concern || []).includes('soothing')) reasons.push('민감/진정 조건 신호와의 적합도가 높아요.');
  if ((parsedIntent.concern || []).includes('tone_up')) reasons.push('톤/잡티 보정 니즈를 함께 충족하기 좋은 타입이에요.');

  if ((parsedIntent.situation || []).includes('makeup_before')) {
    tips.push('메이크업 전에는 얇게 2~3회 나눠 바르면 밀림을 줄이기 좋아요.');
  }
  if ((parsedIntent.situation || []).includes('outdoor')) {
    tips.push('야외 활동 시 2~3시간 간격으로 덧바르면 차단력을 안정적으로 유지할 수 있어요.');
  }
  if (!tips.length) tips.push('기초 마지막 단계에서 얇게 2~3회 레이어링하면 밀착감이 좋아요.');

  if (!reasons.length) {
    if (includesAny(source, ['가벼', '산뜻', '보송'])) reasons.push('가벼운 사용감 신호가 높아 데일리로 쓰기 편한 후보예요.');
    else if (includesAny(source, ['보습', '수분', '촉촉'])) reasons.push('보습/수분 중심 사용감 신호가 확인돼요.');
    else reasons.push('요청 조건과의 종합 점수가 높은 후보예요.');
  }

  return {
    why_pick: reasons.slice(0, 2).join(' '),
    usage_tip: tips[0],
    caution: '외출 시간이 길면 2~3시간 간격으로 재도포해 주세요.',
  };
}

function toRecommendationItem(product, idx, parsedIntent) {
  const details = buildDetail(product, parsedIntent);
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
    why_pick: details.why_pick,
    usage_tip: details.usage_tip,
    caution: details.caution,
    is_promo: !!product.is_promo,
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

function buildMcpRecommendationResponse(parsedIntent, mainRecs, secondaryRecs, categoryLocked, formLocked, allowedMainForms) {
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
    promotions: [],
    summary: {
      message: summaryMessage,
      strategy:
        sortMode === 'new_arrival'
          ? '요청 카테고리 내에서 신제품 우선 정책으로 정렬했습니다.'
          : sortMode === 'popular'
          ? '요청 카테고리 내 인기/품질 신호 기준으로 우선 정렬했습니다.'
          : '요청 카테고리 내 조건 적합도를 우선 반영해 정렬했습니다.',
      conclusion: summaryConclusion,
    },
  };
}

function hasCategoryLockViolation(mainRecommendations, parsedIntent, categoryLocked) {
  if (!categoryLocked || !parsedIntent.requested_category || !Array.isArray(mainRecommendations)) return false;
  const requestedIds = (parsedIntent.requested_category_ids || [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));

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
        const breakdown = calculateMainScoreBreakdown(
          p,
          parsedIntent,
          categoryLocked,
          RECOMMENDATION_POLICY,
          softContext
        );
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
      logger.info(
        `[Rank Debug] rank=${idx + 1} product="${item.name}" form=${item.form} base_score=${breakdown.base_score ?? item._base_score ?? 0} condition_score=${breakdown.condition_score ?? 0} quality_score=${breakdown.quality_score ?? 0} intent_score=${breakdown.intent_score ?? 0} novelty_score=${breakdown.novelty_score ?? 0} query_match_score=${breakdown.query_match_score ?? 0} final_rank_reason="${breakdown.final_rank_reason || 'n/a'}"`
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
    categoryLocked = false,
    formLocked = false,
    allowedMainForms = []
  ) {
    return buildMcpRecommendationResponse(
      parsedIntent,
      mainRecs,
      secondaryRecs,
      categoryLocked,
      formLocked,
      allowedMainForms
    );
  },

  getMetricsSnapshot() {
    return getRecommendationMetrics();
  },

  async scoreAndFilterProducts(cachedProducts, args = {}, limit = RECOMMENDATION_POLICY.limits.defaultMain) {
    trackRequest();

    if (!Array.isArray(cachedProducts) || !cachedProducts.length) {
      trackNoResult();
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
    const parsed = this.parse_user_request(args);

    // Strict pass: category + default/explicit form lock
    let primary = this.get_primary_candidates(normalized, parsed, { relaxForm: false });
    let { candidates, category_locked, form_locked, allowed_main_forms = [] } = primary;

    let usedFallback = false;
    let ranked = await this.rank_primary_recommendations(candidates, parsed, limit, category_locked);

    // Fallback 1: keep category/form lock, relax condition filters only.
    if (!ranked.length && category_locked) {
      usedFallback = true;
      const relaxed = { ...parsed, concern: [], situation: [], preference: [], sort_intent: 'popular' };
      ranked = await this.rank_primary_recommendations(candidates, relaxed, limit, category_locked);
    }

    // Fallback 2: keep category lock, relax form lock within same category.
    if (!ranked.length && category_locked) {
      usedFallback = true;
      primary = this.get_primary_candidates(normalized, parsed, { relaxForm: true });
      candidates = primary.candidates;
      category_locked = primary.category_locked;
      form_locked = primary.form_locked;
      allowed_main_forms = primary.allowed_main_forms || [];
      ranked = await this.rank_primary_recommendations(candidates, parsed, limit, category_locked);
    }

    const mainRecommendations = ranked.map((p, idx) => toRecommendationItem(p, idx, parsed));

    // Fallback 3: no main candidates under category lock -> explicit secondary only.
    if (!mainRecommendations.length && category_locked) {
      usedFallback = true;
      trackNoResult();
      trackFallback();

      const secondaryOnly = this.get_secondary_recommendations(
        normalized,
        parsed,
        [],
        RECOMMENDATION_POLICY.limits.defaultSecondary
      );
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
        promotions: [],
        summary: {
          message: '요청 카테고리 상품이 부족해 참고용 유사 카테고리만 제안드려요.',
          strategy: '카테고리 잠금 정책을 유지한 상태에서 예외 fallback이 적용되었습니다.',
          conclusion: '요청 카테고리 재고/매칭이 부족했습니다.',
        },
      };
    }

    if (usedFallback) trackFallback();
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
        `[Policy] form lock violation detected requested_form=${parsed.requested_form || 'default'} allowed=${(
          allowed_main_forms || []
        ).join(',')} main=${mainRecommendations.map((x) => `${x.name}:${x.form || 'unknown'}`).join(', ')}`
      );
    }

    const secondary = this.get_secondary_recommendations(
      normalized,
      { ...parsed, allowed_main_forms },
      mainRecommendations,
      RECOMMENDATION_POLICY.limits.defaultSecondary
    );

    return this.build_recommendation_response(
      parsed,
      mainRecommendations,
      secondary,
      category_locked,
      form_locked,
      allowed_main_forms
    );
  },
};
