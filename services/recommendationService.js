import OpenAI from 'openai';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 10000,
});

const STAGE1_TOP_K = 40;
const STAGE2_TOP_K = 12;
const DEFAULT_LIMIT = 3;
const LLM_WEIGHT = 0.5;
const TOP1_LOCK_TTL_MS = 1000 * 60 * 30;

const top1Lock = new Map();

const FORM_KEYWORDS = {
  cream: ['선크림', '썬크림', 'sunscreen', 'sun cream', 'cream'],
  stick: ['선스틱', '썬스틱', 'stick', 'sun stick'],
  spray: ['선스프레이', '썬스프레이', 'spray', 'sun spray'],
  cushion: ['선쿠션', '썬쿠션', 'cushion', 'sun cushion'],
  lotion: ['선로션', '썬로션', 'lotion', 'sun lotion'],
  serum: ['선세럼', '썬세럼', '세럼', 'serum', 'sun serum'],
};

const CATEGORY_KEYWORDS = {
  선크림: ['선크림', '썬크림', '자외선', '선케어', 'sunscreen', 'sun'],
  선스틱: ['선스틱', '썬스틱', 'stick', 'sun stick'],
  크림: ['크림', '보습', 'cream'],
  세럼: ['세럼', '앰플', 'serum', 'ampoule'],
  토너: ['토너', '스킨', 'toner'],
  클렌징: ['클렌징', '세안', 'cleansing'],
  마스크팩: ['마스크', '팩', 'mask'],
  비비크림: ['비비', 'bb'],
};

const CONCERN_KEYWORDS = {
  자외선차단: ['자외선', 'uv', 'sun'],
  민감: ['민감', '저자극', '진정', 'sensitive', 'calm'],
  보습: ['보습', '수분', '건조', 'moist', 'hydrat'],
  산뜻: ['산뜻', '보송', '유분', '번들', 'light'],
  쿨링: ['쿨링', '열감', '시원', 'cool'],
  모공: ['모공', '피지', 'pore', 'sebum'],
  커버: ['커버', '잡티', '비비', 'makeup', 'tone'],
};

const FORM_REGEX = {
  cream: /(크림|cream|젤\s*크림|gel\s*cream)/i,
  stick: /(스틱|stick|스틱밤|stick\s*balm|밤\b|balm)/i,
  spray: /(스프레이|spray|미스트|mist)/i,
  cushion: /(쿠션|cushion)/i,
  lotion: /(로션|lotion)/i,
  serum: /(세럼|serum|앰플|ampoule)/i,
};

function lower(v) {
  return String(v || '').toLowerCase();
}

