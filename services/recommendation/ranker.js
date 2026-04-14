import { findFirstAliasKey, includesAny, lower } from './shared.js';

function mapIntentSignals(intent = {}) {
  const texture = new Set();
  const finish = new Set();
  const useCase = new Set();
  const concerns = new Set(intent.concern || []);

  if (intent.skin_type === 'dry') {
    texture.add('moisturizing');
    useCase.add('daily');
  }
  if (intent.skin_type === 'oily' || intent.skin_type === 'combination') {
    texture.add('lightweight');
    texture.add('low_oily');
  }
  if (intent.skin_type === 'sensitive') {
    concerns.add('soothing');
  }

  if (concerns.has('hydration')) texture.add('moisturizing');
  if (concerns.has('sebum_control')) {
    texture.add('lightweight');
    texture.add('low_oily');
  }
  if (concerns.has('tone_up')) finish.add('tone_up');
  if (concerns.has('uv_protection')) useCase.add('daily');
  if (concerns.has('soothing')) useCase.add('daily');

  for (const s of intent.situation || []) {
    if (s === 'outdoor') {
      useCase.add('outdoor');
      useCase.add('reapply_friendly');
    }
    if (s === 'makeup_before') finish.add('makeup_friendly');
    if (s === 'daily') useCase.add('daily');
  }

  for (const p of intent.preference || []) {
    if (p === 'lightweight') texture.add('lightweight');
    if (p === 'moisturizing') texture.add('moisturizing');
    if (p === 'low_white_cast') finish.add('low_white_cast');
  }

  return {
    texture: [...texture],
    finish: [...finish],
    useCase: [...useCase],
    concerns: [...concerns],
  };
}

export function getQualityScore(product, policy) {
  const review = Math.min(policy.scoring.reviewCap, Math.log10((product.review_count || 0) + 1) * 10);
  const rating = Math.min(policy.scoring.ratingCap, Math.max(0, (product.rating || 0) * 4));
  const sales = Math.min(policy.scoring.salesCap, Math.log10((product.sales_count || 0) + 1) * 10);
  const bestTag = includesAny(product.name, ['best', '베스트', '인기']) ? policy.scoring.bestTagBonus : 0;
  return review + rating + sales + bestTag;
}

export function getNoveltyScore(product) {
  const ageMs = Date.now() - (product.created_at_ms || 0);
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 0;
  const day = 1000 * 60 * 60 * 24;
  if (ageMs < day * 14) return 35;
  if (ageMs < day * 45) return 22;
  if (ageMs < day * 90) return 10;
  return 0;
}

function scoreByKeywordHints(product, intentSignals) {
  const source = lower(
    `${product.name} ${product.text} ${(product.attributes?.concern_tags || []).join(' ')} ${(product.attributes?.texture_tags || []).join(' ')}`
  );
  let score = 0;

  const keywordGroups = {
    lightweight: ['산뜻', '가벼', '보송', '라이트'],
    moisturizing: ['촉촉', '보습', '수분'],
    low_oily: ['유분', '번들', '피지', '보송'],
    tone_up: ['톤업', '잡티', '커버', '톤 보정'],
    low_white_cast: ['백탁 적', '무백탁', 'white cast'],
    makeup_friendly: ['메이크업', '밀림 적', '궁합'],
    outdoor: ['야외', '골프', '러닝', '운동'],
    reapply_friendly: ['재도포', '덧바름', '휴대'],
    daily: ['데일리', '매일'],
  };

  for (const key of intentSignals.texture) {
    if ((keywordGroups[key] || []).some((kw) => source.includes(lower(kw)))) score += 4;
  }
  for (const key of intentSignals.finish) {
    if ((keywordGroups[key] || []).some((kw) => source.includes(lower(kw)))) score += 4;
  }
  for (const key of intentSignals.useCase) {
    if ((keywordGroups[key] || []).some((kw) => source.includes(lower(kw)))) score += 3;
  }

  return score;
}

export function getConditionScore(product, intent, policy) {
  const signals = mapIntentSignals(intent);
  const derived = product.derived_attributes || {};

  const textureMatches = (signals.texture || []).filter((s) => (derived.texture_signals || []).includes(s)).length;
  const finishMatches = (signals.finish || []).filter((s) => (derived.finish_signals || []).includes(s)).length;
  const useCaseMatches = (signals.useCase || []).filter((s) => (derived.use_case_signals || []).includes(s)).length;

  const concerns = intent.concern || [];
  const concernTags = product.attributes?.concern_tags || [];
  const concernMatchCount = concerns.filter((c) => concernTags.some((t) => lower(t).includes(lower(c)))).length;

  const structuredScore = textureMatches * 10 + finishMatches * 8 + useCaseMatches * 6 + concernMatchCount * 7;
  const keywordScore = scoreByKeywordHints(product, signals);
  return Math.min(policy.scoring.conditionCap, structuredScore + keywordScore);
}

