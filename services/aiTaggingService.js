import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * 🏷️ [Strict Metadata Tagging Service 11.3]
 * 라인 유추를 절대 금지하며, 보수적 팩트 기반 태깅을 수행합니다.
 */
export const aiTaggingService = {
  
  ALLOWED_TAGS: {
    category_tags: ['앰플', '세럼', '크림', '토너', '선크림', '선세럼', '스틱', '젤', '밤'],
    skin_type_tags: ['지성', '건성', '민감성', '복합성', '수부지'],
    concern_tags: ['진정', '보습', '장벽', '재생', '미백', '잡티', '탄력', '유수분 밸런스', '속건조', '쿨링', '붉은기', '저자극'],
    texture_tags: ['가벼움', '산뜻함', '워터리', '리치함', '젤타입', '크림타입', '밤타입', '오일타입'],
    line_tags: ['아쿠아티카', '포스트알파', '패리어', '레이저', '토닝']
  },

  async tagProducts(products) {
    if (!products || products.length === 0) return [];

    const simplifiedList = products.map(p => ({
      no: p.id,
      name: p.name,
      desc: (p.summary_description || '').slice(0, 200)
    }));

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `너는 "셀퓨전씨 임상 데이터 수석 분류가"야.
            
            [핵심 태깅 원칙]
            1. line_tags는 상품명/설명에 직접 등장할 때만 부여할 것 (예: 명칭에 '아쿠아티카'가 있어야 함).
            2. 유추를 통한 라인 추정 절대 금지 (확실하지 않으면 빈 배열).
            3. 데이터가 부족하면 억지로 추측하지 말고 무조건 [] 반환.
            4. 허용된 Whitelist 외의 단어 사용 금지.
            
            [허용 태그 집합]
            - category_tags: ${this.ALLOWED_TAGS.category_tags.join(', ')}
            - skin_type_tags: ${this.ALLOWED_TAGS.skin_type_tags.join(', ')}
            - concern_tags: ${this.ALLOWED_TAGS.concern_tags.join(', ')}
            - texture_tags: ${this.ALLOWED_TAGS.texture_tags.join(', ')}
            - line_tags: ${this.ALLOWED_TAGS.line_tags.join(', ')}
            
            [출력 JSON] { "results": [{ "no", "category_tags":[], "skin_type_tags":[], "concern_tags":[], "texture_tags":[], "line_tags":[] }] }`
          },
          {
            role: "user",
            content: JSON.stringify(simplifiedList)
          }
        ],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      const rawResults = parsed.results || [];
      
      return rawResults.map(r => {
        const combined = [
          ...(r.category_tags || []),
          ...(r.skin_type_tags || []),
          ...(r.concern_tags || []),
          ...(r.texture_tags || []),
          ...(r.line_tags || [])
        ];
        return { ...r, all_tags: [...new Set(combined)] };
      });
    } catch (e) {
      console.error("[AI Tagging Error]", e.message);
      return [];
    }
  }
};
