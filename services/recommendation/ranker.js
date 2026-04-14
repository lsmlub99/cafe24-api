import { findFirstAliasKey, includesAny, lower } from './shared.js';

function mapConditionSignals(intent) {
  const words = [];

  if (intent.skin_type === 'dry') words.push('보습', '수분', '촉촉', '건조', 'hydrat', 'moist');
  if (intent.skin_type === 'oily' || intent.skin_type === 'combination') words.push('산뜻', '가벼', '유분', '번들', '피지');
  if (intent.skin_type === 'sensitive') words.push('저자극', '진정', '민감', '패리어', '시카');

  for (const c of intent.concern || []) {
    if (c === 'hydration') words.push('보습', '수분', '촉촉');
    if (c === 'soothing') words.push('진정', '민감', '저자극', '시카', '패리어');
    if (c === 'sebum_control') words.push('산뜻', '보송', '유분', '피지');
    if (c === 'tone_up') words.push('잡티', '톤', '커버', 'bb');
    if (c === 'uv_protection') words.push('자외선', 'uv', 'sun');
  }

  for (const s of intent.situation || []) {
    if (s === 'outdoor') words.push('가벼', '지속', '재도포', '스틱', '스프레이');
    if (s === 'makeup_before') words.push('밀림', '궁합', '가벼', '얇게');
    if (s === 'daily') words.push('데일리', '매일', '무난');
  }

  for (const p of intent.preference || []) {
    if (p === 'lightweight') words.push('산뜻', '가벼', '보송');
    if (p === 'moisturizing') words.push('촉촉', '보습', '수분');
    if (p === 'low_white_cast') words.push('백탁', '톤');
  }

  return [...new Set(words)];
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

export function getConditionScore(product, intent, policy) {
  const signals = mapConditionSignals(intent);
  if (!signals.length) return 0;
  const source = `${product.name} ${product.text} ${(product.attributes?.concern_tags || []).join(' ')} ${(product.attributes?.texture_tags || []).join(' ')}`;
  return Math.min(
    policy.scoring.conditionCap,
    signals.reduce((acc, s) => acc + (lower(source).includes(lower(s)) ? policy.scoring.conditionHitWeight : 0), 0)
  );
}

export function getRequestIntentScore(product, intent, policy) {
  if (intent.sort_intent === 'new_arrival') return getNoveltyScore(product);
  if (intent.sort_intent === 'popular') return getQualityScore(product, policy) * 0.9;
  return getConditionScore(product, intent, policy);
}

export function calculateMainScore(product, intent, categoryLocked, policy) {
  const categoryGate = categoryLocked ? policy.scoring.categoryGate : 0;
  const condition = getConditionScore(product, intent, policy);
  const intentFit = getRequestIntentScore(product, intent, policy);
  const quality = getQualityScore(product, policy);
  const novelty = intent.novelty_request ? getNoveltyScore(product) : 0;
  const promoPenalty = product.is_promo ? policy.scoring.promoPenalty : 0;
  return categoryGate + condition + intentFit + quality + novelty + promoPenalty;
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

export function retrievePrimaryCandidates(products = [], intent = {}, taxonomy) {
  const requestedIds = (intent.requested_category_ids || []).map((n) => Number(n)).filter((n) => Number.isFinite(n));

  if (!intent.requested_category && requestedIds.length === 0) {
    return { candidates: products, category_locked: false };
  }

  let pool = products;
  if (requestedIds.length > 0) {
    pool = pool.filter((p) => (p.category_ids || []).some((id) => requestedIds.includes(id)));
  } else if (intent.requested_category) {
    const aliases = taxonomy.categories[intent.requested_category] || [];
    pool = pool.filter((p) => includesAny(`${p.name} ${p.text}`, aliases));
  }

  return { candidates: pool, category_locked: true };
}

export function getSecondaryRecommendations(allProducts, intent, mainItems, taxonomy, policy) {
  if (!intent.requested_category) return [];
  const wanted = taxonomy.crossSellCategory[intent.requested_category] || [];
  if (!wanted.length) return [];

  const mainBaseSet = new Set((mainItems || []).map((x) => x.base_name));
  const scored = allProducts
    .filter((p) => !mainBaseSet.has(p.base_name))
    .map((p) => {
      const pseudoCategory = findFirstAliasKey(`${p.name} ${p.text}`, taxonomy.categories);
      if (!wanted.includes(pseudoCategory)) return null;
      return {
        ...p,
        _secondary_score: getQualityScore(p, policy) + getConditionScore(p, intent, policy),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b._secondary_score - a._secondary_score);

  return dedupeByBase(scored).slice(0, policy.limits.defaultSecondary);
}

