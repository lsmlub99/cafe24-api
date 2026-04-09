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
   * [ISSUE 4 해결] attributes, keywords 누락 시 fallback 로직 강화
   */
  normalizeProduct(p) {
    const cleanPrice = String(p.price || 0).replace(/,/g, '');
    const priceNum = Math.floor(parseFloat(cleanPrice) || 0);

    let thumb = p.list_image || p.detail_image || p.tiny_image || '';
    if (thumb.startsWith('//')) thumb = `https:${thumb}`;
    else if (thumb.startsWith('/')) thumb = `https://cellfusionc.co.kr${thumb}`;
    thumb = thumb.replace('http:', 'https:');

    // [Fallback] 데이터가 부족한 경우 제품명에서 유추
    const name = p.product_name || '';
    const fallbackKeywords = [];
    if (name.includes('선') || name.includes('썬')) fallbackKeywords.push('자외선차단');
    if (name.includes('크림')) fallbackKeywords.push('보습');
    if (name.includes('시카')) fallbackKeywords.push('진정');

    return {
      id: String(p.product_no || p.product_id || ''),
      name: name,
      price: priceNum.toLocaleString(),
      thumbnail: thumb,
      summary_description: p.summary_description || p.simple_description || '',
      keywords: p.keywords && p.keywords.length > 0 ? p.keywords : fallbackKeywords,
      attributes: p.attributes || { concern_tags: fallbackKeywords, line_tags: [] },
      category_ids: p.category_ids || [] 
    };
  },

  /**
   * 🎯 calculateScore: 룰베이스 정밀 점수 계산
   * [ISSUE 3 해결] 카테고리명(String)과 ID(Number) 하이브리드 매칭
   * [ISSUE 2 해결] 제형(Texture) 선호/비선호 점수 복구
   */
  calculateScore(product, intent) {
    let score = 0;
    const attrs = product.attributes || {};
    const name = (product.name || '').toLowerCase();
    const desc = (product.summary_description || '').toLowerCase();
    const text = name + ' ' + desc;

    // ── 1. 하이브리드 카테고리 매칭 (Name or ID) ──
    const productCatIds = (product.category_ids || []).map(id => String(id));
    const hasCategoryMatch = intent.target_categories.some(cat => {
        const catStr = String(cat).toLowerCase();
        // 상품 텍스트(이름/설명)에 카테고리명이 포함되어 있거나, ID가 일치하는지 확인
        return text.includes(catStr) || productCatIds.includes(catStr);
    });
    
    if (hasCategoryMatch) score += 150;
    else if (intent.target_categories.length > 0) score -= 50;

    // ── 2. 제품 라인 매칭 ──
    const lineTags = attrs.line_tags || [];
    if (intent.preferred_lines.size > 0 && lineTags.some(l => intent.preferred_lines.has(l))) {
      score += 40;
    }

    // ── 3. 고민 키워드 매칭 ──
    const concernTags = attrs.concern_tags || [];
    const matchedConcerns = concernTags.filter(c => intent.concerns.includes(c));
    score += matchedConcerns.length * 30;

    // ── 4. 제형(Texture) 선호/비선호 점수 [복구] ──
    const textureTags = attrs.texture_tags || [];
    // 선호 제형 매칭
    if (intent.textures.some(t => textureTags.some(pt => pt.includes(t)))) score += 20;
    // 비선호 제형 패널티
    if (intent.avoid_textures.some(t => textureTags.some(pt => pt.includes(t)))) score -= 60;

    return { score };
  },

  /**
   * 📊 scoreAndFilterProducts: 메인 추천 파이프라인
   */
  async scoreAndFilterProducts(cachedProducts, args, limit = 3) {
    if (!cachedProducts || cachedProducts.length === 0) {
      return { recommendations: [], summary: { message: '데이터가 없습니다.' } };
    }

    const intent = this.normalizeUserIntent(args);

    if (!intent.has_intent) {
        return {
            recommendations: [],
            summary: {
                message: '안녕하세요! 피부 타입이나 카테고리를 말씀해 주시면 딱 맞는 제품을 추천해 드릴게요. 😊'
            }
        };
    }

    // ── Phase 1: 정규화 (Fallback 발동) ──
    const normalized = cachedProducts.map(p => this.normalizeProduct(p));

    // ── Phase 2: 점수 계산 ──
    const scored = normalized.map(p => {
      const { score } = this.calculateScore(p, intent);
      return { ...p, _score: score };
    }).filter(p => p._score > 0)
      .sort((a, b) => b._score - a._score);

    // ── Phase 3: 중복 제거 및 상위 N개 확정 ──
    const seenNames = new Set();
    const finalFiltered = [];
    for (const p of scored) {
        const baseName = p.name.replace(/\[.*?\]/g, '').trim();
        if (!seenNames.has(baseName)) {
            seenNames.add(baseName);
            finalFiltered.push(p);
        }
        if (finalFiltered.length >= limit) break;
    }

    if (finalFiltered.length === 0) {
        return { recommendations: [], summary: { message: '조건에 맞는 결과가 없습니다.' } };
    }

    // ── Phase 4: [Robust Block UI] 데이터 생성 ──
    const recommendations = finalFiltered.map((p, idx) => {
        let key_point = '피부 맞춤 케어';
        const name = p.name;
        if (name.includes('레이저')) key_point = '장벽 강화 및 밀착 보습';
        else if (name.includes('아쿠아')) key_point = '산뜻하고 강력한 수분 공급';
        else if (name.includes('포스트알파')) key_point = '예민 피부 긴급 진정';
        else if (name.includes('시카')) key_point = '붉은기 집중 완화';
        else if (name.includes('썬')) key_point = '자극 없는 자외선 차단';
        
        return {
            rank: idx + 1,
            rank_label: idx === 0 ? '🏆 1위(BEST)' : `${idx + 1}위`,
            name: p.name,
            price: p.price,
            key_point: key_point,
            buy_url: `https://cellfusionc.co.kr/product/detail.html?product_no=${p.id}`,
            image: p.thumbnail
        };
    });

    // ── Phase 4: [ULTIMATE MASTER TABLE] ──
    const finalMdContent = `
| 👑 **1위(BEST)** | **2위** | **3위** |
| :---: | :---: | :---: |
| ![Img](${recommendations[0].image}) | ![Img](${recommendations[1]?.image || ''}) | ![Img](${recommendations[2]?.image || ''}) |
| **${recommendations[0].name}** | **${recommendations[1]?.name || '-'}** | **${recommendations[2]?.name || '-'}** |
| \`${recommendations[0].price}원\` | \`${recommendations[1]?.price || '-'}원\` | \`${recommendations[2]?.price || '-'}원\` |
| [**구매하기**](${recommendations[0].buy_url}) | ${recommendations[1] ? `[**구매하기**](${recommendations[1].buy_url})` : '-'} | ${recommendations[2] ? `[**구매하기**](${recommendations[2].buy_url})` : '-'} |
`;

    const detailGuides = recommendations.map(p => `> **[${p.rank}]** ${p.key_point}`).join('\n');

    return {
        recommendations,
        custom_markdown: `### 🧴 **맞춤 분석 솔루션**\n${finalMdContent}\n${detailGuides}\n\n---`,
        summary: { message: '' } // AI 사족 방지
    };
  },

  /**
   * 🧠 normalizeUserIntent: 사용자 입력을 룰베이스 검색 조건으로 변환
   */
  normalizeUserIntent(args) {
    const rawQuery = (args.q || args.query || '').toLowerCase();
    const rawTypes = String(args.skin_type || '').split(/[,\s]+/).filter(Boolean);
    
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

    const concernKeywords = {
        '진정': ['진정', '붉은', '예민', '달래', 'calm', '시카', '병풀'],
        '보습': ['촉촉', '건조', '당김', '수분', 'moist', '아쿠아'],
        '커버': ['커버', '흉터', '잡티', '가림', '비비', '톤업'],
        '시원': ['시원', '쿨링', '열감', '화끈', '얼음'],
        '모공': ['모공', '피지', '기름', '지성', 'pore', '피지']
    };

    let detectedCategories = new Set(args.category_aliases || [args.category].filter(Boolean));
    let detectedConcerns = new Set(args.concerns || []);

    if (rawQuery) {
        Object.entries(categoryKeywords).forEach(([cat, keys]) => {
            if (keys.some(k => rawQuery.includes(k))) detectedCategories.add(cat);
        });
        Object.entries(concernKeywords).forEach(([con, keys]) => {
            if (keys.some(k => rawQuery.includes(k))) detectedConcerns.add(con);
        });
    }

    const preferredLines = new Set();
    const textures = new Set();
    const avoidTextures = new Set();

    if (detectedConcerns.has('진정')) preferredLines.add('포스트알파');
    if (detectedConcerns.has('보습')) preferredLines.add('레이저');
    if (detectedConcerns.has('모공')) preferredLines.add('아쿠아티카');
    if (detectedConcerns.has('커버')) preferredLines.add('토닝');

    rawTypes.forEach(t => {
      const type = t.trim();
      if (type === '지성' || type === '수부지') {
          ['가벼움', '산뜻함', '워터리'].forEach(tx => textures.add(tx));
      } else if (type === '건성') {
          textures.add('리치함');
      }
    });

    return {
      query: rawQuery,
      target_categories: Array.from(detectedCategories),
      category_excludes: [],
      concerns: Array.from(detectedConcerns),
      preferred_lines: preferredLines,
      textures: Array.from(textures),
      avoid_textures: Array.from(avoidTextures),
      has_intent: detectedCategories.size > 0 || detectedConcerns.size > 0 || rawTypes.length > 0
    };
  }
};
