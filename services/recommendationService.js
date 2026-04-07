import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * 🧠 [실시간 AI 셀렉터 엔진]
 * 인위적인 하드코딩이나 점수 로직을 0%로 만들고, 
 * GPT의 실시간 추론(Reasoning)만으로 최적의 상품을 선정합니다.
 */
export const recommendationService = {

  /**
   * AI가 실시간으로 상품 리스트 100개를 분석하여 최적의 Top 5를 선정합니다.
   */
  async scoreAndFilterProducts(products, args, limit = 5) {
    if (!products || products.length === 0) return [];

    console.log(`[AI Selector] 🎯 100개 상품 중 최적의 ${limit}개를 실시간으로 선정 중...`);

    // 1. GPT에게 보낼 데이터 초경량화 (토큰 절매 + 속도 향상)
    const simplifiedList = products.map(p => ({
      no: p.product_no,
      name: p.product_name,
      desc: p.summary_description || p.simple_description || ''
    }));

    const userQuery = `
      [사용자 요청 정보]
      - 피부타입: ${args.skin_type || '정보 없음'}
      - 고민: ${ (args.concerns || []).join(', ') || '정보 없음' }
      - 찾는 카테고리: ${args.category || '전체'}
    `;

    try {
      // 2. GPT-4o-mini에게 실시간 추천 의뢰 (강력한 가이드라인 추가)
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `너는 화장품 전문가야. 아래 100개 상품 중 요청에 가장 적합한 3~5개를 골라.
            [필수 준수]
            1. '완벽한 매칭'이 없더라도, 사용자의 고민을 가장 잘 해결해줄 수 있는 '차선책'을 반드시 포함해서 3개 이상 무조건 골라. 절대 빈 결과를 주지 마.
            2. 추천 이유는 전문적이고 설득력 있게 작성해.
            3. 결과는 반드시 JSON: { "results": [{ "no": "상품번호", "reason": "이유" }] }`
          },
          {
            role: "user",
            content: `질문: ${userQuery}\n\n리스트: ${JSON.stringify(simplifiedList)}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      let aiResults = parsed.results || [];

      // 🛡️ [하이브리드 백업] 만약 AI가 결과물을 지워버렸거나 실패했다면? 단순 텍스트 매칭으로 강제 복구
      if (aiResults.length === 0) {
          console.log("[AI Selector] ⚠️ AI가 결과를 내지 못해 텍스트 매칭 백업 모드 가동");
          const searchKey = (args.category || args.skin_type || '선').toLowerCase();
          aiResults = products
            .filter(p => p.product_name.toLowerCase().includes(searchKey))
            .slice(0, 3)
            .map(p => ({ no: p.product_no, reason: "전문가가 엄선한 셀퓨전씨 베스트 추천 제품입니다." }));
      }

      // 3. 매칭 및 UI 데이터 생성
      const finalRecommendations = aiResults.map(res => {
          const p = products.find(prod => String(prod.product_no) === String(res.no));
          if (!p) return null;

          const retail = parseInt(p.retail_price) || 0;
          const current = parseInt(p.price) || 0;
          const discountRate = retail > current ? Math.round(((retail - current) / retail) * 100) : 0;

          return {
              id: p.product_no,
              name: p.product_name,
              price: current.toLocaleString(),
              discount_rate: discountRate,
              product_url: `https://cellfusionc.co.kr/product/detail.html?product_no=${p.product_no}`,
              thumbnail: (() => {
                  let img = p.list_image || p.detail_image || p.tiny_image;
                  if (!img) return 'https://dummyimage.com/180x180/eef2f3/555555.png?text=CellFusionC'; 
                  if (img.startsWith('//')) img = `https:${img}`;
                  return img.replace('http://', 'https://');
              })(),
              summary: p.summary_description || p.simple_description || '',
              match_reasons: res.reason
          };
      }).filter(Boolean);

      return finalRecommendations;
    } catch (error) {
      console.error("[AI Selector Error]:", error.message);
      // 에러 시 텍스트 매칭으로 평화적 해결
      return products.slice(0, 3).map(p => ({
          id: p.product_no,
          name: p.product_name,
          price: (parseInt(p.price) || 0).toLocaleString(),
          match_reasons: "실시간 추천 서버 점검 중으로 공식 베스트셀러를 제안해 드립니다."
      }));
    }
  }
};
