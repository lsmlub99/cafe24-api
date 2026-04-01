/**
 * 상품 추천 및 채점 비즈니스 로직 처리를 전담하는 서비스 레이어
 * (목적: 라우터 파일의 비대화를 막고, 향후 알고리즘 변경 시 이곳만 수정하도록 격리)
 */
export const recommendationService = {
  // 📚 [뷰티 전문 동의어 사전] 사용자가 "건성"이라고 물어븼을 때, 상품명에 "건성"이란 글자가 없어도
  // "보습, 수분, 촉촉" 같은 관련 단어가 있으면 매칭시켜주는 확장 사전입니다.
  SYNONYMS: {
    // 피부 타입 동의어
    '건성': ['보습', '수분', '촉촉', '세라마이드', '장벽', '드라이', '너리싱', '모이스처', '하이루론'],
    '지성': ['유분', '산뜻', '컨트롤', '블러', '마트', '바란스', '노세범', '피지'],
    '볅합성': ['수부지', '바란스', '보습', '컨트롤', '크림', '로션'],
    '민감성': ['진정', '저자극', '병풀', '시카', '판테놀', '알란토인', '센시티브', '트러블', '아쿠아'],
    // 피부 고민 동의어
    '트러블': ['여드름', '브레미쉬', '진정', '산뜻', '솜루션', '치성', '스팟'],
    '진정': ['시카', '병풀', '판테놀', '알로에', '카마', '센시티브', '을트라', '굿몰닝'],
    '수분': ['보습', '촉촉', '하이루론', '아쿠아', '모이스처', '워터'],
    '미백': ['비타민', '톤업', '브라이트닝', '나이아신아마이드', '멜라닌', '화이트닝'],
    '커버': ['비비', '쿠션', '파운데이션', '톤업', '커버력'],
    '선케어': ['선크림', '선블록', 'spf', 'uv', '자외선', '선베이스', '썬스크린'],
    '안티에이징': ['주름', '탄력', '콜라겠', '리프팅', '펼타이드', '리주버네이션'],
    // 카테고리 동의어
    '크림': ['보습크림', '모이스처라이져', '수분크림', '너리싱', '날크림', '나이트크림', '겔크림'],
    '앰플': ['세럼', '에센스', '부스터', '오일'],
    '선크림': ['spf', 'uv', '선베이스', '썬스크린', '선블록', '사스크린', '자외선'],
    '비비': ['비비크림', '블레미쉬', '톤업', '커버'],
    '클렌징': ['세안', '폼', '클렌저', '클리닝', '워시'],
    '마스크': ['팩', '마스크팩', '시트마스크', '패드'],
    '토너': ['스킨', '토너', '로션', '토너패드'],
  },

  // 키워드 + 동의어를 모두 합쳐서 확장 검색어 배열을 만드는 유틸
  _expandKeywords(keyword) {
    if (!keyword) return [];
    const lower = keyword.toLowerCase();
    const synonyms = this.SYNONYMS[lower] || [];
    return [lower, ...synonyms];
  },

  scoreAndFilterProducts(products, args, limit = 3) {
    const { skin_type, concerns = [], category } = args;

    // 1. 가져온 상품들에 대해 하나씩 채점 실행
    const scoredProducts = products.map(p => {
        let score = 0;
        let reasons = [];
        
        // [지능 고도화] 검색 텍스트 합치기 (이름, 요약, 핵심특징, 해시태그)
        const searchTarget = [
            p.product_name, 
            p.summary_description, 
            p.simple_description, // 성분/효능이 들어있을 확률이 높음
            ...(Array.isArray(p.product_tag) ? p.product_tag : [])
        ].map(v => (v || '').toLowerCase()).join(' ');

        // [채점 로직] 카테고리 (비중 높음) + 동의어 확장 검색
        const categoryWords = this._expandKeywords(category);
        let categoryMatched = false;
        if (category) {
            for (const kw of categoryWords) {
                if (searchTarget.includes(kw)) {
                    score += 5; // 가중치 상향 (3 -> 5)
                    reasons.push(`[${category}] 카테고리 매칭`);
                    categoryMatched = true;
                    break;
                }
            }
            // 🚫 [강력 필터] 카테고리를 명시했는데 매칭되지 않으면 세럼 대신 마스크가 뜨는 걸 막기 위해 점수를 확 깎음
            if (!categoryMatched) {
                score -= 20; 
            }
        }

        // [채점 로직] 피부타입 + 동의어 확장 검색
        const skinWords = this._expandKeywords(skin_type);
        for (const kw of skinWords) {
            if (searchTarget.includes(kw)) {
                score += 2;
                reasons.push(`${skin_type} 피부 타입 적합`);
                break;
            }
        }
        
        // [채점 로직] 피부 고민들 + 동의어 확장 검색
        concerns.forEach(c => {
            const cWords = this._expandKeywords(c);
            for (const kw of cWords) {
                if (searchTarget.includes(kw)) {
                    score += 2;
                    reasons.push(`'${c}' 고민 해결 도움`);
                    break;
                }
            }
        });

        // [패널티 로직] 품절 차단
        if (p.sold_out === 'T' || p.selling === 'F') {
            score -= 10; 
            reasons.push(`현재 품절/미판매 상태`);
        }

        // 키워드 매칭은 안 됐지만 품절도 아니면 쇼핑몰 자체 랭킹/진열순을 위해 0.5점 기본점수 부여
        let isGenericBestseller = false;
        if (reasons.length === 0 && score === 0 && p.sold_out === 'F') {
           score += 0.5;
           reasons.push("셀퓨전씨 공식 추천 상품");
           isGenericBestseller = true;
        }

        // 👉 [고도의 디테일] 피부 고민 등 맞춤형 추천일 때는 지루함 방지용 랜덤성(Jitter) 부여!
        // 단, 사용자가 "베스트셀러 아무거나 랭킹 보여줘" 등 조건이 없는 범용 질문일 때는, 카페24 공식 랭킹 순서를 파괴하지 않고 일관된 신뢰도를 주기 위해 난수 개입을 차단합니다!
        if (score > 0 && !isGenericBestseller) {
           score += Math.random() * 0.4;
        }

        // 최종 가공 객체 리턴
        return {
            id: p.product_no,
            name: p.product_name,
            price: `${parseInt(p.price)}원`,
            product_url: `https://cellfusionc.co.kr/product/detail.html?product_no=${p.product_no}`,
            thumbnail: (() => {
                let img = p.list_image || p.detail_image || p.tiny_image;
                if (!img) return 'https://dummyimage.com/180x180/e0e0e0/555555.png?text=No_Image'; 
                
                // HTTP 프로토콜 강제 HTTPS 변환 (AI 브라우저에서 Mixed Content 보안 검열로 인한 엑스박스 방지)
                if (img.startsWith('//')) img = `https:${img}`;
                if (img.startsWith('http://')) img = img.replace('http://', 'https://');
                
                return img;
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
    const uniqueTopN = [];
    const baseNameMap = new Map(); // 본명(Base Name) 추적용
    
    for (const p of validProducts) {
        // 정규식으로 '[1+1]', '(증정)', '기획' 등을 싹 날려버리고 핵심 단어(Base Name)만 추출
        const baseName = p.name.replace(/\[.*?\]|\(.*?\)|1\+1|기획|세트|증정|대용량/g, '').trim();
        
        // 처음 발견하는 본명이라면 (대표 상품)
        if (!baseNameMap.has(baseName)) {
            p.upsell_options = []; // 이 상품의 기획/1+1 버전을 담을 연관 상품 바구니
            baseNameMap.set(baseName, p);
            
            if (uniqueTopN.length < limit) {
                uniqueTopN.push(p);
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
        
        // 꽉 차면 종료 (기본 3, 최대 5)
        if (uniqueTopN.length === limit) break;
    }

    return uniqueTopN;
  }
};