function tokens(v) {
  return String(v || '')
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function countHits(text, words = []) {
  const t = lower(text);
  if (!t) return 0;
  let n = 0;
  for (const w of [...new Set(words.map((x) => lower(x)))]) {
    if (w && t.includes(w)) n += 1;
  }
  return n;
}

function toBaseName(name = '') {
  return String(name || '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\b(1\+1|2\+1|3\+1)\b/gi, ' ')
    .replace(/\b(mini|미니|미니어처)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPromoName(name = '') {
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

function parsePrice(value) {
  const num = parseFloat(String(value || '0').replace(/,/g, ''));
  return Number.isFinite(num) ? Math.floor(num) : 0;
}

function buildIntentSignature(intent, args = {}) {
  const a = [...(intent.target_categories || [])].sort().join('|');
  const b = [...(intent.concerns || [])].sort().join('|');
  const c = String(args.skin_type || '').trim();
  const d = String(intent.requested_form || '').trim();
  return `${a}__${b}__${c}__${d}`;
}

function getLockedTop1(signature) {
  const row = top1Lock.get(signature);
  if (!row) return null;
  if (Date.now() - row.ts > TOP1_LOCK_TTL_MS) {
    top1Lock.delete(signature);
    return null;
  }
  return row.baseName;
}

function setLockedTop1(signature, baseName) {
  if (!signature || !baseName) return;
  top1Lock.set(signature, { baseName, ts: Date.now() });
}

function parseJsonObject(text = '') {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < 0 || e <= s) return null;
  try {
    return JSON.parse(text.slice(s, e + 1));
  } catch {
    return null;
  }
}

function includesAny(text, words = []) {
  const t = lower(text);
  return words.some((w) => t.includes(lower(w)));
}

export const recommendationService = {
  normalizeUserIntent(args = {}) {
    const q = lower(args.q || args.query || '');
    const skinType = String(args.skin_type || '').trim();

    const categories = new Set(args.category_aliases || [args.category].filter(Boolean));
    const concerns = new Set(Array.isArray(args.concerns) ? args.concerns : []);

    if (q) {
      for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
        if (words.some((w) => q.includes(lower(w)))) categories.add(cat);
      }
      for (const [c, words] of Object.entries(CONCERN_KEYWORDS)) {
        if (words.some((w) => q.includes(lower(w)))) concerns.add(c);
      }
    }

    const preferredLines = new Set();
    const textures = new Set();
    const avoidTextures = new Set();

    if (concerns.has('민감')) preferredLines.add('패리어');
    if (concerns.has('보습')) preferredLines.add('아쿠아티카');
    if (concerns.has('모공')) preferredLines.add('포어');

    for (const t of tokens(skinType)) {
      if (t === '지성' || t === '복합성') ['가벼움', '산뜻', '워터리'].forEach((x) => textures.add(x));
      if (t === '건성') textures.add('리치');
      if (t === '민감성') avoidTextures.add('알코올');
    }

    return {
      query: q,
      target_categories: Array.from(categories),
      target_category_ids: Array.isArray(args.target_category_ids) ? args.target_category_ids : [],
      concerns: Array.from(concerns),
      preferred_lines: preferredLines,
      textures: Array.from(textures),
      avoid_textures: Array.from(avoidTextures),
      requested_form: null,
      has_intent:
        categories.size > 0 ||
        concerns.size > 0 ||
        tokens(skinType).length > 0 ||
        (Array.isArray(args.target_category_ids) && args.target_category_ids.length > 0),
    };
  },

  detectRequestedForm(intent, args = {}) {
    const raw = lower(`${args.category || ''} ${args.query || ''} ${args.q || ''}`);
    for (const [form, words] of Object.entries(FORM_KEYWORDS)) {
      if (words.some((w) => raw.includes(lower(w)))) return form;
    }
    if ((intent.target_categories || []).includes('선크림')) return 'cream';
    return null;
  },

  normalizeProduct(p) {
    const name = p.product_name || p.name || '';
    const resolvedPrice = parsePrice(p.price || p.retail_price || 0);
    const categoryIds = Array.isArray(p.categories)
      ? p.categories.map((c) => Number(c?.category_no)).filter((n) => Number.isFinite(n))
      : Array.isArray(p.category_ids)
      ? p.category_ids.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [];

    let image = p.list_image || p.detail_image || p.tiny_image || p.image || '';
    if (image.startsWith('//')) image = `https:${image}`;
    else if (image.startsWith('/')) image = `https://cellfusionc.co.kr${image}`;
    image = image.replace('http:', 'https:');

    const fullText = lower(
      `${name} ${p.summary_description || ''} ${p.simple_description || ''} ${p.search_preview || ''} ${p.search_features || ''}`
    );

    return {
      id: String(p.product_no || p.product_id || p.id || ''),
      name,
      base_name: toBaseName(name),
      is_promo: isPromoName(name),
      price: resolvedPrice.toLocaleString(),
      thumbnail: image,
      summary_description: p.summary_description || p.simple_description || '',
      ingredient_text: p.ingredient_text || '',
      search_preview: p.search_preview || '',
      search_features: p.search_features || '',
      keywords: Array.isArray(p.keywords) ? p.keywords : [],
      attributes: p.attributes || { concern_tags: [], line_tags: [], texture_tags: [] },
      category_ids: categoryIds,
      form: this.detectProductForm(fullText),
      full_text: fullText,
    };
  },

  detectProductForm(fullText = '') {
    const t = String(fullText || '');
    for (const [form, re] of Object.entries(FORM_REGEX)) {
      if (re.test(t)) return form;
    }
    for (const [form, words] of Object.entries(FORM_KEYWORDS)) {
      if (words.some((w) => fullText.includes(lower(w)))) return form;
    }
    return 'other';
  },

  stage1Score(product, intent) {
    const text = product.full_text;
    const productCatIds = (product.category_ids || []).map((id) => String(id));
    const targetCatIds = (intent.target_category_ids || []).map((id) => String(id));

    if (targetCatIds.length > 0 && !productCatIds.some((id) => targetCatIds.includes(id))) {
      return -999;
    }

    let score = 0;
    const hasCategoryMatch =
      (intent.target_categories || []).some((cat) => text.includes(lower(cat))) ||
      productCatIds.some((id) => targetCatIds.includes(id));

    if (hasCategoryMatch) score += 120;
    else if ((intent.target_categories || []).length > 0) score -= 35;

    const lineTags = product.attributes?.line_tags || [];
    if (intent.preferred_lines.size > 0 && lineTags.some((l) => intent.preferred_lines.has(l))) score += 30;

    const concernTags = product.attributes?.concern_tags || [];
    score += concernTags.filter((c) => (intent.concerns || []).includes(c)).length * 24;

    const textureTags = product.attributes?.texture_tags || [];
    if ((intent.textures || []).some((t) => textureTags.some((pt) => String(pt).includes(t)))) score += 20;
    if ((intent.avoid_textures || []).some((t) => textureTags.some((pt) => String(pt).includes(t)))) score -= 45;

    const concernWords = [];
    for (const c of intent.concerns || []) {
      concernWords.push(c);
      if (c === '자외선차단') concernWords.push('uv', 'sun', 'sunscreen', '자외선');
      if (c === '민감') concernWords.push('진정', '민감', '저자극', '시카', '패리어');
      if (c === '보습') concernWords.push('보습', '수분', 'moist', 'hydrat');
      if (c === '산뜻') concernWords.push('산뜻', '보송', '유분', '번들', 'light');
      if (c === '쿨링') concernWords.push('쿨링', '시원', '열감', 'cool');
      if (c === '모공') concernWords.push('모공', '피지', 'pore', 'sebum');
      if (c === '커버') concernWords.push('커버', '톤업', '잡티', 'bb', 'tone');
    }
    score += Math.min(36, countHits(text, concernWords) * 6);

    if (intent.requested_form && product.form === intent.requested_form) score += 40;
    if (intent.requested_form && product.form !== intent.requested_form) score -= 55;

    if (product.is_promo) score -= 16;
    return score;
  },

  async stage2Rerank(candidates, intent, args = {}) {
    if (!Array.isArray(candidates) || candidates.length < 2) return candidates;
    if (!config.OPENAI_API_KEY) return candidates;

    const model = config.RERANK_MODEL || 'gpt-4o-mini';
    const payload = candidates.map((p) => ({
      id: p.id,
      name: p.name,
      base_name: p.base_name,
      is_promo: p.is_promo,
      form: p.form,
      base_score: p._stage1,
      price: p.price,
      summary: p.summary_description,
      preview: String(p.search_preview || '').slice(0, 300),
      ingredient_text: String(p.ingredient_text || '').slice(0, 500),
      concern_tags: p.attributes?.concern_tags || [],
      texture_tags: p.attributes?.texture_tags || [],
    }));

    const systemPrompt = [
      'You rerank skincare product candidates.',
      'Never invent products.',
      'Keep recommendations aligned to user intent.',
      'Prefer non-promo item for rank #1 unless promo is clearly better.',
      'If requested form exists, strongly prioritize it.',
      'Return JSON only:',
      '{"ordered_ids":["id1","id2"],"reason":"short"}',
    ].join(' ');

    const userPrompt = JSON.stringify({
      intent: {
        category: args.category || '',
        skin_type: args.skin_type || '',
        concerns: intent.concerns || [],
        query: intent.query || '',
        requested_form: intent.requested_form || null,
      },
      candidates: payload,
    });

    try {
      const res = await openai.responses.create({
        model,
        temperature: 0.2,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      const parsed = parseJsonObject((res.output_text || '').trim());
      const ordered = Array.isArray(parsed?.ordered_ids) ? parsed.ordered_ids.map((x) => String(x)) : [];
      if (!ordered.length) return candidates;

      const idSet = new Set(candidates.map((p) => p.id));
      const valid = ordered.filter((id) => idSet.has(id));
      if (!valid.length) return candidates;

      const maxBase = Math.max(...candidates.map((p) => p._stage1 || 0), 1);
      const rankMap = new Map(valid.map((id, idx) => [id, valid.length - idx]));
      return candidates
        .map((p) => {
          const baseNorm = ((p._stage1 || 0) / maxBase) * 100;
          const llmNorm = ((rankMap.get(p.id) || 0) / valid.length) * 100;
          return { ...p, _final: baseNorm * (1 - LLM_WEIGHT) + llmNorm * LLM_WEIGHT };
        })
        .sort((a, b) => (b._final || 0) - (a._final || 0));
    } catch (e) {
      logger.warn(`[Rerank] skipped: ${e.message}`);
      return candidates;
    }
  },

  buildRecommendationDetails(product, intent) {
    const concerns = Array.isArray(intent.concerns) ? intent.concerns.map((x) => String(x)) : [];
    const concernText = concerns.join(' ').toLowerCase();
    const lineTags = Array.isArray(product.attributes?.line_tags) ? product.attributes.line_tags : [];
    const concernTags = Array.isArray(product.attributes?.concern_tags) ? product.attributes.concern_tags : [];
    const textureTags = Array.isArray(product.attributes?.texture_tags) ? product.attributes.texture_tags : [];
    const text = String(product.full_text || '').toLowerCase();

    const reasons = [];
    const tips = [];
    const cautions = [];

    const hasSun = includesAny(concernText, ['자외', 'uv', 'sun']);
    const hasSensitive = includesAny(concernText, ['민감', '진정', '저자극']);
    const hasMoist = includesAny(concernText, ['보습', '수분', '건조']);
    const hasOil = includesAny(concernText, ['지성', '번들', '유분', '산뜻']);
    const hasCooling = includesAny(concernText, ['쿨링', '열감']);

    if (hasSun && (includesAny(text, ['sun', '자외']) || concernTags.some((t) => String(t).includes('자외')))) {
      reasons.push('자외선 차단 목적에 맞는 선케어 포인트가 확인되는 제품이에요.');
    }
    if (
      hasSensitive &&
      (concernTags.some((t) => includesAny(String(t), ['진정', '민감'])) ||
        lineTags.some((l) => includesAny(String(l), ['패리어', '시카'])))
    ) {
      reasons.push('민감/진정 조건과 맞는 태그(진정·패리어·시카 라인)가 함께 잡혔어요.');
    }
    if (
      hasMoist &&
      (concernTags.some((t) => includesAny(String(t), ['수분', '보습'])) ||
        textureTags.some((t) => includesAny(String(t), ['촉촉', '리치'])))
    ) {
      reasons.push('건조·수분 고민에 맞춰 보습/수분 관련 신호가 있는 후보예요.');
    }
    if (
      hasOil &&
      (textureTags.some((t) => includesAny(String(t), ['산뜻', '가벼'])) ||
        includesAny(text, ['sebum', 'pore', '피지', '모공']))
    ) {
      reasons.push('유분/번들 고민에 맞게 가벼운 사용감 계열 신호가 반영됐어요.');
    }
    if (hasCooling && (includesAny(text, ['쿨링', 'cool']) || lineTags.some((l) => String(l).includes('아쿠아티카')))) {
      reasons.push('열감/진정 니즈에 맞춰 쿨링 또는 진정 계열 문맥이 확인됐어요.');
    }

    if (product.form === 'spray') {
      tips.push('분사형이라 야외 활동 중 덧바르기 편하고, 빠르게 재도포하기 좋아요.');
    } else if (product.form === 'stick') {
      tips.push('스틱형이라 휴대/위생 관리가 편하고, 메이크업 위에 가볍게 덧바르기 좋아요.');
    } else if (product.form === 'serum') {
      tips.push('세럼형은 얇게 레이어링하기 쉬워 답답함을 줄이면서 사용하기 편해요.');
    } else {
      tips.push('기초 마지막 단계에서 2~3회 나눠 바르면 밀림을 줄이고 밀착감을 높일 수 있어요.');
    }

    cautions.push('야외 활동이 길면 2~3시간 간격 재도포를 권장해요.');
    if (includesAny(text, ['tone', '톤', 'cover', '커버'])) {
      cautions.push('톤/커버 계열은 한 번에 많이 바르기보다 소량 레이어링이 더 자연스러워요.');
    }

    const fallbackReasonParts = [];
    if (product.form && product.form !== 'other') fallbackReasonParts.push(`${product.form} 제형 적합성`);
    if (concernTags.length) fallbackReasonParts.push(`고민 태그 매칭(${concernTags.slice(0, 2).join(', ')})`);
    if (lineTags.length) fallbackReasonParts.push(`라인 일치(${lineTags[0]})`);

    return {
      why_pick:
        reasons.join(' ') ||
        (fallbackReasonParts.length
          ? `요청 조건과의 일치도가 높아 선별됐어요. (${fallbackReasonParts.join(' · ')})`
          : '요청 조건과의 종합 점수가 높아 우선 추천됐어요.'),
      usage_tip: tips.join(' '),
      caution: cautions.join(' '),
    };
  },

  async scoreAndFilterProducts(cachedProducts, args = {}, limit = DEFAULT_LIMIT) {
    if (!Array.isArray(cachedProducts) || cachedProducts.length === 0) {
      return { recommendations: [], promotions: [], summary: { message: '데이터가 없습니다.' } };
    }

    const intent = this.normalizeUserIntent(args);
    intent.requested_form = this.detectRequestedForm(intent, args);

    if (!intent.has_intent) {
      return {
        recommendations: [],
        promotions: [],
        summary: { message: '원하는 피부 타입이나 제품군을 말씀해주시면 더 정확히 추천해드릴게요.' },
      };
    }

    const normalized = cachedProducts.map((p) => this.normalizeProduct(p));
    const stage1 = normalized
      .map((p) => ({ ...p, _stage1: this.stage1Score(p, intent) }))
      .filter((p) => p._stage1 > 0)
      .sort((a, b) => b._stage1 - a._stage1)
      .slice(0, STAGE1_TOP_K);

    if (!stage1.length) {
      return { recommendations: [], promotions: [], summary: { message: '조건에 맞는 결과가 없습니다.' } };
    }

    const seenBase = new Set();
    const dedup = [];
    for (const p of stage1) {
      if (!seenBase.has(p.base_name)) {
        seenBase.add(p.base_name);
        dedup.push(p);
      }
      if (dedup.length >= STAGE2_TOP_K) break;
    }

    const reranked = await this.stage2Rerank(dedup, intent, args);

    // If user explicitly asked a form (e.g. cream/stick/spray), keep same-form items first.
    let formAligned = reranked;
    if (intent.requested_form) {
      const sameForm = reranked.filter((p) => p.form === intent.requested_form);
      const otherForm = reranked.filter((p) => p.form !== intent.requested_form);
      if (sameForm.length > 0) {
        formAligned = [...sameForm, ...otherForm];
      }
    }

    const signature = buildIntentSignature(intent, args);
    const lockedTop1 = getLockedTop1(signature);
    let ordered = formAligned;
    if (lockedTop1) {
      const lockIdx = ordered.findIndex((p) => p.base_name === lockedTop1);
      if (lockIdx > 0) {
        const [row] = ordered.splice(lockIdx, 1);
        ordered = [row, ...ordered];
      }
    }

    const core = ordered.filter((p) => !p.is_promo);
    let topSource = core.length ? core : ordered;
    if (intent.requested_form) {
      const formFirst = topSource.filter((p) => p.form === intent.requested_form);
      if (formFirst.length > 0) {
        const rest = topSource.filter((p) => p.form !== intent.requested_form);
        topSource = [...formFirst, ...rest];
      }
    }
    const top = topSource.slice(0, Math.max(1, limit));

    if (top[0]?.base_name) setLockedTop1(signature, top[0].base_name);

    const recommendations = top.map((p, idx) => {
      const details = this.buildRecommendationDetails(p, intent);
      let key = '요청 조건 종합 케어';
      if (includesAny(p.name, ['레이저'])) key = '장벽 강화/보습';
      else if (includesAny(p.name, ['아쿠아티카'])) key = '가볍고 촉촉한 수분감';
      else if (includesAny(p.name, ['패리어'])) key = '민감 피부 진정 케어';
      else if (includesAny(p.name, ['시카'])) key = '붉은기/자극 완화';
      else if (includesAny(p.name, ['썬', 'sun'])) key = '자외선 차단 데일리 케어';

      return {
        rank: idx + 1,
        rank_label: idx === 0 ? '1위(BEST)' : `${idx + 1}위`,
        name: p.name,
        base_name: p.base_name,
        price: p.price,
        key_point: key,
        why_pick: details.why_pick,
        usage_tip: details.usage_tip,
        caution: details.caution,
        is_promo: !!p.is_promo,
        buy_url: `https://cellfusionc.co.kr/product/detail.html?product_no=${p.id}`,
        image: p.thumbnail,
      };
    });

    const recBase = new Set(recommendations.map((r) => r.base_name));
    const promotions = normalized
      .filter((p) => p.is_promo && recBase.has(p.base_name))
      .slice(0, 4)
      .map((p) => ({
        name: p.name,
        base_name: p.base_name,
        price: p.price,
        buy_url: `https://cellfusionc.co.kr/product/detail.html?product_no=${p.id}`,
        image: p.thumbnail,
      }));

    const strategy = '피부 타입, 고민, 제형을 함께 반영해 가장 잘 맞는 후보를 추천했습니다.';
    const conclusion = `분석 결과, ${recommendations[0].name} 제품이 현재 요청 조건에 가장 적합합니다.`;

    return {
      recommendations,
      promotions,
      summary: {
        message: '고객님을 위한 최적 상품입니다.',
        strategy,
        conclusion,
      },
    };
  },
};
