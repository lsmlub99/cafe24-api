import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * 👑 [Master-Class Recommendation Engine 8.0]
 * 중복 상품 제거 및 데이터 완결성을 극대화한 최종 완성형 버전입니다.
 */
export const recommendationService = {

  normalizeName(name) {
    // [1+1], [유통기한], [단독] 등의 접두사 및 특수문자 제거하여 순수 상품명 추출
    return (name || '').replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim();
  },

  getSeries(name) {
    const n = name.toLowerCase();
    if (n.includes('레이저') || n.includes('laser')) return 'Laser';
    if (n.includes('패리어') || n.includes('barrier')) return 'Barrier';
    if (n.includes('포스트') || n.includes('post')) return 'PostAlpha';
    if (n.includes('아쿠아티카') || n.includes('aquatica')) return 'Aquatica';
    if (n.includes('토닝') || n.includes('toning')) return 'Toning';
    if (n.includes('pdrn')) return 'PDRN';
    return 'Other';
  },

  async scoreAndFilterProducts(products, args, limit = 5) {
    if (!products || products.length === 0) return [];
    try {
      const candidatePool = recommendationService.buildCandidatePool(products, args, 30);
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
            content: `너는 "셀퓨전씨 임상 기술 수석 큐레이터"야. 모든 답변은 한국어로만 작성해.
            [출력 규칙]
            - selection_strategy: [피부타입] [고민] 해결을 위한 전략 (한글 한 줄).
            - conclusion: [타입] 케어 1순위는 [상품명]입니다.
            - results[].badges: 반드시 3개 이상의 핵심 장점(#포함X). 예: ["속건조해결", "수분가득", "저자극"]
            - results[].curator_comment: 신뢰감 있는 코멘트.

            [JSON Schema]
            {
              "summary": { "selection_strategy": "", "conclusion": "" },
              "results": [{ "no", "fit_score", "badges":[], "texture_note":"", "curator_comment":"", "caution":"" }]
            }`
          },
          {
            role: "user",
            content: `[데이터] ${JSON.stringify(args)}\n\n[후보]\n${JSON.stringify(simplifiedList)}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      const aiResults = parsed.results || [];

      // 🛡️ 1. 데이터 결합 및 정규화
      let allMapped = aiResults.map(res => {
          const p = candidatePool.find(prod => String(prod.product_no) === String(res.no));
          if (!p) return null;
          return {
              id: p.product_no,
              name: p.product_name,
              pure_name: recommendationService.normalizeName(p.product_name), // 순수 상품명
              price: (parseInt(p.price) || 0).toLocaleString(),
              discount_rate: p.discount_rate || 0,
              thumbnail: p.thumbnail || p.list_image || '',
              series: recommendationService.getSeries(p.product_name),
              fit_score: res.fit_score || "High",
              badges: (res.badges && res.badges.length > 0) ? res.badges : ["인기상품", "베스트셀러", "저자극"],
              texture_note: res.texture_note || "촉촉한 제형",
              match_reasons: res.curator_comment || "추천 상품입니다.",
              caution: res.caution || "",
              selection_strategy: parsed.summary?.selection_strategy || "",
              conclusion: parsed.summary?.conclusion || ""
          };
      }).filter(Boolean);

      // 🛡️ 2. [Brand Enforcement] 레이저/패리어 우선순위 강제 (건성 기준)
      const sType = args.skin_type;
      if (sType === '건성') {
          const laserIdx = allMapped.findIndex(r => r.series === 'Laser' || r.series === 'Barrier');
          if (laserIdx > 0) {
              const [target] = allMapped.splice(laserIdx, 1);
              allMapped.unshift(target);
          }
      }

      // 🛡️ 3. [Advanced Diversity] 동일 '순수 상품명' 완벽 제거
      const seenPureNames = new Set();
      const seenSeries = {};
      
      let finalRecommendations = [];
      for (const p of allMapped) {
          // 같은 상품(기획세트 등) 중복 금지
          if (seenPureNames.has(p.pure_name)) continue;
          // 같은 시리즈 도배 금지 (최대 2개)
          seenSeries[p.series] = (seenSeries[p.series] || 0) + 1;
          if (seenSeries[p.series] > 2) continue;

          seenPureNames.add(p.pure_name);
          finalRecommendations.push(p);
      }

      finalRecommendations = finalRecommendations.slice(0, limit);
      return finalRecommendations.length > 0 ? finalRecommendations : recommendationService.getPersonalizedFallback(products, args);

    } catch (e) {
      console.error("[Fatal AI Error]", e.message);
      return recommendationService.getPersonalizedFallback(products, args);
    }
  },

  buildCandidatePool(products, args, targetSize = 25) {
    const { category, skin_type, concerns } = args;
    const skinKeywords = recommendationService.getSkinTypeKeywords(skin_type);
    const scored = products.map(p => {
      let score = 0;
      const text = (p.product_name + (p.ai_tags || []).join('')).toLowerCase();
      if ((category || '').includes(p.product_name.slice(0,2))) score += 10;
      if (skinKeywords.some(k => text.includes(k))) score += 5;
      return { ...p, _score: score };
    });
    return scored.sort((a,b) => b._score - a._score).slice(0, targetSize);
  },

  getSkinTypeKeywords(skinType) {
    const dict = { '건성': ['laser', 'barrier', '레이저', '패리어'], '지성': ['aquatica', '아쿠아티카', '수분', '산뜻'], '민감성': ['post', 'alpha', '포스트'] };
    return dict[skinType] || [];
  },

  getPersonalizedFallback(products, args) {
      return products.slice(0, 3).map(p => ({
          id: p.product_no,
          name: p.product_name,
          price: (parseInt(p.price) || 0).toLocaleString(),
          badges: ["BEST", "인기제품"],
          match_reasons: "셀퓨전씨의 베스트 제품입니다.",
          selection_strategy: "인기 순위 기반 추천입니다.",
          conclusion: "가장 만족도가 높은 상품들입니다.",
          thumbnail: p.thumbnail || p.list_image || ''
      }));
  }
};
