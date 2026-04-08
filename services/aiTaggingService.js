import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 30000,      // 🛑 100개 분석 시 8초는 부족하므로 30초로 넉넉하게 확장
  maxRetries: 2,
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
    const combined = (name + ' ' + desc).toLowerCase().replace(/\s/g, '');
    
    // 지피티 피드백 준수: 마케팅 문구(예: 콜라겐=건성, 산뜻=지성)를 억지로 피부타입으로 추론하는 자의적 로직 완전 제거.
    // 오직 리얼 텍스트 기반 100% 하드-매칭 사전(Dictionary) 알고리즘으로 회귀합니다.

    return {
      skin_type_tags: [...ruleSkinTags],
      concern_tags: this.WHITELIST.concern_tags.filter(t => combined.includes(t)),
      texture_tags: this.WHITELIST.texture_tags.filter(t => combined.includes(t)),
      category_tags: this.WHITELIST.category_tags.filter(t => combined.includes(t)),
      line_tags: this.WHITELIST.line_tags.filter(t => combined.includes(t))
    };
  },

  async tagProducts(products) {
    if (!products || !Array.isArray(products) || products.length === 0) return [];

    console.log(`[Tagging Baseline] 🔍 ${products.length}개 상품 룰베이스 하드코드 정밀 필터링...`);
    
    // 지피티 피드백 준수: AI 개입을 전면 차단하고 100% 룰베이스 하드코딩으로 회귀합니다. (AI 장애 0%, 환각 0%)
    return products.map(p => {
        const rule = this.extractTagsByRule(p.name || '', p.summary_description || '');
        const merged = {
            id: String(p.id),
            category_tags: rule.category_tags || [],
            line_tags: rule.line_tags || [],
            skin_type_tags: rule.skin_type_tags || [],
            concern_tags: rule.concern_tags || [],
            texture_tags: rule.texture_tags || []
        };
        merged.all_tags = [...new Set([
            ...merged.category_tags, ...merged.line_tags, 
            ...merged.skin_type_tags, ...merged.concern_tags, ...merged.texture_tags
        ])].filter(t => typeof t === 'string' && t.length > 0);
        return merged;
    });
  }
};
