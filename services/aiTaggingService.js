import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 8000,      // 🛑 성능 방어: 8초 이상 지연 시 타임아웃
  maxRetries: 2,      // 실패 시 자동 재시도
});

/**
 * 🏷️ [Clinical Tagging Engine 12.1: Performance & Data Flow Optimized]
 * 룰베이스 선행 처리와 정예 후보 AI 보정을 결합한 고성능 서비스입니다.
 */
export const aiTaggingService = {
  
  WHITELIST: {
    category_tags: ['앰플', '세럼', '크림', '토너', '선크림', '선세럼', '스틱', '젤', '밤'],
    line_tags: ['아쿠아티카', '포스트알파', '패리어', '레이저', '토닝'],
    skin_type_tags: ['지성', '건성', '민감성', '복합성', '수부지'],
    concern_tags: ['진정', '보습', '장벽', '재생', '미백', '잡티', '탄력', '속건조', '유수분 밸런스'],
    texture_tags: ['가벼움', '산뜻함', '워터리', '리치함', '밤타입', '오일타입']
  },

  /**
   * 🎯 룰베이스 태깅: 상품명/설명에서 화이트리스트 키워드 즉시 추출 (비용 0, 속도 0ms)
   */
  extractTagsByRule(name, desc) {
    const combined = (name + desc).replace(/\s/g, '');
    return {
      category_tags: this.WHITELIST.category_tags.filter(t => combined.includes(t)),
      line_tags: this.WHITELIST.line_tags.filter(t => combined.includes(t))
    };
  },

  async tagProducts(products) {
    // [Fix] 1. 빈 배열 및 잘못된 입력 방어
    if (!products || !Array.isArray(products) || products.length === 0) return [];

    // [Fix] 2. OpenAI 전송 전 ID 체계 통일 (no -> id)
    const candidates = products.map(p => ({
      id: String(p.id),
      name: p.name || '',
      desc: (p.summary_description || '').slice(0, 80), // 80자만 분석
      rule_tags: this.extractTagsByRule(p.name || '', p.summary_description || '')
    }));

    try {
      console.log(`[AI Tagging 12.1] 🔍 정예 후보 ${candidates.length}개 정밀 분석 중...`);
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `너는 임상 뷰티 데이터 라벨러야. 제공된 상품 정보를 분석해 지정된 화이트리스트 태그만 반환해. 반드시 JSON 포맷으로 응답해야 해.
            - 유추하지 말고 텍스트 근거가 있을 때만 부여.
            - 식별자는 반드시 'id'를 사용할 것 (no 대신 id).
            - 리스트: ${JSON.stringify(this.WHITELIST)}`
          },
          { role: "user", content: JSON.stringify(candidates) }
        ],
        response_format: { type: "json_object" }
      });

      // [Fix] 3. 엄격한 JSON 파싱 예외 처리
      let parsed = [];
      try {
        parsed = JSON.parse(response.choices[0].message.content).results || [];
      } catch (parseErr) {
        console.warn("[AI Tagging Parsing Error] AI 응답 파싱 실패", parseErr.message);
      }
      
      return candidates.map(c => {
        // [Fix] 4. 문자열화 된 id 값을 기준으로 단일화 조인
        const aiMatch = parsed.find(r => String(r.id) === String(c.id)) || {};
        
        // 룰베이스 태그와 AI 태그 합집합 처리
        const merged = {
          id: c.id,
          category_tags: [...new Set([...c.rule_tags.category_tags, ...(aiMatch.category_tags || [])])],
          line_tags: [...new Set([...c.rule_tags.line_tags, ...(aiMatch.line_tags || [])])],
          skin_type_tags: aiMatch.skin_type_tags || [],
          concern_tags: aiMatch.concern_tags || [],
          texture_tags: aiMatch.texture_tags || []
        };

        // 💡 코드 레벨에서 all_tags 최종 합성 (무결성 보장)
        merged.all_tags = [...new Set([
          ...merged.category_tags, ...merged.line_tags, 
          ...merged.skin_type_tags, ...merged.concern_tags, ...merged.texture_tags
        ])].filter(t => typeof t === 'string' && t.length > 0);

        return merged;
      });
    } catch (e) {
      console.warn("[AI Tagging Fail] ⚠️ 장애 발생. 룰베이스 모드로 전환합니다.", e.message);
      // AI 장애 시 룰베이스 태그라도 반환하여 서비스 유지 (장애 허용성)
      return candidates.map(c => ({
        id: c.id,
        ...c.rule_tags,
        skin_type_tags: [], concern_tags: [], texture_tags: [],
        all_tags: [...c.rule_tags.category_tags, ...c.rule_tags.line_tags]
      }));
    }
  }
};
