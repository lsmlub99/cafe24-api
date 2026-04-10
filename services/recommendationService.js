import OpenAI from 'openai';
import { config } from '../config/env.js';

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
  cream: ['선크림', '썬크림', '선스크린', '썬스크린', 'sun cream', 'sunscreen', 'cream'],
  stick: ['선스틱', '썬스틱', '스틱', 'stick'],
  spray: ['선스프레이', '썬스프레이', 'spray'],
  cushion: ['선쿠션', '썬쿠션', 'cushion'],
  lotion: ['선로션', '썬로션', 'lotion'],
  serum: ['선세럼', '썬세럼', '세럼', 'serum'],
};

const CATEGORY_KEYWORDS = {
  선크림: ['선크림', '썬크림', '자외선', '선케어', 'sunscreen', 'sun'],
  선스틱: ['선스틱', '썬스틱', '스틱', 'stick'],
  크림: ['크림', '보습', 'cream'],
  세럼: ['세럼', '에센스', '앰플', 'serum', 'ampoule'],
  토너: ['토너', '스킨', 'toner'],
  클렌징: ['클렌징', '세안', 'cleansing'],
  마스크팩: ['마스크', '팩', 'mask'],
  비비크림: ['비비', 'bb'],
};

const CONCERN_KEYWORDS = {
  자외선차단: ['자외선', 'uv', 'sun'],
  민감: ['민감', '저자극', '순한', '마일드', '진정'],
  보습: ['보습', '수분', '건조', 'moist'],
  산뜻: ['산뜻', '보송', '번들', '유분', 'light'],
  열감: ['열감', '쿨링', '홍조', '화끈', '시원'],
  진정: ['진정', '시카', 'calm', '병풀'],
  모공: ['모공', '피지', 'pore'],
  커버: ['커버', '잡티', '비비', '메이크업'],
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

    if (concerns.has('민감') || concerns.has('진정')) preferredLines.add('포스트알파');
    if (concerns.has('보습')) preferredLines.add('아쿠아티카');
    if (concerns.has('모공')) preferredLines.add('퍼플티카');

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
      if (c === '자외선차단') concernWords.push('uv', 'sun', 'sunscreen');
      if (c === '민감' || c === '진정') concernWords.push('시카', '진정', '마일드', '저자극');
      if (c === '보습') concernWords.push('보습', '수분', 'moist');
      if (c === '산뜻') concernWords.push('산뜻', '보송', '워터');
      if (c === '열감') concernWords.push('쿨링', '시원', 'cool');
    }
    score += Math.min(36, countHits(text, concernWords) * 6);

    if (intent.requested_form && product.form === intent.requested_form) score += 22;
    if (intent.requested_form && product.form !== intent.requested_form) score -= 8;

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
      console.warn(`[Rerank] skipped: ${e.message}`);
      return candidates;
    }
  },

  buildRecommendationDetails(product, intent) {
    const concerns = intent.concerns || [];
    const reasons = [];
    const tips = [];
    const cautions = [];

    if (concerns.some((c) => String(c).includes('자외선'))) reasons.push('데일리 자외선 차단 목적에 맞는 제품');
    if (concerns.some((c) => String(c).includes('민감') || String(c).includes('진정')))
      reasons.push('민감 피부 기준으로 자극 부담을 낮추는 방향으로 선별');
    if (concerns.some((c) => String(c).includes('보습'))) reasons.push('건조함 완화를 위해 수분감 포인트를 함께 고려');
    if (concerns.some((c) => String(c).includes('열감')) && product.full_text.includes('쿨링'))
      reasons.push('열감이 올라오는 날에 비교적 가볍게 사용할 수 있는 쿨링 계열');

    if (product.form === 'spray') tips.push('외출 중 덧바를 때 빠르게 재도포 가능');
    else if (product.form === 'stick') tips.push('휴대 후 T존/광대 위주로 간편 덧바름 추천');
    else tips.push('기초 마지막 단계에서 2~3회 나눠 바르면 밀림이 적음');

    cautions.push('야외 활동 시 2~3시간 간격 덧바름 권장');
    if (product.full_text.includes('커버') || product.full_text.includes('톤'))
      cautions.push('메이크업과 함께 쓸 때는 소량 레이어링 권장');

    return {
      why_pick: reasons.join(' / ') || '요청 조건에 맞춰 종합 점수로 선별했습니다.',
      usage_tip: tips.join(' / ') || '아침 기초 마지막 단계에서 충분량 도포해 주세요.',
      caution: cautions.join(' / '),
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
        summary: { message: '원하는 피부 타입 또는 고민을 알려주시면 더 정확히 추천해드릴게요.' },
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

    const signature = buildIntentSignature(intent, args);
    const lockedTop1 = getLockedTop1(signature);
    let ordered = reranked;
    if (lockedTop1) {
      const lockIdx = ordered.findIndex((p) => p.base_name === lockedTop1);
      if (lockIdx > 0) {
        const [row] = ordered.splice(lockIdx, 1);
        ordered = [row, ...ordered];
      }
    }

    const core = ordered.filter((p) => !p.is_promo);
    const topSource = core.length ? core : ordered;
    const top = topSource.slice(0, Math.max(1, limit));

    if (top[0]?.base_name) setLockedTop1(signature, top[0].base_name);

    const recommendations = top.map((p, idx) => {
      const details = this.buildRecommendationDetails(p, intent);
      let key = '피부 고민 적합 케어';
      if (p.name.includes('레이저')) key = '장벽 강화 및 보습';
      else if (p.name.includes('아쿠아')) key = '가볍고 촉촉한 수분감';
      else if (p.name.includes('포스트')) key = '민감 피부 진정 케어';
      else if (p.name.includes('시카')) key = '붉은기/자극 완화';
      else if (p.name.includes('선')) key = '자외선 차단 및 데일리 사용';

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

    const strategy = `1차 후보 선별(STAGE1) 후 2차 정밀 재랭크(STAGE2)를 수행했습니다.`;
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
