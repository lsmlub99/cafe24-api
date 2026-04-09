/**
 * 🏷️ [Rule-Based Tagging Service v2.0]
 * 
 * 역할: 상품명/설명에서 사전(Dictionary) 기반 키워드를 추출합니다.
 * AI 개입: 절대 없음. OpenAI import 자체를 제거합니다.
 * 용도: 캐시 동기화 시 전 상품에 룰베이스 태그를 일괄 부여합니다.
 */

// ❌ OpenAI import 완전 제거 (지시서 2️⃣ 준수: 검색/필터 로직에 AI 사용 금지)

/**
 * 사전 정의 태그 화이트리스트
 */
const WHITELIST = {
  category_tags: ['앰플', '세럼', '크림', '토너', '선크림', '선세럼', '스틱', '젤', '밤', '마스크', '패드', '클렌징', '로션'],
  line_tags: ['아쿠아티카', '포스트알파', '패리어', '레이저', '토닝'],
  concern_tags: ['진정', '보습', '장벽', '재생', '미백', '잡티', '탄력', '속건조', '유수분', '수분', '자외선', '모공', '주름', '각질'],
  texture_tags: ['가벼움', '산뜻함', '워터리', '리치함', '밤타입', '오일타입', '쿨링']
};

/**
 * 🎯 extractTagsByRule: 상품명+설명에서 화이트리스트 키워드 즉시 추출
 * 비용: 0원, 속도: 0ms, 장애: 불가능
 * 
 * ❌ 금지: 마케팅 문구로 피부타입을 추론하지 않음 (예: 콜라겐=건성 같은 자의적 판단 없음)
 * ✅ 허용: 텍스트에 "지성", "건성" 등이 실제로 적혀있을 때만 태그 부여
 */
function extractTagsByRule(name, desc, categoryNos = []) {
  const combined = (name + ' ' + desc).toLowerCase();

  const tags = {
    category_tags: WHITELIST.category_tags.filter(t => combined.includes(t)),
    line_tags: WHITELIST.line_tags.filter(t => combined.includes(t)),
    concern_tags: WHITELIST.concern_tags.filter(t => combined.includes(t)),
    texture_tags: WHITELIST.texture_tags.filter(t => combined.includes(t))
  };

  // ⚠️ [보수적 보정] 선세럼 오탐 방지 (지시서 3️⃣ 반영)
  // '선세럼' 단어가 단순히 설명에 있다고 다 붙이지 않음.
  // 카테고리가 29(선케어)이거나, 이름에 '선' 혹은 '선세럼'이 직접 포함된 경우에만 최종 태그 유지.
  if (tags.category_tags.includes('선세럼')) {
    const isCategorySun = categoryNos.includes(29);
    const isNameSun = name.toLowerCase().includes('선세럼') || name.toLowerCase().includes('선크림') || name.toLowerCase().includes('sun');
    
    if (!isCategorySun && !isNameSun) {
      // 강한 근거가 없으면 '선세럼' 태그 제거
      tags.category_tags = tags.category_tags.filter(t => t !== '선세럼');
    }
  }

  return tags;
}

/**
 * 🎯 tagAllProducts: 전체 상품 배열에 룰베이스 태그를 일괄 부여
 * 캐시 동기화 시 1회 호출되어 300+개 상품에 즉시 태그를 달아줌
 */
function tagAllProducts(products) {
  if (!products || !Array.isArray(products) || products.length === 0) return [];

  console.log(`[Tagging] 📋 ${products.length}개 상품 룰베이스 태깅 중... (AI 미사용)`);

  return products.map(p => {
    const name = p.product_name || '';
    const desc = p.summary_description || p.simple_description || '';
    const categoryNos = Array.isArray(p.categories) ? p.categories.map(c => c.category_no) : [];
    const tags = extractTagsByRule(name, desc, categoryNos);

    return {
      product_no: p.product_no,
      ...tags,
      all_tags: [...new Set([
        ...tags.category_tags, ...tags.line_tags,
        ...tags.concern_tags, ...tags.texture_tags
      ])].filter(t => typeof t === 'string' && t.length > 0)
    };
  });
}

export const aiTaggingService = {
  WHITELIST,
  extractTagsByRule,
  tagAllProducts
};
