import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 10000,
});

/**
 * 👑 [Recommendation Service v2.0]
 * 
 * 지시서 준수 역할 분리:
 *   검색/필터/점수/순위 = 100% 룰베이스 (deterministic)
 *   AI = 오직 최종 추천 문구 생성만 담당 (상품 추가/제거/재정렬 절대 불가)
 */
export const recommendationService = {

  /**
   * 🔧 normalizeProduct: 상품 데이터를 UI 출력용으로 정규화
   */
  normalizeProduct(p) {
    const cleanPrice = String(p.price || 0).replace(/,/g, '');
    const priceNum = Math.floor(parseFloat(cleanPrice) || 0);

    let thumb = p.list_image || p.detail_image || p.tiny_image || '';
    if (thumb.startsWith('//')) thumb = `https:${thumb}`;
    else if (thumb.startsWith('/')) thumb = `https://cellfusionc.co.kr${thumb}`;
    thumb = thumb.replace('http:', 'https:');

    return {
      id: String(p.product_no || p.product_id || ''),
      name: p.product_name || '',
      price: priceNum.toLocaleString(),
      thumbnail: thumb,
      summary_description: p.summary_description || p.simple_description || '',
      keywords: p.keywords || [],
      attributes: p.attributes || {}
    };
  },

  /**
   * 🎯 calculateScore: 100% 룰베이스 점수 계산
   * AI 개입 없음. 동일 입력 → 동일 출력 (deterministic)
   */
  calculateScore(product, intent) {
    let score = 0;
    const attrs = product.attributes || {};
    const name = (product.name || '').toLowerCase();
    const desc = (product.summary_description || '').toLowerCase();
    const text = name + ' ' + desc;

    // 1. 카테고리 부정어 제외 (BB크림, 선크림 등이 '크림' 검색에 딸려오는 것 차단)
    const isExcluded = (intent.category_excludes || []).some(ex => text.includes(ex.toLowerCase()));
    if (isExcluded) return { score: -999 };

    // 2. 기본 카테고리 합격 점수
    score += 100;

    // 3. 제품 라인 매칭 (아쿠아티카, 포스트알파 등)
    const lineTags = attrs.line_tags || [];
    if (intent.preferred_lines.size > 0 && lineTags.some(l => intent.preferred_lines.has(l))) {
      score += 40;
    }

    // 4. 고민 키워드 매칭 (진정, 보습, 장벽 등)
    const concernTags = attrs.concern_tags || [];
    const matchedConcerns = concernTags.filter(c => intent.concerns.includes(c));
    score += matchedConcerns.length * 30;

    // 5. 텍스처 선호/비선호
    const textureTags = attrs.texture_tags || [];
    if (intent.textures.some(t => textureTags.includes(t))) score += 20;
    if (intent.avoid_textures.some(t => textureTags.includes(t))) score -= 50;

    return { score };
  },

  /**
   * 📊 scoreAndFilterProducts: 메인 추천 파이프라인
   * 
   * 흐름 (지시서 5️⃣ 준수):
   *   1. 캐시에서 받은 상품 정규화
   *   2. 룰베이스 점수 계산 + 정렬
   *   3. 상위 N개 확정 (여기까지 AI 개입 0%)
   *   4. 확정된 상위 N개에 AI로 설명/추천 문구만 생성
   */
  async scoreAndFilterProducts(cachedProducts, args, limit = 3) {
    if (!cachedProducts || cachedProducts.length === 0) {
      return { recommendations: [], summary: {} };
    }

    const intent = this.normalizeUserIntent(args);

    // ── Phase 1.5: 의도 없음 처리 (일상 대화 등) ──
    if (!intent.has_intent) {
        return {
            recommendations: [],
            summary: {
                skin_type: 'Unknown',
                total_count: 0,
                message: '안녕하세요! 피부 타입(건성, 지성 등)이나 고민, 혹은 찾으시는 카테고리(선크림, 크림 등)를 말씀해 주시면 딱 맞는 제품을 찾아드릴게요. 😊'
            }
        };
    }

    // ── Phase 1: 정규화 ──
    const normalized = cachedProducts.map(p => this.normalizeProduct(p));

    // ── Phase 2: 룰베이스 점수 계산 + 정렬 (deterministic) ──
    const scored = normalized.map(p => {
      const { score } = this.calculateScore(p, intent);
      return { ...p, _score: score };
    }).filter(p => p._score > 0)
      .sort((a, b) => b._score - a._score);

    // ── Phase 3: 중복 제거 및 상위 N개 확정 (지시서 5️⃣: 중복 상품 개선) ──
    const seenNames = new Set();
    const finalFiltered = [];

    // [중복 처리] '[1+1]', '[기획]' 등을 제외한 순수 이름으로 비교하여 더 좋은 조건만 남김
    const sortedForDeals = scored.sort((a, b) => {
        const aHasDeal = a.name.includes('1+1') || a.name.includes('기획') || a.name.includes('세트');
        const bHasDeal = b.name.includes('1+1') || b.name.includes('기획') || b.name.includes('세트');
        if (aHasDeal && !bHasDeal) return -1;
        if (!aHasDeal && bHasDeal) return 1;
        return b._score - a._score;
    });

    for (const p of sortedForDeals) {
        const baseName = p.name.replace(/\[.*?\]/g, '').trim();
        if (!seenNames.has(baseName)) {
            seenNames.add(baseName);
            finalFiltered.push(p);
        }
        if (finalFiltered.length >= limit) break;
    }

    const topChoices = finalFiltered;

    // [Fast Verification Log]
    console.log(`[Recommendation] 후보 ${scored.length}개 → 중복제거 후 ${topChoices.length}개`);

    if (topChoices.length === 0) {
        return {
            recommendations: [],
            custom_markdown: "해당 조건의 상품이 없습니다.",
            summary: { conclusion: '검색 결과가 없습니다.' }
        };
    }

    // ── Phase 4: AI 프리미엄 문구 생성 ──
    // ── Phase 4: 구조화 데이터 생성 (플랫폼 네이티브 카드 대응) ──
    const recommendations = topChoices.map((p, idx) => {
        const badge = p.name.includes('1+1') ? '1+1' : p.name.includes('기획') ? 'EVENT' : '';
        const key_point = p.keywords[0] || '맞춤 추천';
        
        return {
            rank: idx + 1,
            id: p.id,
            name: p.name,
            image: p.thumbnail,
            price: p.price,
            badge: badge,
            key_point: key_point,
            buy_url: `https://cellfusionc.co.kr/product/detail.html?product_no=${p.id}`
        };
    });

    // 🎨 [Master-level Markdown Engine]
    // 지피티 채팅창에서 '가로형 카드' 느낌을 내기 위한 고밀도 테이블 레이아웃
    const mdHeader = `### 🧴 **고객님을 위한 맞춤형 피부 분석 리포트**\n\n`;
    const row1 = `| 🥇 **1위 (BEST)** | 🥈 **2위 (PICK)** | 🥉 **3위 (Choice)** |`;
    const row2 = `| :---: | :---: | :---: |`;
    const row3 = `| ![Img](${recommendations[0]?.image}) | ![Img](${recommendations[1]?.image || ''}) | ![Img](${recommendations[2]?.image || ''}) |`;
    const row4 = `| **${recommendations[0]?.name}** | **${recommendations[1]?.name || '-'}** | **${recommendations[2]?.name || '-'}** |`;
    const row5 = `| \`${recommendations[0]?.price}원\` | \`${recommendations[1]?.price || '-'}원\` | \`${recommendations[2]?.price || '-'}원\` |`;
    const row6 = `| [**[구매하기]**](${recommendations[0]?.buy_url}) | ${recommendations[1] ? `[**[구매하기]**](${recommendations[1].buy_url})` : '-'} | ${recommendations[2] ? `[**[구매하기]**](${recommendations[2].buy_url})` : '-'} |`;

    const tableCards = `${row1}\n${row2}\n${row3}\n${row4}\n${row5}\n${row6}`;

    const detailedGuides = recommendations.map((p, idx) => `
**[${idx + 1}위 전문가 코멘트]**
> "${p.key_point} 포인트를 가진 제품으로, 고객님의 피부 고민을 즉각적으로 해결해 드릴 수 있는 최적의 선택입니다."
`).join('\n');

    const finalMd = `${mdHeader}${tableCards}\n\n---\n${detailedGuides}\n\n*※ 실시간 데이터 분석 엔진에 의해 생성된 프리미엄 큐레이션입니다.*`;

    return {
        recommendations,
        custom_markdown: finalMd,
        summary: {
            skin_type: args.skin_type || '모든 피부',
            total_count: topChoices.length,
            message: `고객님의 피부 타입에 맞춘 ${topChoices.length}개의 최적 상품 리스트입니다.`
        }
    };
  },

  /**
   * 🧠 normalizeUserIntent: 사용자 입력을 룰베이스 검색 조건으로 변환
   */
  normalizeUserIntent(args) {
    const rawQuery = (args.q || args.query || '').toLowerCase();
    const rawTypes = String(args.skin_type || '').split(/[,\s]+/).filter(Boolean);
    
    // 🔍 키워드 기반 카테고리 추출 사전
    const categoryKeywords = {
        '선크림': ['선크림', '썬크림', '자외선', '선케어', 'sunscreen', 'sun'],
        '선스틱': ['선스틱', '썬스틱', '스틱', 'stick'],
        '크림': ['크림', '보습', '수분', 'cream'],
        '세럼': ['세럼', '에센스', 'serum', '앰플', 'ampoule'],
        '토너': ['토너', '스킨', 'toner'],
        '클렌징': ['클렌징', '세안', '폼', 'cleansing'],
        '마스크팩': ['팩', '마스크', 'mask'],
        '비비크림': ['비비', 'bb']
    };

    // 🔍 키워드 기반 고민 추출 사전
    const concernKeywords = {
        '진정': ['진정', '붉은', '예민', '달래', 'calm'],
        '보습': ['촉촉', '건조', '당김', '수분', 'moist'],
        '커버': ['커버', '흉터', '잡티', '가림'],
        '시원': ['시원', '쿨링', '열감', '화끈'],
        '모공': ['모공', '피지', '기름', '지성', 'pore']
    };

    let detectedCategories = new Set(args.category_aliases || [args.category].filter(Boolean));
    let detectedConcerns = new Set(args.concerns || []);

    // 질문 전체에서 키워드 탐색
    if (rawQuery) {
        Object.entries(categoryKeywords).forEach(([cat, keys]) => {
            if (keys.some(k => rawQuery.includes(k))) detectedCategories.add(cat);
        });
        Object.entries(concernKeywords).forEach(([con, keys]) => {
            if (keys.some(k => rawQuery.includes(k))) detectedConcerns.add(con);
        });
    }

    const lineMap = { '건성': '레이저', '민감성': '포스트알파', '지성': '아쿠아티카', '수부지': '아쿠아티카' };
    const preferredLines = new Set();
    const textures = new Set();
    const avoidTextures = new Set();

    rawTypes.forEach(t => {
      const type = t.trim();
      if (lineMap[type]) preferredLines.add(lineMap[type]);
      if (type === '지성' || type === '수부지') {
          ['가벼움', '산뜻함', '워터리'].forEach(tx => textures.add(tx));
          ['리치함', '밤타입', '오일타입'].forEach(av => avoidTextures.add(av));
      } else if (type === '건성') {
          textures.add('리치함');
          avoidTextures.add('가벼움');
      }
    });

    // 카테고리 부정어 사전
    let categoryExcludes = [];
    if (Array.from(detectedCategories).some(a => ['크림', 'cream'].includes(a))) {
      categoryExcludes = ['비비크림', 'bb크림', '선크림', '썬크림', '아이크림', '바디크림', '핸드크림', '넥크림', '톤업크림', '클렌징'];
    }

    return {
      query: rawQuery,
      target_categories: Array.from(detectedCategories),
      category_excludes: categoryExcludes,
      concerns: Array.from(detectedConcerns),
      preferred_lines: preferredLines,
      textures: Array.from(textures),
      avoid_textures: Array.from(avoidTextures),
      has_intent: detectedCategories.size > 0 || detectedConcerns.size > 0 || rawTypes.length > 0
    };
  }
};
