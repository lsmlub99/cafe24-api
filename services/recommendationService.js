import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * 👑 [Logic-Driven Engine 9.0]
 * 추천의 주도권을 코드(Rule)가 쥐고, GPT는 설명만 담당하는 구조입니다.
 * 브랜드 정책과 제형 적합성을 최우선으로 합니다.
 */
export const recommendationService = {

  // 1. 🚫 제형/피부타입 부적합 필터 (절대 규칙)
  isForbiddenForTop1(p, skinType) {
    const text = (p.product_name + (p.summary_description || '')).toLowerCase();
    
    if (skinType === '지성' || skinType === '수부지') {
      const forbidden = ['콜라겐', 'pdrn', '리치', '영양', '고보습', '밤', 'balm', '오일'];
      return forbidden.some(k => text.includes(k));
    }
    
    if (skinType === '건성') {
      const forbidden = ['산뜻', '가벼운', '워터리', '젤'];
      // 건성은 금지보다는 추천 위주로 작동하되, 너무 가벼운 건 1위에서 지양
      return forbidden.some(k => text.includes(k));
    }
    return false;
  },

  // 2. ✨ 피부타입별 정밀 스코어링 (코드 레벨 판단)
  calculateRelevanceScore(p, args) {
    let score = 0;
    const { skin_type, category } = args;
    const text = (p.product_name + (p.summary_description || '') + (p.ai_tags || []).join('')).toLowerCase();

    // A. 카테고리 일치 (가장 중요)
    if ((category || '').includes(p.product_name.slice(0, 2))) score += 20;

    // B. 피부타입 타겟 라인 매칭
    if (skin_type === '건성') {
      if (text.includes('레이저') || text.includes('laser')) score += 15;
      if (text.includes('패리어') || text.includes('barrier')) score += 15;
      if (text.includes('고보습') || text.includes('리치')) score += 10;
    } else if (skin_type === '지성' || skin_type === '수부지') {
      if (text.includes('아쿠아티카') || text.includes('aquatica')) score += 15;
      if (text.includes('수분') || text.includes('산뜻') || text.includes('히알루론산')) score += 10;
      if (text.includes('밸런스') || text.includes('속건조')) score += 10;
    } else if (skin_type === '민감성') {
      if (text.includes('포스트') || text.includes('post') || text.includes('알파')) score += 15;
      if (text.includes('진정') || text.includes('저자극') || text.includes('시카')) score += 10;
    }

    // C. Top 1 금지 품목 감점 (1위 후보에서 밀어냄)
    if (recommendationService.isForbiddenForTop1(p, skin_type)) {
      score -= 50; 
    }

    return score;
  },

  async scoreAndFilterProducts(products, args, limit = 5) {
    if (!products || products.length === 0) return [];

    console.log(`[Logic Engine] 🛠️ ${args.skin_type} 피부 타입 룰 기반 필터링 가동...`);

    // 1. 코드 레벨 정밀 스코어링
    const scoredProducts = products.map(p => ({
      ...p,
      _finalScore: recommendationService.calculateRelevanceScore(p, args)
    })).sort((a, b) => b._finalScore - a._finalScore);

    // 2. 최종 후보군 (상위 5개 고정)
    const topChoices = scoredProducts.slice(0, limit);
    
    // 3. GPT는 이제 "설명"만 합니다. (순서 변경 금지)
    const simplifiedForGPT = topChoices.map((p, i) => ({
      rank: i + 1,
      no: p.product_no,
      name: p.product_name,
      desc: p.summary_description || ''
    }));

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `너는 "셀퓨전씨 임상 전문가"야. 주어진 순위(Rank)를 절대 바꾸지 말고 각 상품의 추천 코멘트와 전략만 한국어로 작성해.
            [출력구조]
            {
              "summary": { "selection_strategy": "피부타입/고민 맞춤형 전략", "conclusion": "1순위는 ○○입니다" },
              "results": [{ "no", "fit_score", "badges":[], "texture_note":"", "curator_comment":"", "caution":"" }]
            }`
          },
          {
            role: "user",
            content: `[대상] ${JSON.stringify(args)}\n[고정된 순위 리스트]\n${JSON.stringify(simplifiedForGPT)}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      
      // 4. 코드가 정한 순서대로 GPT의 설명을 입혀서 반환
      return topChoices.map((p, index) => {
        const aiInfo = (parsed.results || []).find(r => String(r.no) === String(p.product_no)) || {};
        return {
          id: p.product_no,
          name: p.product_name,
          price: (parseInt(p.price) || 0).toLocaleString(),
          discount_rate: p.discount_rate || 0,
          thumbnail: p.thumbnail || p.list_image || '',
          fit_score: aiInfo.fit_score || "High",
          badges: aiInfo.badges || ["추천", "피부맞춤"],
          texture_note: aiInfo.texture_note || "최적화 제형",
          match_reasons: aiInfo.curator_comment || "피부 타입에 정밀하게 매칭된 제품입니다.",
          caution: aiInfo.caution || "",
          selection_strategy: parsed.summary?.selection_strategy || "",
          conclusion: parsed.summary?.conclusion || `${args.skin_type} 케어 1순위는 ${topChoices[0].product_name}입니다.`
        };
      });

    } catch (e) {
      console.error("[Logic Engine GPT Error]", e.message);
      // GPT 에러 시에도 코드가 정한 순위대로 반환 (안정성 확보)
      return topChoices.map(p => ({
        id: p.product_no,
        name: p.product_name,
        price: (parseInt(p.price) || 0).toLocaleString(),
        match_reasons: "전문가 로직에 의해 선별된 추천 상품입니다.",
        selection_strategy: `${args.skin_type} 피부 타입과 고민에 최적화된 라인업입니다.`
      }));
    }
  }
};
