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

    // ── Phase 1: 정규화 ──
    const normalized = cachedProducts.map(p => this.normalizeProduct(p));

    // ── Phase 2: 룰베이스 점수 계산 + 정렬 (deterministic) ──
    const scored = normalized.map(p => {
      const { score } = this.calculateScore(p, intent);
      return { ...p, _score: score };
    }).filter(p => p._score > 0)
      .sort((a, b) => b._score - a._score);

    // ── Phase 3: 상위 N개 확정 (AI는 이 리스트를 절대 변경할 수 없음) ──
    const topChoices = scored.slice(0, limit);

    // [Fast Verification Log]
    console.log(`[Recommendation] 후보 ${cachedProducts.length}개 → 유효 ${scored.length}개 → Top ${topChoices.length}개`);
    console.log(`[Recommendation] Top3: ${topChoices.map(p => p.name).join(' | ')}`);

    if (topChoices.length === 0) {
      return {
        recommendations: [],
        summary: { strategy: '조건에 맞는 상품을 찾지 못했습니다.', conclusion: '' }
      };
    }

    // ── Phase 4: AI 설명/추천 문구 생성 (지시서 3️⃣ 허용 영역) ──
    // AI는 상품을 추가/제거/재정렬할 수 없음. 오직 문구만 생성.
    try {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `너는 셀퓨전씨 전문 뷰티 큐레이터야. 아래 상품 리스트는 이미 확정된 추천 결과야.
너의 역할은 오직 각 상품의 특징을 매력적으로 설명하는 것뿐이야.
[절대 금지] 상품을 추가하거나 제거하거나 순위를 바꾸는 행위
[절대 금지] 부정적/방어적 코멘트 (예: "최적은 아니다", "부족하다")
[절대 금지] 리스트에 없는 외부 브랜드/상품 언급
[필수] 결론(conclusion)의 상품명은 반드시 리스트 1위 상품명을 그대로 사용
반드시 JSON 형식으로 응답해.
{ "summary": { "strategy": "15자 이내", "conclusion": "최종 추천은 OOO입니다." }, "results": [{ "id": "", "point": "7자 이내", "comment": "25자 이내" }] }`
        }, {
          role: 'user',
          content: `고객: ${JSON.stringify(args)}\n상품: ${JSON.stringify(topChoices.map(t => ({ id: t.id, name: t.name, keywords: t.keywords, summary_description: t.summary_description, attributes: t.attributes })))}`
        }],
        response_format: { type: 'json_object' }
      });

      let parsed = { results: [], summary: {} };
      try {
        parsed = JSON.parse(resp.choices[0].message.content);
      } catch (parseErr) {
        console.warn('[Curation Parse Error]', parseErr.message);
      }

      return {
        recommendations: topChoices.map(p => {
          const ai = (parsed.results || []).find(r => String(r.id) === String(p.id)) || {};
          return {
            ...p,
            ai_tags: p.keywords,
            key_point: ai.point || '피부 맞춤 케어',
            match_reasons: ai.comment || '고객님의 피부 타입에 최적화된 상품입니다.'
          };
        }),
        summary: parsed.summary || {
          strategy: '피부 분석 완료',
          conclusion: `최종 추천은 ${topChoices[0]?.name}입니다.`
        }
      };
    } catch (e) {
      console.warn('[Curation AI Fail] 폴백 문구 사용:', e.message);
      return {
        recommendations: topChoices.map(p => ({
          ...p,
          ai_tags: p.keywords,
          key_point: '베스트 추천',
          match_reasons: '고객님의 피부 타입에 맞춘 최적 상품입니다.'
        })),
        summary: {
          strategy: '데이터 기반 분석',
          conclusion: `최종 추천은 ${topChoices[0]?.name}입니다.`
        }
      };
    }
  },

  /**
   * 🧠 normalizeUserIntent: 사용자 입력을 룰베이스 검색 조건으로 변환
   */
  normalizeUserIntent(args) {
    const rawTypes = String(args.skin_type || '').split(/[,\s]+/).filter(Boolean);
    const lineMap = { '건성': '레이저', '민감성': '포스트알파', '지성': '아쿠아티카', '수부지': '아쿠아티카' };
    const textureMap = { '지성': ['가벼움', '산뜻함', '워터리', '쿨링'], '수부지': ['가벼움', '산뜻함', '워터리'], '건성': ['리치함'], '민감성': [] };
    const avoidMap = { '지성': ['리치함', '밤타입', '오일타입'], '수부지': ['리치함', '밤타입', '오일타입'], '건성': ['가벼움'], '민감성': [] };

    const preferredLines = new Set();
    const textures = new Set();
    const avoidTextures = new Set();

    rawTypes.forEach(t => {
      const type = t.trim();
      if (lineMap[type]) preferredLines.add(lineMap[type]);
      (textureMap[type] || []).forEach(tx => textures.add(tx));
      (avoidMap[type] || []).forEach(av => avoidTextures.add(av));
    });

    // 카테고리 부정어 사전
    const categoryAliases = args.category_aliases || [args.category].filter(Boolean);
    let categoryExcludes = [];

    if (categoryAliases.some(a => ['크림', 'cream'].includes(a))) {
      categoryExcludes = ['비비크림', 'bb크림', '선크림', '썬크림', '아이크림', '바디크림', '핸드크림', '넥크림', '톤업크림', '클렌징'];
    } else if (categoryAliases.some(a => ['세럼', '앰플'].includes(a))) {
      categoryExcludes = ['선세럼', '썬세럼', '클렌징'];
    }

    return {
      category: categoryAliases,
      category_excludes: categoryExcludes,
      concerns: args.concerns || [],
      preferred_lines: preferredLines,
      textures: Array.from(textures),
      avoid_textures: Array.from(avoidTextures)
    };
  }
};
