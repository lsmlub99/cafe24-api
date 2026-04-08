import OpenAI from 'openai';
import { config } from '../config/env.js';
import { aiTaggingService } from './aiTaggingService.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 6000, 
});

/**
 * 👑 [Clinical Turbo Engine 12.2: Hard Filter & Accuracy Optimized]
 * 2단계 필터링 및 카테고리 강제 필터를 통한 초고속/고신뢰 추천 엔진입니다.
 */
export const recommendationService = {

  normalizeProduct(p, aiMeta = {}) {
    // 🎯 가격 파싱 무결성 (쉼표만 제거 후 parseFloat로 소수점 보존, 43원 오류 사태 해결)
    const cleanPrice = String(p.price || 0).replace(/,/g, '');
    const priceNum = Math.floor(parseFloat(cleanPrice) || 0);

    let thumb = p.thumbnail || p.list_image || p.detail_image || p.tiny_image || '';
    if (thumb.startsWith('//')) thumb = `https:${thumb}`;
    thumb = thumb.replace('http:', 'https:');

    // id / product_no 혼용 문제 차단
    const objectId = String(p.id || p.product_no || '');

    return {
      id: objectId,
      name: p.name || p.product_name || '',
      price: priceNum.toLocaleString(),
      retail_price: (parseInt(String(p.retail_price || 0).replace(/[^0-9]/g, '')) || 0).toLocaleString(),
      discount_rate: p.discount_rate || 0,
      thumbnail: thumb,
      summary_description: p.summary_description || p.simple_description || '',
      ai_meta: aiMeta,
      ai_tags: aiMeta.all_tags || []
    };
  },

  calculateScore(p, intent) {
    let score = 0;
    const meta = p.ai_meta || {};
    
    // [옵션 A 체계 대응] 
    // 라우터 단에서 category_no로 이미 1차 구조적 필터링을 마친 정예 리스트가 넘어옵니다.
    // 텍스트 부분 일치를 검사하지 않고, 부정어(비비크림 등)에만 걸리지 않으면 기본 카테고리 점수를 부여합니다.
    const textTarget = ((p.name || '') + (p.summary_description || '')).replace(/\s/g, '').toLowerCase();
    const isCategoryExcluded = (intent.category_excludes || []).some(ex => textTarget.includes(ex.toLowerCase()));

    if (!isCategoryExcluded) {
        score += 100; // 카테고리 조건 기본 합격
    } else {
        score -= 200; // 엉뚱한 폴백 매칭 시 원천적 배제 유도
    }

    // 피부타입 검증 (변별력 핵심)
    const hasSkinMatch = intent.skin_types.some(k => (meta.skin_type_tags || []).includes(k));
    if (hasSkinMatch) {
        score += 80; // 내 피부에 딱 맞음
    } else if ((meta.skin_type_tags || []).length > 0) {
        // 내 피부가 아닌 다른 피부(정반대 타입) 타겟인 경우 페널티 부여
        score -= 80;
    }
    
    const lineTags = meta.line_tags || [];
    if (intent.preferred_lines.has(lineTags[0] || '')) score += 30;
    
    const matchedConcerns = (meta.concern_tags || []).filter(k => intent.concerns.includes(k));
    score += matchedConcerns.length * 30;

    // 텍스처 검증
    if (intent.textures.some(k => (meta.texture_tags || []).includes(k))) score += 20;
    if (intent.avoid_textures.some(k => (meta.texture_tags || []).includes(k))) score -= 50;

    return { score };
  },

  async scoreAndFilterProducts(rawProducts, args, limit = 3) {
    if (!rawProducts || !Array.isArray(rawProducts) || rawProducts.length === 0) {
      return { recommendations: [], summary: {} };
    }

    const intent = this.normalizeUserIntent(args);
    const normalizedProducts = rawProducts.map(p => this.normalizeProduct(p));

    // [옵션 A 체계 반영] 카테고리 하드 필터 완화 및 부정어 원천 차단
    // 이미 라우터에서 category_no 기반으로 검색해 왔기 때문에, 이름에 '크림'이 없어도 스킨케어 크림(No.24)이면 타겟 풀로 인정해야 함.
    // 단, 이름 기반 폴백이 동작했을 때를 대비해 부정어(BB크림 등)만 한 번 더 걷어냅니다.
    const targetPool = normalizedProducts.filter(p => {
       const textTarget = ((p.name || '') + (p.summary_description || '')).replace(/\s/g, '').toLowerCase();
       const isExcluded = (intent.category_excludes || []).some(ex => textTarget.includes(ex.toLowerCase()));
       return !isExcluded;
    });

    // 🎯 [Phase 1] 룰베이스 기반 1차 정밀 필터링 (가장 중요한 부분)
    const preCandidates = targetPool.map(p => {
        // [중요] 아직 AI 정밀 태그가 없으므로 상품명/설명 기반 룰베이스 임시 태그를 붙여서 사전 점수를 계산합니다. (장님 정렬 방지)
        const tempTags = aiTaggingService.extractTagsByRule(p.name, p.summary_description || '');
        const tempP = this.normalizeProduct(p, tempTags);
        const { score } = this.calculateScore(tempP, intent);
        return { ...p, _preScore: score };
    }).sort((a,b) => b._preScore - a._preScore).slice(0, 15); // 알짜배기 정제 후보 선별

    // 🎯 [Phase 2] 정예 후보 AI 정밀 태깅
    const tags = await aiTaggingService.tagProducts(preCandidates);
    const tagMap = new Map(tags.map(t => [String(t.id), t]));
    
    // 🎯 [Phase 3] AI 메타데이터 반영 및 최종 스코어링 (조인 안정화)
    const finalRanked = preCandidates.map(p => {
        const meta = tagMap.get(String(p.id)) || {};
        const enriched = this.normalizeProduct(p, meta);
        const { score } = this.calculateScore(enriched, intent);
        return { ...enriched, _score: score };
    }).sort((a,b) => b._score - a._score);

    const topChoices = finalRanked.slice(0, limit);

    // 🎯 [Phase 4] AI 큐레이션 카피 생성
    try {
      if (topChoices.length === 0) throw new Error("No products to curate");

      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "system",
          content: `너는 "수석 임상 큐레이터"야. 주어진 상품들이 고객의 조건에 가장 완벽하게 부합하는 최고의 선택이라고 100% 확신하고 매력적으로 세일즈 포인트를 작성해.
          [필수 가이드]
          1. "최적은 아니다", "부족할 수 있다" 같은 부정적/방어적 코멘트 절대 금지. 무조건 고객 조건에 완벽히 부합하는 장점만 강조.
          2. 결론(conclusion)은 "최종 추천은 OOO입니다."로 고정하되, OOO은 반드시 '상품정보' 리스트의 첫 번째 1위 상품 이름을 정확히 그대로 쓸 것. 없는 이름을 새로 지어내면 절대 안 됨.
          [JSON] { "summary": { "strategy":"15자 내외", "conclusion":"" }, "results": [{ "id":"", "point": "7자 내외", "comment": "20자 내외" }] }`
        }, {
          role: "user", content: `고객상태: ${JSON.stringify(args)}\n상품정보: ${JSON.stringify(topChoices.map(t => ({id: t.id, name: t.name, tags: t.ai_tags})))}`
        }],
        response_format: { type: "json_object" }
      });

      let parsed = { results: [], summary: {} };
      try {
        parsed = JSON.parse(resp.choices[0].message.content);
      } catch (parseErr) {
        console.warn("[Curation AI JSON Parsing Error]", parseErr.message);
      }
      
      return {
        recommendations: topChoices.map(p => {
            const ai = (parsed.results || []).find(r => String(r.id) === String(p.id)) || {};
            return { ...p, key_point: ai.point || "피부 맞춤 케어", match_reasons: ai.comment || "임상 데이터 분석 기반 최적 추천입니다." };
        }),
        summary: parsed.summary || { strategy: "고객님의 피부 상태를 종합적으로 분석했습니다.", conclusion: `최종 추천은 ${topChoices[0]?.name}입니다.` }
      };
    } catch (e) {
      console.warn("[Curation AI Fail] ⚠️ 폴백 문구를 사용합니다.", e.message);
      // GPT 카피 생성 실패 시에도 서비스 방어
      return {
        recommendations: topChoices.map(p => ({ ...p, key_point: "베스트 추천", match_reasons: "고객님의 피부 타입에 맞춘 최적 상품입니다." })),
        summary: { strategy: "데이터 정밀 분석 리포트입니다.", conclusion: `최종 추천은 ${topChoices[0]?.name}입니다.` }
      };
    }
  },

  normalizeUserIntent(args) {
    const rawTypes = String(args.skin_type || '').split(/[,\s]+/).filter(Boolean);
    const skinMap = { '수부지': ['수부지', '복합성', '지성'], '지성': ['지성', '수부지'], '건성': ['건성'], '민감성': ['민감성'] };
    const lineMap = { '건성': '레이저', '민감성': '포스트알파', '지성': '아쿠아티카', '수부지': '아쿠아티카' };
    const textureMap = { '지성': ['가벼움', '산뜻함', '워터리'], '수부지': ['가벼움', '산뜻함', '워터리'], '건성': ['리치함', '크림타입'] };
    const avoidMap = { '지성': ['리치함', '밤타입', '오일타입'], '수부지': ['리치함', '밤타입', '오일타입'], '건성': ['가벼움', '젤타입'] };

    const skinTypes = new Set(), preferredLines = new Set(), textures = new Set(), avoidTextures = new Set();
    rawTypes.forEach(t => {
      const type = t.trim();
      (skinMap[type] || [type]).forEach(s => skinTypes.add(s));
      if (lineMap[type]) preferredLines.add(lineMap[type]);
      (textureMap[type] || []).forEach(tx => textures.add(tx));
      (avoidMap[type] || []).forEach(av => avoidTextures.add(av));
    });
    
    // 💡 [카테고리 예외 부정어(Negative Excludes) 추가]
    const categoryAliases = args.category_aliases || [args.category].filter(Boolean);
    let categoryExcludes = [];
    
    // 사용자가 '크림'을 요청했을 때 메이크업/바디/선케어 용품이 딸려오는 것 차단
    if (categoryAliases.includes('크림') || categoryAliases.includes('cream')) {
        categoryExcludes = ['비비크림', 'bb크림', '선크림', '썬크림', '아이크림', '바디크림', '핸드크림', '넥크림', '톤업크림', '클렌징'];
    } else if (categoryAliases.includes('세럼') || categoryAliases.includes('앰플')) {
        categoryExcludes = ['선세럼', '썬세럼', '클렌징'];
    }

    return {
      category: categoryAliases, 
      category_excludes: categoryExcludes,
      skin_types: Array.from(skinTypes),
      preferred_lines: preferredLines,
      concerns: args.concerns || [],
      textures: Array.from(textures),
      avoid_textures: Array.from(avoidTextures)
    };
  }
};
