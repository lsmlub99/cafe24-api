import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * 👑 [Deterministic Recommendation Engine 9.5]
 * GPT의 자의적 해석을 완벽히 차단하고, 코드가 순위를 100% 결정합니다.
 */
export const recommendationService = {

  // 1. 🚫 수부지/지성 타겟 하드 블로킹 (PDRN, 콜라겐 등 원천 배제)
  getHardPriority(p, args) {
    const { skin_type } = args;
    const text = (p.product_name + (p.summary_description || '') + (p.ai_tags || []).join('')).toLowerCase();
    
    // 수부지/지성 금지어 (Top 3 진입 불가 수준의 감점)
    if (skin_type === '지성' || skin_type === '수부지') {
      const forbidden = ['콜라겐', 'pdrn', '리치', '영양', '고보습', '밤', 'balm', '오일', 'creme'];
      if (forbidden.some(k => text.includes(k))) return -1000;
    }
    
    let score = 0;
    // 수부지/지성 선호어 (가산점)
    if (skin_type === '지성' || skin_type === '수부지') {
      if (text.includes('아쿠아티카') || text.includes('aquatica')) score += 100;
      if (text.includes('수분') || text.includes('산뜻') || text.includes('워터리')) score += 50;
      if (text.includes('히알루론산') || text.includes('밸런스')) score += 50;
    }

    // 카테고리 일치 (필수)
    if ((args.category || '').includes(p.product_name.slice(0, 2))) score += 500;

    return score;
  },

  async scoreAndFilterProducts(products, args, limit = 3) {
    if (!products || products.length === 0) return [];

    console.log(`[Deterministic Engine] 🛡️ ${args.skin_type} 가이드라인 적용 시작...`);

    // 1. 100% 코드 기반 랭킹 결정 (GPT 개입 0%)
    const ranked = products.map(p => ({
      ...p,
      _finalScore: recommendationService.getHardPriority(p, args)
    })).sort((a, b) => b._finalScore - a._finalScore);

    // 2. 최종 Top 3 확정
    const top3 = ranked.slice(0, limit);
    console.log(`[Deterministic Engine] 🎯 Top1: ${top3[0]?.product_name} (Score: ${top3[0]?._finalScore})`);

    // 3. GPT에게는 "이미 결정된 사실"에 대한 "팩트 기술"만 시킴
    const gptInput = top3.map((p, i) => ({
      rank: i + 1,
      no: p.product_no,
      name: p.product_name,
      tags: p.ai_tags || [],
      description: (p.summary_description || p.simple_description || '').slice(0, 150)
    }));

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `너는 "셀퓨전씨 데이터 전사"야. 주관적 판단 금지.
            [지침]
            - 이미 결정된 순위(Rank)를 유지하며 팩트 위주로 작성할 것.
            - 제공된 'tags'와 'description'에 없는 형용사(가벼운, 산뜻한, 흡수빠른 등) 절대 생성 금지.
            - 근거가 없으면 단순히 "상품 데이터에 근거한 매칭 상품입니다"라고만 작성할 것.
            - 모든 답변은 한국어로만 작성.
            
            [JSON] { "summary": { "selection_strategy":"", "conclusion":"" }, "results": [{ "no", "curator_comment": "" }] }`
          },
          {
            role: "user",
            content: `[대상] ${JSON.stringify(args)}\n[팩트 데이터]\n${JSON.stringify(gptInput)}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      
      return top3.map((p, idx) => {
        const aiInfo = (parsed.results || []).find(r => String(r.no) === String(p.product_no)) || {};
        return {
          id: p.product_no,
          name: p.product_name,
          price: (parseInt(p.price) || 0).toLocaleString(),
          thumbnail: p.thumbnail || p.list_image || '',
          badges: p.ai_tags || ["임상완료"],
          match_reasons: aiInfo.curator_comment || "데이터 분석 결과 가장 적합한 제품입니다.",
          selection_strategy: parsed.summary?.selection_strategy || "피부 타입별 최적 매칭 분석입니다.",
          conclusion: parsed.summary?.conclusion || `${args.skin_type} 기준 1순위는 ${top3[0].product_name}입니다.`
        };
      });

    } catch (e) {
      return top3.map(p => ({
        id: p.product_no,
        name: p.product_name,
        price: (parseInt(p.price) || 0).toLocaleString(),
        match_reasons: "공공 데이터 기반 최적 추천 상품입니다."
      }));
    }
  }
};
