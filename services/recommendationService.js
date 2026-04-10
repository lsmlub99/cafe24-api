import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 10000,
});

const DEFAULT_RERANK_CANDIDATES = 8;
const DEFAULT_LLM_WEIGHT = 0.6;

const FORM_KEYWORDS = {
  cream: ['선크림', '썬크림', '선스크린', '썬스크린', 'sun cream', 'sunscreen cream', 'sunscreen'],
  stick: ['선스틱', '썬스틱', 'stick'],
  spray: ['선스프레이', '썬스프레이', 'spray'],
  cushion: ['선쿠션', '썬쿠션', 'cushion'],
  lotion: ['선로션', '썬로션', 'lotion'],
};

function safeLower(v) {
  return String(v || '').toLowerCase();
}

function tokenize(raw) {
  return String(raw || '')
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function hasAny(text, words) {
  return words.some((w) => text.includes(safeLower(w)));
}

export const recommendationService = {
  normalizeProduct(p) {
    const cleanPrice = String(p.price || 0).replace(/,/g, '');
    const priceNum = Math.floor(parseFloat(cleanPrice) || 0);

    let thumb = p.list_image || p.detail_image || p.tiny_image || '';
    if (thumb.startsWith('//')) thumb = `https:${thumb}`;
    else if (thumb.startsWith('/')) thumb = `https://cellfusionc.co.kr${thumb}`;
    thumb = thumb.replace('http:', 'https:');

    const name = p.product_name || '';
    const fallbackKeywords = [];
    if (name.includes('선')) fallbackKeywords.push('자외선차단');
    if (name.includes('크림')) fallbackKeywords.push('보습');
    if (name.includes('시카')) fallbackKeywords.push('진정');

    const categories = Array.isArray(p.categories) ? p.categories : [];
    const categoryIds = categories
      .map((c) => Number(c?.category_no))
      .filter((n) => Number.isFinite(n));

    return {
      id: String(p.product_no || p.product_id || ''),
      name,
      price: priceNum.toLocaleString(),
      thumbnail: thumb,
      summary_description: p.summary_description || p.simple_description || '',
      ingredient_text: p.ingredient_text || '',
      keywords: Array.isArray(p.keywords) && p.keywords.length > 0 ? p.keywords : fallbackKeywords,
      attributes: p.attributes || { concern_tags: fallbackKeywords, line_tags: [], texture_tags: [] },
      category_ids: Array.isArray(p.category_ids) && p.category_ids.length > 0 ? p.category_ids : categoryIds,
    };
  },

  detectRequestedForm(intent, args = {}) {
    const raw = safeLower(`${args.category || ''} ${args.query || ''} ${args.q || ''}`);
    if (hasAny(raw, FORM_KEYWORDS.stick)) return 'stick';
    if (hasAny(raw, FORM_KEYWORDS.spray)) return 'spray';
    if (hasAny(raw, FORM_KEYWORDS.cushion)) return 'cushion';
    if (hasAny(raw, FORM_KEYWORDS.lotion)) return 'lotion';
    if (hasAny(raw, FORM_KEYWORDS.cream)) return 'cream';

    if ((intent.target_categories || []).includes('선크림')) return 'cream';
    return null;
  },

  getProductForm(product) {
    const text = safeLower(`${product?.name || ''} ${product?.summary_description || ''}`);
    if (hasAny(text, FORM_KEYWORDS.stick)) return 'stick';
    if (hasAny(text, FORM_KEYWORDS.spray)) return 'spray';
    if (hasAny(text, FORM_KEYWORDS.cushion)) return 'cushion';
    if (hasAny(text, FORM_KEYWORDS.lotion)) return 'lotion';
    if (hasAny(text, FORM_KEYWORDS.cream)) return 'cream';
    return 'other';
  },

  matchesRequestedForm(product, requestedForm) {
    if (!requestedForm) return true;
    return this.getProductForm(product) === requestedForm;
  },

  calculateScore(product, intent) {
    let score = 0;
    const attrs = product.attributes || {};
    const name = safeLower(product.name);
    const desc = safeLower(product.summary_description);
    const text = `${name} ${desc}`;

    const productCatIds = (product.category_ids || []).map((id) => String(id));
    const targetCatIds = (intent.target_category_ids || []).map((id) => String(id));
    const hasCategoryMatch =
      (intent.target_categories || []).some((cat) => {
        const catStr = safeLower(cat);
        return text.includes(catStr) || productCatIds.includes(catStr);
      }) || productCatIds.some((id) => targetCatIds.includes(id));

    if (hasCategoryMatch) score += 120;
    else if ((intent.target_categories || []).length > 0) score -= 40;

    const lineTags = attrs.line_tags || [];
    if (intent.preferred_lines.size > 0 && lineTags.some((l) => intent.preferred_lines.has(l))) {
      score += 35;
    }

    const concernTags = attrs.concern_tags || [];
    const matchedConcerns = concernTags.filter((c) => (intent.concerns || []).includes(c));
    score += matchedConcerns.length * 30;

    const textureTags = attrs.texture_tags || [];
    if ((intent.textures || []).some((t) => textureTags.some((pt) => String(pt).includes(t)))) score += 25;
    if ((intent.avoid_textures || []).some((t) => textureTags.some((pt) => String(pt).includes(t)))) score -= 60;

    const concerns = (intent.concerns || []).join(' ');
    if ((concerns.includes('자외선') || concerns.includes('데일리')) && (text.includes('선') || text.includes('uv'))) {
      score += 20;
    }
    if ((concerns.includes('민감') || concerns.includes('저자극') || concerns.includes('진정')) &&
        (text.includes('시카') || text.includes('마일드') || text.includes('저자극') || text.includes('calm'))) {
      score += 25;
    }
    if ((concerns.includes('산뜻') || concerns.includes('번들')) &&
        (text.includes('산뜻') || text.includes('보송') || text.includes('워터') || text.includes('가벼'))) {
      score += 20;
    }

    return { score };
  },

  extractJsonObject(text = '') {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  },

  buildIntentSummary(intent, args = {}) {
    return {
      category: args.category || '',
      skin_type: args.skin_type || '',
      concerns: Array.isArray(args.concerns) ? args.concerns : [],
      query: intent.query || '',
      target_categories: intent.target_categories || [],
      detected_concerns: intent.concerns || [],
      preferred_textures: intent.textures || [],
      avoid_textures: intent.avoid_textures || [],
      requested_form: intent.requested_form || null,
    };
  },

  async rerankWithLLM(candidates, intent, args = {}) {
    if (!Array.isArray(candidates) || candidates.length < 2) return candidates;
    if (!config.OPENAI_API_KEY) return candidates;

    const model = config.RERANK_MODEL || 'gpt-4o-mini';
    const candidatePayload = candidates.map((p) => ({
      id: String(p.id),
      name: p.name,
      form: this.getProductForm(p),
      base_score: p._score || 0,
      price: p.price,
      summary_description: p.summary_description || '',
      ingredient_text: String(p.ingredient_text || '').slice(0, 800),
      keywords: Array.isArray(p.keywords) ? p.keywords.slice(0, 8) : [],
      concern_tags: p.attributes?.concern_tags || [],
      texture_tags: p.attributes?.texture_tags || [],
    }));

    const systemPrompt = [
      'You are a strict skincare product reranker.',
      'Only reorder from provided candidates.',
      'Never invent new ids or products.',
      'If requested_form is set, prioritize exact form match strongly.',
      'When ingredient_text is available, use it for sensitive-skin safety and irritation risk judgment.',
      'Return JSON only:',
      '{"ordered_ids":["id1","id2"],"reason":"short"}',
    ].join(' ');

    const userPrompt = JSON.stringify({
      intent: this.buildIntentSummary(intent, args),
      candidates: candidatePayload,
    });

    try {
      const response = await openai.responses.create({
        model,
        temperature: 0.2,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      const parsed = this.extractJsonObject((response.output_text || '').trim());
      const orderedIds = Array.isArray(parsed?.ordered_ids)
        ? parsed.ordered_ids.map((id) => String(id))
        : [];
      if (orderedIds.length === 0) return candidates;

      const idSet = new Set(candidates.map((p) => String(p.id)));
      const validOrdered = orderedIds.filter((id) => idSet.has(id));
      if (validOrdered.length === 0) return candidates;

      const maxBase = Math.max(...candidates.map((p) => p._score || 0), 1);
      const rankScore = new Map(validOrdered.map((id, idx) => [id, validOrdered.length - idx]));

      return candidates
        .map((p) => {
          const id = String(p.id);
          const baseNorm = ((p._score || 0) / maxBase) * 100;
          const llmNorm = ((rankScore.get(id) || 0) / validOrdered.length) * 100;
          const blended = baseNorm * (1 - DEFAULT_LLM_WEIGHT) + llmNorm * DEFAULT_LLM_WEIGHT;
          return { ...p, _final_score: blended };
        })
        .sort((a, b) => {
          if ((b._final_score || 0) !== (a._final_score || 0)) {
            return (b._final_score || 0) - (a._final_score || 0);
          }
          return (b._score || 0) - (a._score || 0);
        });
    } catch (err) {
      console.warn(`[Rerank] LLM rerank skipped: ${err.message}`);
      return candidates;
    }
  },

  enforceRequestedFormOrdering(products, requestedForm) {
    if (!requestedForm) return products;
    const matches = products.filter((p) => this.matchesRequestedForm(p, requestedForm));
    const others = products.filter((p) => !this.matchesRequestedForm(p, requestedForm));
    if (matches.length === 0) return products;
    return [...matches, ...others];
  },

  async scoreAndFilterProducts(cachedProducts, args, limit = 3) {
    if (!cachedProducts || cachedProducts.length === 0) {
      return { recommendations: [], summary: { message: '데이터가 없습니다.' } };
    }

    const intent = this.normalizeUserIntent(args);
    intent.requested_form = this.detectRequestedForm(intent, args);

    if (!intent.has_intent) {
      return {
        recommendations: [],
        summary: {
          message: '원하는 피부 타입 또는 카테고리를 말씀해주시면 더 정확히 추천해드릴게요.',
        },
      };
    }

    const normalized = cachedProducts.map((p) => this.normalizeProduct(p));
    const scored = normalized
      .map((p) => ({ ...p, _score: this.calculateScore(p, intent).score }))
      .filter((p) => p._score > 0)
      .sort((a, b) => b._score - a._score);

    const seenNames = new Set();
    const candidatePool = [];
    const poolLimit = Math.max(limit * 3, DEFAULT_RERANK_CANDIDATES);
    for (const p of scored) {
      const baseName = p.name.replace(/\[.*?\]/g, '').trim();
      if (!seenNames.has(baseName)) {
        seenNames.add(baseName);
        candidatePool.push(p);
      }
      if (candidatePool.length >= poolLimit) break;
    }

    if (candidatePool.length === 0) {
      return { recommendations: [], summary: { message: '조건에 맞는 결과가 없습니다.' } };
    }

    const formMatchedPool = intent.requested_form
      ? candidatePool.filter((p) => this.matchesRequestedForm(p, intent.requested_form))
      : candidatePool;
    const poolForRerank = formMatchedPool.length > 0 ? formMatchedPool : candidatePool;
    const rerankedPool = await this.rerankWithLLM(poolForRerank, intent, args);
    const finalFiltered = rerankedPool.slice(0, limit);

    const recommendations = finalFiltered.map((p, idx) => {
      let keyPoint = '피부 고민 적합 케어';
      const name = p.name;
      if (name.includes('레이저')) keyPoint = '장벽 강화 및 보습';
      else if (name.includes('아쿠아')) keyPoint = '가볍고 촉촉한 수분감';
      else if (name.includes('포스트')) keyPoint = '민감 피부 진정 케어';
      else if (name.includes('시카')) keyPoint = '붉은기/자극 완화';
      else if (name.includes('선')) keyPoint = '자외선 차단 및 데일리 사용';

      return {
        rank: idx + 1,
        rank_label: idx === 0 ? '1위(BEST)' : `${idx + 1}위`,
        name: p.name,
        price: p.price,
        key_point: keyPoint,
        buy_url: `https://cellfusionc.co.kr/product/detail.html?product_no=${p.id}`,
        image: p.thumbnail,
      };
    });

    const strategy =
      (intent.target_categories || []).length > 0
        ? `${intent.target_categories.join(', ')} 카테고리에서 룰베이스 1차 선별 후 LLM 재랭킹을 수행했습니다.`
        : `피부 고민/사용감 기준 룰베이스 점수화 후 LLM 재랭킹을 수행했습니다.`;

    const formText = intent.requested_form ? ` 요청 제형(${intent.requested_form})을 우선 반영했습니다.` : '';
    const conclusion = `분석 결과, ${recommendations[0].name} 제품이 현재 요청 조건에 가장 적합합니다.${formText}`;

    return {
      recommendations,
      summary: {
        message: '고객님을 위한 최적 상품입니다.',
        strategy,
        conclusion,
      },
    };
  },

  normalizeUserIntent(args) {
    const rawQuery = safeLower(args.q || args.query || '');
    const rawTypes = tokenize(args.skin_type || '');

    const categoryKeywords = {
      선크림: ['선크림', '썬크림', '자외선', '선케어', 'sunscreen', 'sun'],
      선스틱: ['선스틱', '썬스틱', '스틱', 'stick'],
      크림: ['크림', '보습', '수분', 'cream'],
      세럼: ['세럼', '에센스', '앰플', 'serum', 'ampoule'],
      토너: ['토너', '스킨', 'toner'],
      클렌징: ['클렌징', '세안', 'cleansing'],
      마스크팩: ['마스크', '팩', 'mask'],
      비비크림: ['비비', 'bb'],
    };

    const concernKeywords = {
      진정: ['진정', '붉은', '민감', 'calm', '시카', '병풀'],
      보습: ['건조', '보습', '수분', 'moist', '아쿠아'],
      커버: ['커버', '잡티', '가림', '비비', '메이크업'],
      시원: ['쿨링', '시원', '산뜻', '가벼운', 'fresh'],
      모공: ['모공', '피지', '유분', 'pore'],
      저자극: ['저자극', '순한', '마일드', 'mild'],
    };

    const detectedCategories = new Set(args.category_aliases || [args.category].filter(Boolean));
    const detectedConcerns = new Set(Array.isArray(args.concerns) ? args.concerns : []);

    if (rawQuery) {
      Object.entries(categoryKeywords).forEach(([cat, keys]) => {
        if (keys.some((k) => rawQuery.includes(safeLower(k)))) detectedCategories.add(cat);
      });
      Object.entries(concernKeywords).forEach(([con, keys]) => {
        if (keys.some((k) => rawQuery.includes(safeLower(k)))) detectedConcerns.add(con);
      });
    }

    const preferredLines = new Set();
    const textures = new Set();
    const avoidTextures = new Set();

    if (detectedConcerns.has('진정') || detectedConcerns.has('저자극')) preferredLines.add('포스트알파');
    if (detectedConcerns.has('보습')) preferredLines.add('아쿠아티카');
    if (detectedConcerns.has('모공')) preferredLines.add('퍼플티카');
    if (detectedConcerns.has('커버')) preferredLines.add('토닝');

    rawTypes.forEach((type) => {
      if (type === '지성' || type === '복합성') {
        ['가벼움', '산뜻', '워터리'].forEach((tx) => textures.add(tx));
      } else if (type === '건성') {
        textures.add('리치');
      } else if (type === '민감성') {
        avoidTextures.add('알코올');
      }
    });

    return {
      query: rawQuery,
      target_categories: Array.from(detectedCategories),
      target_category_ids: Array.isArray(args.target_category_ids) ? args.target_category_ids : [],
      category_excludes: [],
      concerns: Array.from(detectedConcerns),
      preferred_lines: preferredLines,
      textures: Array.from(textures),
      avoid_textures: Array.from(avoidTextures),
      requested_form: null,
      has_intent:
        detectedCategories.size > 0 ||
        detectedConcerns.size > 0 ||
        rawTypes.length > 0 ||
        (Array.isArray(args.target_category_ids) && args.target_category_ids.length > 0),
    };
  },
};
