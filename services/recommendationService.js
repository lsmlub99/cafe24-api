/**
 * [AI 기반 지능형 추천 엔진]
 * 하드코딩된 동의어 사전 대신, 상품별 AI 태그를 활용하여 
 * 어떤 질문에도 유연하게 대답하는 차세대 추천 로직입니다.
 */
export const recommendationService = {

  /**
   * 상품 점수 산출 및 필터링
   */
  scoreAndFilterProducts(products, args, limit = 5) {
    const { skin_type, concerns = [], category } = args;

    const scoredProducts = products.map(p => {
        let score = 0;
        const reasons = [];

        // GPT가 생성한 AI 태그와 상품명을 통합 분석 대상으로 설정
        const aiTagsStr = (p.ai_tags || []).join(' ').toLowerCase();
        const searchTarget = `${p.product_name} ${aiTagsStr} ${p.summary_description || ''}`.toLowerCase();

        // 1. 카테고리 매칭 (의미 기반)
        if (category) {
            const lowerCat = category.toLowerCase();
            // 상품명이나 AI 태그에 카테고리 핵심어가 포함되어 있는지 확인
            if (searchTarget.includes(lowerCat) || (p.ai_tags && p.ai_tags.some(t => lowerCat.includes(t.toLowerCase())))) {
                score += 20; 
                reasons.push(`[${category}] 카테고리 매칭 ✨`);
            } else {
                score -= 5; // 미매칭 시 소폭 감점
            }
        }

        // 2. 피부 타입 매칭
        if (skin_type) {
            const lowerSkin = skin_type.toLowerCase();
            if (searchTarget.includes(lowerSkin)) {
                score += 10;
                reasons.push(`${skin_type} 타입 적합 ✅`);
            }
        }
        
        // 3. 피부 고민 매칭
        concerns.forEach(c => {
            const lowerC = c.toLowerCase();
            if (searchTarget.includes(lowerC)) {
                score += 5;
                reasons.push(`'${c}' 고민 케어 🩹`);
            }
        });

        // 4. 할인율 가점 (커머스 전략)
        if (p.discount_rate > 20) {
            score += 3;
            reasons.push(`${p.discount_rate}% 파격 할인 🔥`);
        }

        // 품절 처리 (강력 차단)
        if (p.sold_out === 'T' || p.selling === 'F') {
            score -= 200; 
        }

        // 기본 점수 방어선
        score += 10; 

        return { ...p, score, match_reasons: reasons.join(', ') || '전문가 추천' };
    });

    // 점수 순 정렬 후 상위 N개 반환
    return scoredProducts
        .filter(p => p.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
  }
};
