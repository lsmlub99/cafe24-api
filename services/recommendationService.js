/**
 * 상품 추천 및 채점 비즈니스 로직 처리를 전담하는 서비스 레이어
 * (목적: 라우터 파일의 비대화를 막고, 향후 알고리즘 변경 시 이곳만 수정하도록 격리)
 */
export const recommendationService = {
  scoreAndFilterProducts: (products, args) => {
    const { skin_type, concerns = [], category } = args;

    // 1. 가져온 상품들에 대해 하나씩 채점 실행
    const scoredProducts = products.map(p => {
        let score = 0;
        let reasons = [];
        
        // 검색 텍스트 합치기 (이름, 설명, 해시태그 태그)
        const searchTarget = [
            p.product_name, 
            p.summary_description, 
            ...(Array.isArray(p.product_tag) ? p.product_tag : [])
        ].join(' ').toLowerCase();

        // [채점 로직] 카테고리 (비중 높음)
        if (category && searchTarget.includes(category.toLowerCase())) {
            score += 3;
            reasons.push(`[${category}] 카테고리 매칭`);
        }

        // [채점 로직] 피부타입
        if (skin_type && searchTarget.includes(skin_type.toLowerCase())) {
            score += 2;
            reasons.push(`${skin_type} 피부 타입 적합`);
        }
        
        // [채점 로직] 피부 고민들
        concerns.forEach(c => {
            if (c && searchTarget.includes(c.toLowerCase())) {
                score += 2;
                reasons.push(`'${c}' 고민 해결 도움`);
            }
        });

        // [패널티 로직] 품절 차단
        if (p.sold_out === 'T' || p.selling === 'F') {
            score -= 10; 
            reasons.push(`현재 품절/미판매 상태`);
        }

        // 키워드 매칭은 안 됐지만 품절도 아니면 0.5점 기본점수 부여
        if (reasons.length === 0 && score === 0 && p.sold_out === 'F') {
           score += 0.5;
           reasons.push("셀퓨전씨 추천 베스트 상품");
        }

        // 👉 [고도화 팁] 똑같은 질문에 맨날 똑같은 상품만 뜨는 지루함을 막기 위한 랜덤 가산점(Jitter)
        // 아주 미세한 소수점 점수를 난수로 더해 동점자들 사이의 순위를 매번 뒤섞어줍니다.
        if (score > 0) {
           score += Math.random() * 0.4;
        }

        // 최종 가공 객체 리턴
        return {
            id: p.product_no,
            name: p.product_name,
            price: `${parseInt(p.price)}원`,
            product_url: `https://cellfusionc.co.kr/product/detail.html?product_no=${p.product_no}`,
            thumbnail: (() => {
                const img = p.list_image || p.detail_image || p.tiny_image;
                if (!img) return 'https://dummyimage.com/180x180/e0e0e0/555555.png&text=No_Image'; 
                return img.startsWith('//') ? `https:${img}` : img; // 엑스박스 방지
            })(),
            tags: p.product_tag,
            score,
            match_reasons: reasons.join(', ') || '정보 없음'
        };
    });

    // 2. 가공된 데이터 정렬
    const validProducts = scoredProducts.filter(p => p.score > 0);
    validProducts.sort((a, b) => b.score - a.score); // 높은 점수순

    // 3. 중복 노출 방지 & 기획세트(1+1) 묶어버리기 (Upsell 연관 제안용)
    const uniqueTop3 = [];
    const baseNameMap = new Map(); // 본명(Base Name) 추적용
    
    for (const p of validProducts) {
        // 정규식으로 '[1+1]', '(증정)', '기획' 등을 싹 날려버리고 핵심 단어(Base Name)만 추출
        const baseName = p.name.replace(/\[.*?\]|\(.*?\)|1\+1|기획|세트|증정|대용량/g, '').trim();
        
        // 처음 발견하는 본명이라면 (대표 상품)
        if (!baseNameMap.has(baseName)) {
            p.upsell_options = []; // 이 상품의 기획/1+1 버전을 담을 연관 상품 바구니
            baseNameMap.set(baseName, p);
            
            if (uniqueTop3.length < 3) {
                uniqueTop3.push(p);
            }
        } else {
            // 이미 1, 2, 3등 자리를 차지한 대표 상품의 '1+1 형제(기획)' 상품이라면? -> 버리지 말고 바구니에 살포시 담기
            const parentProduct = baseNameMap.get(baseName);
            // 너무 많이 주렁주렁 달리지 않게 (최대 2개까지만 연관 노출)
            if (parentProduct.upsell_options.length < 2) {
                parentProduct.upsell_options.push({
                    name: p.name,
                    price: p.price,
                    product_url: p.product_url
                });
            }
        }
    }

    return uniqueTop3;
  }
};
