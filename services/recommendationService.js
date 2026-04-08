import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * 👑 [Invincible Recommendation Engine 6.8]
 * OpenAI의 JSON 모드 정책 준수 및 Fallback 데이터 완결성을 확보한 버전입니다.
 */
export const recommendationService = {

  normalizeText(text) {
    return (text || '').toLowerCase().replace(/\s+/g, '').trim();
  },

  matchesCategory(p, category) {
    if (!category) return true;
    const name = recommendationService.normalizeText(p.product_name);
    const cat = recommendationService.normalizeText(category);
    const map = {
      '선': ['선', '썬', 'sun', '스틱', '스프레이'],
      '앰플': ['앰플', '세럼', '에센스', 'ampoule', 'serum'],
      '토너': ['토너', '패드', '스킨', 'toner'],
      '크림': ['크림', '밤', '보습', 'cream', 'balm'],
      '클렌징': ['클렌징', '폼', '오일', '워터'],
      '팩': ['팩', '마스크', 'mask']
    };
    const keywords = map[cat.slice(0, 2)] || [cat];
    return keywords.some(k => name.includes(k));
  },

  getSkinTypeKeywords(skinType) {
    const dict = {
      '건성': ['laser', 'barrier', '레이저', '패리어', '보습', '장벽', '재생', '크림', '리치', '영양', 'moist'],
      '지성': ['aquatica', '아쿠아티카', '수분', '산뜻', '젤', '워터리', '가벼', '스틱', '세럼', '물'],
      '민감성': ['post', 'alpha', '포스트', '알파', '진정', '쿨링', '붉은', '저자극', '시카', 'cica']
    };
    return dict[skinType] || [];
  },

  getConcernKeywords(concerns = []) {
    const dict = {
      '재생': ['repair', 'regeneration', 'barrier', '레이저', '재생'],
      '보습': ['moisturizing', 'hydration', 'moisture', '보습', '수분'],
      '진정': ['soothing', 'calming', 'post', 'cooling', '진정', '시카'],
      '미백': ['brightening', 'toning', 'blemish', '미백', '잡티', '토닝'],
      '탄력': ['collagen', 'pdrn', 'firming', 'glow', '탄력', '광채']
    };
    let combined = [];
    (concerns || []).forEach(c => { combined = [...combined, ...(dict[c] || [])]; });
    return [...new Set(combined)];
  },

  buildCandidatePool(products, args, targetSize = 25) {
    const { category, skin_type, concerns } = args;
    const skinKeywords = recommendationService.getSkinTypeKeywords(skin_type);
    const concernKeywords = recommendationService.getConcernKeywords(concerns);
    const scored = products.map(p => {
      let score = 0;
      const desc = p.summary_description || p.simple_description || '';
      const text = recommendationService.normalizeText(p.product_name + desc + (p.ai_tags || []).join(''));
      if (recommendationService.matchesCategory(p, category)) score += 10;
      if (skinKeywords.some(k => text.includes(k))) score += 5;
      if (concernKeywords.some(k => text.includes(k))) score += 3;
      return { ...p, _score: score };
    });
    return scored.sort((a, b) => b._score - a._score).slice(0, targetSize);
  },

  async scoreAndFilterProducts(products, args, limit = 5) {
    if (!products || products.length === 0) return [];
    try {
      const candidatePool = recommendationService.buildCandidatePool(products, args, 25);
      if (candidatePool.length === 0) return recommendationService.getPersonalizedFallback(products, args);

      const simplifiedList = candidatePool.map(p => ({
        no: p.product_no,
        name: p.product_name,
        tags: (p.ai_tags || []).slice(0, 5),
        desc: (p.summary_description || p.simple_description || '').slice(0, 100)
      }));

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are the technical curator of CellFusionC. You must respond in valid JSON format.
            {
              "summary": { "selection_strategy": "string", "conclusion": "string" },
              "results": [{ "no": "string", "fit_score": "string", "badges": [], "texture_note": "string", "curator_comment": "string", "caution": "string" }]
            }`
          },
          {
            role: "user",
            content: `[PROFILE] ${JSON.stringify(args)}\n\n[CANDIDATES]\n${JSON.stringify(simplifiedList)}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      let finalRecommendations = (parsed.results || []).map(res => {
          const p = candidatePool.find(prod => String(prod.product_no) === String(res.no));
          if (!p) return null;
          return {
              id: p.product_no,
              name: p.product_name,
              price: (parseInt(p.price) || 0).toLocaleString(),
              discount_rate: p.discount_rate || 0,
              thumbnail: p.thumbnail || p.list_image || '',
              fit_score: res.fit_score || "High",
              badges: res.badges || [],
              texture_note: res.texture_note || "촉촉한 제형",
              match_reasons: res.curator_comment || "추천 상품입니다.",
              caution: (res.caution && res.caution !== "없음") ? res.caution : "",
              selection_strategy: parsed.summary?.selection_strategy || "",
              conclusion: parsed.summary?.conclusion || ""
          };
      }).filter(Boolean).slice(0, limit);

      if (finalRecommendations.length === 0) return recommendationService.getPersonalizedFallback(products, args);
      return finalRecommendations;
    } catch (e) {
      console.error("[AI Engine Error]", e.message);
      return recommendationService.getPersonalizedFallback(products, args);
    }
  },

  getPersonalizedFallback(products, args) {
      const candidates = products.slice(0, 10).map(p => {
          let s = 0;
          if (p.product_name.includes(args.category || '')) s += 10;
          if (p.product_name.includes(args.skin_type || '')) s += 5;
          return { ...p, _score: s };
      }).sort((a,b) => b._score - a._score).slice(0, 5);

      return candidates.map(p => ({
          id: p.product_no,
          name: p.product_name,
          price: (parseInt(p.price) || 0).toLocaleString(),
          discount_rate: p.discount_rate || 0,
          thumbnail: p.thumbnail || p.list_image || '',
          badges: ["BEST"],
          texture_note: "부드러운 제형",
          match_reasons: `${args.skin_type || '모든'} 피부 타입이 즐겨 찾는 인기 제품입니다.`,
          selection_strategy: "현재 시스템 점검 중으로 인기 제품을 제안합니다.",
          conclusion: "셀퓨전씨의 베스트셀러를 먼저 경험해 보세요!",
          caution: ""
      }));
  }
};
