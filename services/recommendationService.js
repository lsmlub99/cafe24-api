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
      // 2. GPT-4o-mini에게 실시간 추천 의뢰
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `너는 셀퓨전씨 공식몰의 수석 뷰티 큐레이터야. 
            아래 제공되는 100개의 상품 리스트 중에서 사용자의 요청(피부타입, 고민, 카테고리)에 가장 부합하는 제품 상위 ${limit}개를 골라줘.
            
            [지침]
            - 카테고리 명칭이 정확히 일치하지 않아도 의미상 동일하면(예: 선스틱=스틱밤) 적극적으로 추천해.
            - 선정된 제품의 '추천 이유'를 사용자의 피부 고민과 연결해서 한 문장으로 작성해.
            - 결과는 반드시 JSON 형식: { "results": [{ "no": "상품번호", "reason": "추천이유" }] }`
          },
          {
            role: "user",
            content: `사용자 요청: ${userQuery}\n\n상품 리스트: ${JSON.stringify(simplifiedList)}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      const aiResults = parsed.results || [];

      // 3. AI가 선정한 번호를 바탕으로 원본 데이터와 매칭 및 UI 데이터 생성
      const finalRecommendations = aiResults.map(res => {
          const p = products.find(prod => String(prod.product_no) === String(res.no));
          if (!p) return null;

          // 할인율 계산
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
              match_reasons: res.reason // AI가 직접 작성한 따끈따끈한 추천 이유 사용
          };
      }).filter(Boolean);

      return finalRecommendations;
    } catch (error) {
      console.error("[AI Selector Error]:", error.message);
      return [];
    }
  }
};