export function getRequestIntentScore(product, intent, policy, conditionScore = 0) {
  if (intent.sort_intent === 'new_arrival') return getNoveltyScore(product);
  if (intent.sort_intent === 'popular') return getQualityScore(product, policy) * 0.8;

  const hasCondition = Boolean(intent.skin_type) || (intent.concern || []).length > 0 || (intent.preference || []).length > 0;
  if (hasCondition) return conditionScore;
  return getQualityScore(product, policy) * 0.6;
}

function getFormMismatchPenalty(product, intent, allowedMainForms, policy) {
  if (!Array.isArray(allowedMainForms) || !allowedMainForms.length) return 0;
  if (!product?.form) return policy.scoring.formMismatchPenalty;
  return allowedMainForms.includes(product.form) ? 0 : policy.scoring.formMismatchPenalty;
}

function getDiversitySoftPenalty(product, context, policy) {
  const lineSeen = context.lineCounts.get(product.line_key || '') || 0;
  const formSeen = context.formCounts.get(product.form || '') || 0;
  return lineSeen * policy.scoring.sameLinePenalty + formSeen * policy.scoring.sameFormPenalty;
}

export function calculateMainScoreBreakdown(product, intent, categoryLocked, policy, context = null) {
  const condition = getConditionScore(product, intent, policy);
  const quality = getQualityScore(product, policy);
  const novelty = intent.novelty_request ? getNoveltyScore(product) : 0;
  const intentFit = getRequestIntentScore(product, intent, policy, condition);
  const promoPenalty = product.is_promo ? policy.scoring.promoPenalty : 0;
  const categoryGate = categoryLocked ? policy.scoring.categoryGate : 0;

  const hasConditionSignal =
    Boolean(intent.skin_type) || (intent.concern || []).length > 0 || (intent.preference || []).length > 0;
  const conditionPriorityBonus =
    hasConditionSignal && condition >= policy.scoring.conditionStrongMatchThreshold ? policy.scoring.conditionPriorityBonus : 0;

  const formMismatchPenalty = getFormMismatchPenalty(product, intent, intent.allowed_main_forms || [], policy);
  const diversityPenalty = context ? getDiversitySoftPenalty(product, context, policy) : 0;

  const baseScore =
    categoryGate +
    condition * policy.scoring.conditionWeight +
    quality * policy.scoring.qualityWeight +
    intentFit * policy.scoring.intentWeight +
    novelty * policy.scoring.noveltyWeight +
    promoPenalty +
    conditionPriorityBonus +
    formMismatchPenalty -
    diversityPenalty;

  const final_rank_reason = hasConditionSignal
    ? `condition_priority(${condition.toFixed(1)}) over quality(${quality.toFixed(1)})`
    : `popular_quality(${quality.toFixed(1)})`;

  return {
    base_score: Number(baseScore.toFixed(3)),
    condition_score: Number(condition.toFixed(3)),
    quality_score: Number(quality.toFixed(3)),
    intent_score: Number(intentFit.toFixed(3)),
    novelty_score: Number(novelty.toFixed(3)),
    promo_penalty: promoPenalty,
    category_gate: categoryGate,
    condition_priority_bonus: conditionPriorityBonus,
    form_mismatch_penalty: formMismatchPenalty,
    diversity_penalty: Number(diversityPenalty.toFixed(3)),
    final_rank_reason,
  };
}

export function calculateMainScore(product, intent, categoryLocked, policy, context = null) {
  return calculateMainScoreBreakdown(product, intent, categoryLocked, policy, context).base_score;
}

export function dedupeByBase(products = []) {
  const seen = new Set();
  const out = [];
  for (const p of products) {
    if (!p || !p.base_name || seen.has(p.base_name)) continue;
    seen.add(p.base_name);
    out.push(p);
  }
  return out;
}

function resolveAllowedMainForms(intent = {}, policy = {}) {
  if (Array.isArray(intent.allowed_main_forms) && intent.allowed_main_forms.length > 0) return intent.allowed_main_forms;
  if (!intent?.requested_category) return [];
  const formPolicy = policy.formPolicy || {};

  if (formPolicy.strictOnExplicitForm && intent.explicit_form_request && intent.requested_form) {
    return [intent.requested_form];
  }
  return formPolicy.defaultMainFormsByCategory?.[intent.requested_category] || [];
}

function resolveRelaxedForms(intent = {}, policy = {}) {
  if (!intent?.requested_category) return [];
  return policy.formPolicy?.relaxedMainFormsByCategory?.[intent.requested_category] || [];
}

