import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * 👑 [Tiered Recommendation Pipeline 6.0]
 * Stage 1: Candidate Pool (Code-level filtering)
 * Stage 2: Expert Rerank (LLM-based selection)
 * Stage 3: Guardrail & UI Mapping
 */
export const recommendationService = {

  // 1. 텍스트 정규화 (매칭 정확도 향상)
  normalizeText(text) {
    return (text || '').toLowerCase().replace(/\s+/g, '').trim();
  },

  // 2. 카테고리 매칭 로직 (코어 필터)
  matchesCategory(p, category) {
    if (!category) return true;
    const name = this.normalizeText(p.product_name);
    const cat = this.normalizeText(category);
    
    // 카테고리별 유연한 키워드 맵
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

  // 3. 피부타입별 키워드 사전
  getSkinTypeKeywords(skinType) {
    const dict = {
      '건성': ['laser', 'barrier', '레이저', '패리어', '보습', '장벽', '재생', '크림', '리치', '영양', 'moist'],
      '지성': ['aquatica', '아쿠아티카', '수분', '산뜻', '젤', '워터리', '가벼', '스틱', '세럼', '물'],
      '수부지': ['aquatica', '아쿠아티카', '밸런스', '속건조', '산뜻', '수분', '에센스'],
      '민감성': ['post', 'alpha', '포스트', '알파', '진정', '쿨링', '붉은', '저자극', '시카', 'cica']
    };
    return dict[skinType] || [];
  },

  // 4. 피부고민별 키워드 사전
  getConcernKeywords(concerns = []) {
    const dict = {
      '재생': ['repair', 'regeneration', 'barrier', '레이저', '재생'],
      '보습': ['moisturizing', 'hydration', 'moisture', '보습', '수분'],
      '진정': ['soothing', 'calming', 'post', 'cooling', '진정', '시카'],
      '미백': ['brightening', 'toning', 'blemish', '미백', '잡티', '토닝'],
      '탄력': ['collagen', 'pdrn', 'firming', 'glow', '탄력', '광채']
    };
    let combined = [];
    concerns.forEach(c => { combined = [...combined, ...(dict[c] || [])]; });
    return [...new Set(combined)];
  },

  /**
   * 🏗️ [Candidate Pool Builder]
   * 100개 상품 중 관련도가 높은 25개를 선별합니다. (랜덤X, 실력순O)
   */
  buildCandidatePool(products, args, targetSize = 25) {
    const { category, skin_type, concerns } = args;
    const skinKeywords = this.getSkinTypeKeywords(skin_type);
    const concernKeywords = this.getConcernKeywords(concerns);

    const scored = products.map(p => {
      let score = 0;
      const text = this.normalizeText(p.product_name + (p.summary_description || '') + (p.ai_tags || []).join(''));

      // 1) 카테고리 일치 (+5)
      if (this.matchesCategory(p, category)) score += 5;

      // 2) 피부타입 라인/키워드 일치 (+3)
      if (skinKeywords.some(k => text.includes(k))) score += 3;

      // 3) 고민 키워드 일치 (+2)
      if (concernKeywords.some(k => text.includes(k))) score += 2;

      // 4) 태그 내 매칭 보너스 (+1)
      if ((p.ai_tags || []).some(t => skinKeywords.includes(t) || concernKeywords.includes(t))) score += 1;

      return { ...p, _score: score };
    });

    // 점수 높은 순 정렬 후 중복 제거 및 슬라이싱
    return scored
      .sort((a, b) => b._score - a._score)
      .slice(0, targetSize);
  },

  async scoreAndFilterProducts(products, args, limit = 5) {
    if (!products || products.length === 0) return [];

    console.log(`[AI Engine] 🏗️ ${args.skin_type || '전체'} 후보군 빌딩 시작...`);

    // 🔥 Stage 1: 후보군 축소 (100개 -> 25개)
    const candidatePool = this.buildCandidatePool(products, args, 25);
    console.log(`[AI Engine] 🎯 엄선된 ${candidatePool.length}개의 후보로 심층 면접 진행`);

    // GPT 전달용 데이터 경량화
    const simplifiedList = candidatePool.map(p => ({
      no: p.product_no,
      name: p.product_name,
      tags: p.ai_tags || [],
      desc: p.summary_description || p.simple_description || ''
    }));

    const userProfile = `
      [큐레이션 대상]
      - 피부타입: ${args.skin_type} / 고민: ${(args.concerns || []).join(', ')}
      - 카테고리: ${args.category}
    `;

    try {
      // 🔥 Stage 2: GPT Reranking
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `너는 "셀퓨전씨 테크니컬 큐레이터"야. 25개의 후보 중 5개를 엄선해.
            [출력구조]
            {
              "summary": { "selection_strategy": "한줄전략", "conclusion": "한줄결론" },
              "results": [{ "no", "fit_score", "badges":[], "texture_note":"", "curator_comment":"", "caution":"" }]
            }`
          },
          {
            role: "user",
            content: `${userProfile}\n\n[엄선된 후보군]\n${JSON.stringify(simplifiedList)}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      const aiResults = parsed.results || [];

      // 🔥 Stage 3: 후처리 가드레일
      let finalRecommendations = aiResults.map(res => {
          const p = candidatePool.find(prod => String(prod.product_no) === String(res.no));
          if (!p) return null;

          const current = parseInt(p.price) || 0;
          return {
              id: p.product_no,
              name: p.product_name,
              price: current.toLocaleString(),
              discount_rate: p.discount_rate || 0,
              thumbnail: p.thumbnail || p.list_image || '',
              fit_score: res.fit_score || "Medium",
              badges: res.badges || [],
              texture_note: res.texture_note || "",
              match_reasons: res.curator_comment || "추천 상품입니다.",
              caution: (res.caution && res.caution !== "없음") ? res.caution : "",
              selection_strategy: parsed.summary?.selection_strategy || "",
              conclusion: parsed.summary?.conclusion || ""
          };
      }).filter(Boolean);

      // 마지막 다양성 보정
      const seenNames = new Set();
      finalRecommendations = finalRecommendations.filter(p => {
          const baseName = p.name.split(' ')[0];
          if (seenNames.has(baseName)) return false;
          seenNames.add(baseName);
          return true;
      }).slice(0, limit);

      return finalRecommendations.length > 0 ? finalRecommendations : this.getPersonalizedFallback(products, args);

    } catch (error) {
      console.error("[AI Engine Error]:", error.message);
      return this.getPersonalizedFallback(products, args);
    }
  },

  getPersonalizedFallback(products, args) {
      const candidates = this.buildCandidatePool(products, args, 5);
      return candidates.map(p => ({
          id: p.product_no,
          name: p.product_name,
          price: (parseInt(p.price) || 0).toLocaleString(),
          match_reasons: `${args.skin_type} 타입 베스트셀러 상품입니다.`,
          selection_strategy: `데이터 통신 중 지연이 발생하여 ${args.skin_type} 피부용 상위 제품을 제안합니다.`
      }));
  }
};
