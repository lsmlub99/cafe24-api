import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * 👑 [Universal Logic Engine 10.0]
 * 하드코딩 없이 모든 케이스를 동일한 '범용 스코어링 시스템'으로 처리합니다.
 */
export const recommendationService = {

  // 1. 범용 스코어링 엔진 (Logic Only)
  calculateUniversalScore(p, args) {
    let score = 0;
    const { skin_type, concerns, category } = args;
    const text = (p.product_name + (p.summary_description || '') + (p.ai_tags || []).join('')).toLowerCase();

    // A. [카테고리] 가중치 (최우선)
    if (category && text.includes(category.toLowerCase().slice(0, 2))) {
      score += 100;
    }

    // B. [피부 타입 & 고민] 긍정 매칭 (가산점)
    const positiveKeywords = [skin_type, ...(concerns || [])];
    positiveKeywords.forEach(k => {
      if (k && text.includes(k.toLowerCase())) score += 20;
    });

    // C. [피부 타입별 상충 속성] 감점 로직 (Conflict Map)
    // 수부지/지성에게 '오일/리치/고영양/밤'은 상충 속성임
    const conflictMap = {
      '지성': ['리치', '고영양', '오일', '밤', 'balm', 'creme', 'pdrn', '콜라겐'], // PDRN/콜라겐은 대개 제형이 무거워 지성과 상충
      '수부지': ['리치', '고영양', '오일', '밤', 'balm', 'pdrn', '콜라겐'],
      '건성': ['산뜻', '가벼운', '워터리', '젤'] // 건성에게 너무 가벼운 제형은 상충
    };

    const conflicts = conflictMap[skin_type] || [];
    conflicts.forEach(c => {
      if (text.includes(c.toLowerCase())) score -= 50; // 자연스럽게 하위권으로 밀어냄
    });

    return score;
  },

  async scoreAndFilterProducts(products, args, limit = 3) {
    if (!products || products.length === 0) return [];

    console.log(`[Universal Engine] 🚀 ${args.skin_type} 분석을 위한 범용 스코어링 기동...`);

    // 1. 전 품목 스코어링 및 정렬
    const ranked = products.map(p => ({
      ...p,
      _score: recommendationService.calculateUniversalScore(p, args)
    })).sort((a, b) => b._score - a._score);

    // 2. 최종 후보 확정 (순수 로직 결과)
    const topChoices = ranked.slice(0, limit);

    // 3. GPT는 '팩트 기술' 및 '요약'만 담당
    const gptInput = topChoices.map((p, i) => ({
      rank: i + 1,
      name: p.product_name,
      tags: p.ai_tags || [],
      desc: (p.summary_description || '').slice(0, 150)
    }));

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `너는 "셀퓨전씨 데이터 큐레이터"야. 주해는 금지하고, 주어진 팩트 데이터를 바탕으로 추천 사유를 한글로 작성해.
            [규칙]
            - 순위(Rank)를 유지하며 팩트 위주로 작성.
            - 데이터(tags, desc)에 없는 형용사나 적합성 판단 금지.
            - 결과 형식은 반드시 JSON으로.
            
            [JSON] { "summary": { "strategy":"", "conclusion":"" }, "results": [{ "name", "comment": "" }] }`
          },
          {
            role: "user",
            content: `[대상] ${JSON.stringify(args)}\n[팩트 데이터]\n${JSON.stringify(gptInput)}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      
      return topChoices.map((p, idx) => {
        const aiInfo = (parsed.results || []).find(r => r.name === p.product_name) || {};
        return {
          id: p.product_no,
          name: p.product_name,
          price: (parseInt(p.price) || 0).toLocaleString(),
          thumbnail: p.thumbnail || p.list_image || '',
          badges: p.ai_tags || ["임상완료"],
          match_reasons: aiInfo.comment || "데이터 분석에 기반한 상위 매칭 제품입니다.",
          selection_strategy: parsed.summary?.strategy || "피부 고민 및 속성 분석 리포트입니다.",
          conclusion: parsed.summary?.conclusion || `오늘의 분석 결과 1순위는 ${topChoices[0].product_name}입니다.`
        };
      });

    } catch (e) {
      console.error("[Universal Engine GPT Error]", e.message);
      return topChoices.map(p => ({
        id: p.product_no,
        name: p.product_name,
        price: (parseInt(p.price) || 0).toLocaleString(),
        match_reasons: "데이터 속성 일치도가 높은 추천 상품입니다."
      }));
    }
  }
};