function filterByCategory(products, intent, taxonomy) {
  const requestedIds = (intent.requested_category_ids || []).map((n) => Number(n)).filter((n) => Number.isFinite(n));

  if (!intent.requested_category && requestedIds.length === 0) {
    return { pool: products, category_locked: false };
  }

  let pool = products;
  if (requestedIds.length > 0) {
    pool = pool.filter((p) => (p.category_ids || []).some((id) => requestedIds.includes(Number(id))));
  } else if (intent.requested_category) {
    const aliases = taxonomy.categories[intent.requested_category] || [];
    pool = pool.filter((p) => includesAny(`${p.name} ${p.text}`, aliases));
  }
  return { pool, category_locked: true };
}

export function retrievePrimaryCandidates(products = [], intent = {}, taxonomy, policy, options = {}) {
  const { relaxForm = false } = options;
  const { pool, category_locked } = filterByCategory(products, intent, taxonomy);

  if (!category_locked) {
    return { candidates: pool, category_locked: false, form_locked: false, allowed_main_forms: [] };
  }

  const allowedMainForms = relaxForm ? resolveRelaxedForms(intent, policy) : resolveAllowedMainForms(intent, policy);
  if (!Array.isArray(allowedMainForms) || !allowedMainForms.length) {
    return { candidates: pool, category_locked: true, form_locked: false, allowed_main_forms: [] };
  }

  const formFiltered = pool.filter((p) => allowedMainForms.includes(p.form));
  return {
    candidates: formFiltered,
    category_locked: true,
    form_locked: true,
    allowed_main_forms: allowedMainForms,
  };
}

export function selectDiverseTopN(candidates = [], limit = 3, policy = {}) {
  if (!Array.isArray(candidates) || !candidates.length) return [];
  if (!policy.diversity?.enabled) return candidates.slice(0, limit);

  const selected = [];
  const lineCounts = new Map();
  const formCounts = new Map();
  const maxPerLine = Math.max(1, policy.diversity.maxPerLineTopN || 1);
  const maxPerForm = Math.max(1, policy.diversity.maxPerFormTopN || 2);

  const sorted = [...candidates].sort((a, b) => (b._final_score ?? b._base_score ?? 0) - (a._final_score ?? a._base_score ?? 0));

  for (const item of sorted) {
    if (selected.length >= limit) break;
    const lineKey = item.line_key || '';
    const formKey = item.form || '';
    const lineCount = lineCounts.get(lineKey) || 0;
    const formCount = formCounts.get(formKey) || 0;

    if (lineKey && lineCount >= maxPerLine) continue;
    if (formKey && formCount >= maxPerForm) continue;

    selected.push(item);
    if (lineKey) lineCounts.set(lineKey, lineCount + 1);
    if (formKey) formCounts.set(formKey, formCount + 1);
  }

  if (selected.length < Math.min(limit, sorted.length)) {
    for (const item of sorted) {
      if (selected.length >= limit) break;
      if (selected.some((s) => s.id === item.id)) continue;
      selected.push(item);
    }
  }

  return selected;
}

function categoryMatch(item, intent) {
  const requestedIds = (intent.requested_category_ids || []).map((n) => Number(n)).filter((n) => Number.isFinite(n));
  if (requestedIds.length > 0) return (item.category_ids || []).some((id) => requestedIds.includes(Number(id)));
  return item.category_key === intent.requested_category;
}

export function getSecondaryRecommendations(allProducts, intent, mainItems, taxonomy, policy) {
  if (!intent.requested_category) return [];

  const mainBaseSet = new Set((mainItems || []).map((x) => x.base_name));
  const requestedIds = (intent.requested_category_ids || []).map((n) => Number(n)).filter((n) => Number.isFinite(n));
  const allowedMainForms = resolveAllowedMainForms(intent, policy);

  const sameCategoryDifferentForms = allProducts
    .filter((p) => !mainBaseSet.has(p.base_name))
    .filter((p) => categoryMatch(p, intent))
    .filter((p) => !allowedMainForms.includes(p.form))
    .map((p) => ({
      ...p,
      _secondary_score: getQualityScore(p, policy) + getConditionScore(p, intent, policy) + 12,
    }))
    .sort((a, b) => b._secondary_score - a._secondary_score);

  const crossSellCategories = taxonomy.crossSellCategory[intent.requested_category] || [];
  const crossCategory = allProducts
    .filter((p) => !mainBaseSet.has(p.base_name))
    .filter((p) => {
      if (requestedIds.length > 0 && (p.category_ids || []).some((id) => requestedIds.includes(Number(id)))) return false;
      const pseudoCategory = p.category_key || findFirstAliasKey(`${p.name} ${p.text}`, taxonomy.categories);
      return crossSellCategories.includes(pseudoCategory);
    })
    .map((p) => ({
      ...p,
      _secondary_score: getQualityScore(p, policy) + getConditionScore(p, intent, policy),
    }))
    .sort((a, b) => b._secondary_score - a._secondary_score);

  return dedupeByBase([...sameCategoryDifferentForms, ...crossCategory]).slice(0, policy.limits.defaultSecondary);
}

