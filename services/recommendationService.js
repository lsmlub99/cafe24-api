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
    // 🎯 가격 파싱 무결성
    const rawPrice = String(p.price || 0).replace(/[^0-9]/g, '');
    const priceNum = parseInt(rawPrice) || 0;

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
    
    // [Fix 2] Category 점수 계산 시 Alias 전체 반영 및 복합 검증
    // name, summary_description, meta.category_tags 전체를 통합하여 다중 alias로 검사
    const textTarget = ((p.name || '') + (p.summary_description || '')).replace(/\s/g, '').toLowerCase();
    const metaCatTags = meta.category_tags || [];

    const hasCategoryMatch = intent.category.some(alias => {
        const lowerAlias = alias.toLowerCase();
        // 텍스트에 포함되거나, 메타데이터 태그 풀 안에 존재하면 합격
        return textTarget.includes(lowerAlias) || metaCatTags.some(t => t.toLowerCase() === lowerAlias);
    });

    if (hasCategoryMatch) score += 100;

    // 속성 매칭 점수
    if (intent.skin_types.some(k => (meta.skin_type_tags || []).includes(k))) score += 40;
    
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

    // [Fix 1] 카테고리 하드 필터 추가 (엉뚱한 상품 1차 차단)
    // - 선크림/선세럼 요청인데 비비크림이 섞여오는 오류 방지
    const matchedCategoryProducts = normalizedProducts.filter(p => {
       const textTarget = ((p.name || '') + (p.summary_description || '')).replace(/\s/g, '').toLowerCase();
       return intent.category.some(alias => textTarget.includes(alias.toLowerCase()));
    });

    // 필터 결과가 0개일 때만 전체 후보군으로 Fallback
    const targetPool = matchedCategoryProducts.length > 0 ? matchedCategoryProducts : normalizedProducts;

    // 🎯 [Phase 1] 룰베이스 기반 1차 필터링
    const preCandidates = targetPool.map(p => {
        const { score } = this.calculateScore(p, intent);
        return { ...p, _preScore: score };
    }).sort((a,b) => b._preScore - a._preScore).slice(0, 15); // 정예 후보 선별

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
          content: `너는 "수석 임상 큐레이터"야. 사실 기반의 짧고 강렬한 코멘트 작성.
          [가이드] 1. 핵심 포인트(point) 7자 내외. 2. 결론은 "최종 추천은 OOO입니다." 고정.
          [JSON] { "summary": { "strategy":"", "conclusion":"" }, "results": [{ "id", "point": "", "comment": "" }] }`
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

    return {
      category: args.category_aliases || [args.category].filter(Boolean), 
      skin_types: Array.from(skinTypes),
      preferred_lines: preferredLines,
      concerns: args.concerns || [],
      textures: Array.from(textures),
      avoid_textures: Array.from(avoidTextures)
    };
  }
};
