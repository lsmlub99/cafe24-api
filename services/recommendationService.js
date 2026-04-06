/**
 * 상품 추천 및 채점 비즈니스 로직 처리를 전담하는 서비스 레이어
 * (목적: 라우터 파일의 비대화를 막고, 향후 알고리즘 변경 시 이곳만 수정하도록 격리)
 */
export const recommendationService = {
  // 📚 [지능형 동의어 사전] 
  // 표준어, 줄임말, 오타, 영어 표현을 망라하여 사용자의 의도를 정확히 파악합니다.
  SYNONYMS: {
    // 피부 타입
    '건성': ['보습', '수분', '촉촉', '세라마이드', '장벽', '드라이', '너리싱', '모이스처', '하이루론', '속건조'],
    '지성': ['유분', '산뜻', '컨트롤', '블러', '매트', '바란스', '노세범', '피지', '오일프리', '프레쉬'],
    '복합성': ['수부지', '바란스', '보습', '컨트롤', '조절', '밸런스'],
    '민감성': ['진정', '저자극', '병풀', '시카', '판테놀', '알란토인', '센시티브', '트러블', '아쿠아', '패리어', '안심'],
    
    // 피부 고민
    '트러블': ['여드름', '브레미쉬', '진정', '산뜻', '솔루션', '지성', '스팟', '아크네', 'A.C', '모공'],
    '진정': ['시카', '병풀', '판테놀', '알로에', '카밍', '센시티브', '울트라', '마데카'],
    '수분': ['보습', '촉촉', '하이루론', '아쿠아', '모이스처', '워터', '히알루론'],
    '미백': ['비타민', '톤업', '브라이트닝', '나이아신아마이드', '멜라닌', '화이트닝', '잡티', '광채'],
    '탄력': ['주름', '콜라겐', '리프팅', '펩타이드', '리주버네이션', '안티에이징', '퍼밍'],
    
    // 카테고리 (범용 확장)
    '선크림': ['선제품', '썬제품', '선케어', '썬케어', 'spf', 'uv', '선베이스', '썬스크린', '선블록', '썬크림', '자외선', '자차'],
    '비비': ['비비크림', '블레미쉬', '톤업', '커버', 'BB'],
    '클렌징': ['세안', '폼', '클렌저', '워시', '오일', '밀크'],
    '마스크': ['팩', '마스크팩', '시트마스크', '패드', '마스크'],
    '토너': ['스킨', '토너', '토너패드', '결케어', '닦토']
  },

  // [지능형 양방향 확장] 사용자가 어떤 단어를 던지든 사전 내의 모든 연관어를 싹 다 찾아냅니다.
  _expandKeywords(keyword) {
    if (!keyword) return [];
    const lower = keyword.toLowerCase().trim();
    const result = new Set([lower]);

    // 1. 사전 전체를 훑으며 입력어가 '키'거나 '값 중 하나'에 포함되는지 전수 조사
    for (const [standard, variations] of Object.entries(this.SYNONYMS)) {
        if (lower === standard || variations.some(v => lower.includes(v) || v.includes(lower))) {
            // 매칭 성공 시 해당 카테고리의 모든 단어를 결과 셋에 추가
            result.add(standard);
            variations.forEach(v => result.add(v));
        }
    }
    
    // 2. 단어 조각 매칭 (예: '선제품'에서 '선'만 있어도 선크림 카테고리 연동)
    if (lower.length >= 2) {
        for (const [standard, variations] of Object.entries(this.SYNONYMS)) {
            if (standard.includes(lower) || variations.some(v => v.includes(lower))) {
                result.add(standard);
                variations.forEach(v => result.add(v));
            }
        }
    }

    return Array.from(result);
  },

  /**
   * 추천 채점 알고리즘 (지능형 하이브리드)
   */
  scoreAndFilterProducts(products, args, limit = 5) {
    const { skin_type, concerns = [], category } = args;

    const scoredProducts = products.map(p => {
        let score = 0;
        let reasons = [];
        
        // 🔎 [검색 타겟 통합]
        const searchTarget = [
            p.product_name, 
            p.summary_description, 
            p.simple_description, 
            ...(Array.isArray(p.product_tag) ? p.product_tag : [])
        ].map(v => (v || '').toLowerCase()).join(' ');

        // 1. 카테고리 매칭 (강력 필터 보정)
        if (category) {
            const categoryWords = this._expandKeywords(category);
            let categoryMatched = false;
            for (const kw of categoryWords) {
                if (searchTarget.includes(kw)) {
                    score += 10; // 카테고리 일치 시 압도적 점수
                    reasons.push(`[${category}] 일치 ✨`);
                    categoryMatched = true;
                    break;
                }
            }
            // 🚫 카테고리 미칭 시 패널티 부여 (엉뚱한 상품 방지)
            if (!categoryMatched) {
                score -= 15; 
            }
        }

        // 2. 피부 타입 매칭
        if (skin_type) {
            const skinWords = this._expandKeywords(skin_type);
            for (const kw of skinWords) {
                if (searchTarget.includes(kw)) {
                    score += 3;
                    reasons.push(`${skin_type} 타입 적합`);
                    break;
                }
            }
        }
        
        // 3. 피부 고민 매칭
        concerns.forEach(c => {
            const cWords = this._expandKeywords(c);
            for (const kw of cWords) {
                if (searchTarget.includes(kw)) {
                    score += 2;
                    reasons.push(`'${c}' 고민 해결`);
                    break;
                }
            }
        });

        // [패널티] 품절/미판매
        if (p.sold_out === 'T' || p.selling === 'F') {
            score -= 50; 
            reasons.push(`품절/미판매`);
        }

        // 기본 점수 가점
        if (score >= -10) score += 0.1;

        return {
            id: p.product_no,
            name: p.product_name,
            price: `${parseInt(p.price).toLocaleString()}원`,
            product_url: `https://cellfusionc.co.kr/product/detail.html?product_no=${p.product_no}`,
            thumbnail: (() => {
                let img = p.list_image || p.detail_image || p.tiny_image;
                if (!img) return 'https://dummyimage.com/180x180/eef2f3/555555.png?text=CellFusionC'; 
                if (img.startsWith('//')) img = `https:${img}`;
                return img.replace('http://', 'https://');
            })(),
            score,
            match_reasons: reasons.join(', ') || '공식 추천'
        };
    });

    // 필터링 및 정렬
    const validProducts = scoredProducts.filter(p => p.score > 0);
    validProducts.sort((a, b) => b.score - a.score);

    // 중복 제거 및 기획세트 그룹화
    const uniqueTopN = [];
    const baseNameMap = new Map();
    
    for (const p of validProducts) {
        const baseName = p.name.replace(/\[.*?\]|\(.*?\)|1\+1|기획|세트|증정|대용량/g, '').trim();
        
        if (!baseNameMap.has(baseName)) {
            p.upsell_options = [];
            baseNameMap.set(baseName, p);
            if (uniqueTopN.length < limit) uniqueTopN.push(p);
        } else {
            const parent = baseNameMap.get(baseName);
            if (parent.upsell_options.length < 2) {
                parent.upsell_options.push({ name: p.name, price: p.price, product_url: p.product_url });
            }
        }
    }

    return uniqueTopN;
  }
};
