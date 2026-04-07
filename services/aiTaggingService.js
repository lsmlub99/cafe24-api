import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * [AI 수석 태거] 전속 전문가가 상품을 읽고 태그를 달아줍니다.
 */
export const aiTaggingService = {
  
  /**
   * 상품 리스트를 분석하여 지능형 태그(카테고리, 피부타입, 고민)를 추출합니다.
   */
  async tagProducts(products) {
    if (!products || products.length === 0) return [];

    console.log(`[AI Tagging] 🧠 GPT가 ${products.length}개의 상품을 분석 중입니다...`);

    // GPT에게 전달할 데이터 다이어트 (이름과 설명만)
    const simplifiedProducts = products.map(p => ({
      no: p.product_no,
      name: p.product_name,
      desc: p.summary_description || p.simple_description || ''
    }));

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini", // 빠르고 저렴한 모델 사용
        messages: [
          {
            role: "system",
            content: `너는 화장품 카테고리 분류 전문가야. 각 상품에 대해 아래 3가지 정보를 JSON 배열 형권으로 추출해줘.
            1. categories: 해당 상품을 일컫는 모든 유연한 명칭 (예: 선스틱, 스틱밤, 자외선차단제 등)
            2. skin_types: 추천 피부 (지성, 건성, 민감성, 복합성 등)
            3. concerns: 해결 고민 (진정, 미백, 탄력, 보습 등)
            결과는 반드시 [{ "no": "상품번호", "tags": String[] }] 형식으로만 대답해.`
          },
          {
            role: "user",
            content: JSON.stringify(simplifiedProducts)
          }
        ],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      // "tags" 필드에 모든 키워드를 합쳐서 저장
      return parsed.results || [];
    } catch (error) {
      console.error("[AI Tagging Error]:", error.message);
      return [];
    }
  }
};
