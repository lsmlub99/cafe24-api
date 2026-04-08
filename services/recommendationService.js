import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * 🧠 [Enterprise Recommendation Engine 4.5]
 * 단순 키워드 매칭을 넘어 설명 가능성(Explainability)과 
 * 데이터 무결성(Integrity)을 확보한 전문 큐레이션 서비스입니다.
 */
export const recommendationService = {
  
  async scoreAndFilterProducts(products, args, limit = 5) {
    if (!products || products.length === 0) return [];

    console.log(`[AI Engine] 🎯 전문가 분석 프로토콜 가동 (${products.length}개 대상)`);

    // 1. 데이터 경량화 (필수 정보만 GPT에 전달)
    const simplifiedList = products.map(p => ({
      no: p.product_no,
      name: p.product_name,
      tags: p.ai_tags || [],
      desc: p.summary_description || p.simple_description || ''
    }));

    const userProfile = `
      [프로필]
      - 피부타입: ${args.skin_type || '정보없음'}
      - 고민: ${(args.concerns || []).join(', ')}
      - 카테고리: ${args.category || '전체'}
    `;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `너는 "셀퓨전씨(CellFusionC) 기술 수석 큐레이터"야. 아래 [분석 가이드라인]에 따라 최적의 5개를 엄선해.

            [분석 가이드라인]
            1. 라인분석: 아쿠아티카(지성/수분), 포스트알파(민감/진정), 패리어/레이저(건성/장벽), 토닝(미백/잡티)
            2. 제형적합성: 수분/에센스(지성), 크림/밤(건성), 저자극(민감성) 매칭을 엄격히 판별할 것.
            3. 데이터 근거: 제공된 'tags'와 'desc'를 기반으로 성분과 효과를 전문적으로 추론할 것.

            [출력 JSON 구조]
            {
              "summary": { "selection_strategy": "이번 추천의 핵심 전략 (1문장)" },
              "results": [{
                "no": "상품번호",
                "fit_score": "High/Medium",
                "matched_points": ["매칭 포인트 2개"],
                "texture_note": "제형의 실제 발림성/마무리감 설명",
                "curator_comment": "사용자 맞춤 전담 조언 (1문장)",
                "caution": "주의사항 또는 사용 팁"
              }]
            }`
          },
          {
            role: "user",
            content: `${userProfile}\n\n[상품 데이터]\n${JSON.stringify(simplifiedList)}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      const aiResults = parsed.results || [];

      // 🛡️ [Post-Filtering Guardrail] 실시간 데이터 결합 및 검증
      const finalRecommendations = aiResults.map(res => {
          const p = products.find(prod => String(prod.product_no) === String(res.no));
          if (!p) return null;

          const retail = parseInt(p.retail_price) || 0;
          const current = parseInt(p.price) || 0;
          const discount = retail > current ? Math.round(((retail - current) / retail) * 100) : 0;

          return {
              id: p.product_no,
              name: p.product_name,
              price: current.toLocaleString(),
              discount_rate: discount,
              thumbnail: (() => {
                  let img = p.list_image || p.detail_image || p.tiny_image;
                  if (!img) return 'https://dummyimage.com/180x180/eef2f3/555555.png';
                  if (img.startsWith('//')) img = `https:${img}`;
                  return img.replace('http://', 'https://');
              })(),
              // 고도화된 메타데이터 (UI 연결용)
              fit_score: res.fit_score || "Medium",
              matched_points: res.matched_points || [],
              texture_note: res.texture_note || "부드러운 제형",
              match_reasons: res.curator_comment || "추천 상품입니다.",
              caution: res.caution || "없음",
              selection_strategy: parsed.summary?.selection_strategy || ""
          };
      }).filter(Boolean).slice(0, limit);

      return finalRecommendations.length > 0 ? finalRecommendations : products.slice(0, 3).map(p => ({
          id: p.product_no,
          name: p.product_name,
          price: (parseInt(p.price) || 0).toLocaleString(),
          match_reasons: "셀퓨전씨의 베스트셀러 제품입니다."
      }));
    } catch (error) {
      console.error("[AI Engine Error]:", error.message);
      return products.slice(0, 3).map(p => ({
          id: p.product_no,
          name: p.product_name,
          price: (parseInt(p.price) || 0).toLocaleString(),
          match_reasons: "실시간 추천 서버 점검 중으로 인기 제품을 제안합니다."
      }));
    }
  }
};
