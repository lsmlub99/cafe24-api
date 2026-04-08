import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * 👑 [Card-UX Optimized Engine 11.7]
 * 복합 피부 타입을 정교하게 분석하고, 카드 UI에 최적화된 극한의 요약을 수행합니다.
 */
export const recommendationService = {

  normalizeProduct(p, aiMeta = {}) {
    // 🎯 💡 기획자 요청: 가격 파싱 검증 강화 (숫자 외 문자 제거)
    const rawPrice = String(p.price || 0).replace(/[^0-9]/g, '');
    const priceNum = parseInt(rawPrice) || 0;

    let thumb = p.list_image || p.detail_image || p.tiny_image || '';
    if (thumb.startsWith('//')) thumb = `https:${thumb}`;
    thumb = thumb.replace('http:', 'https:');

    return {
      id: String(p.product_no || p.id),
      name: p.product_name || p.name,
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
    const breakdown = { category: 0, skin_type: 0, concern: 0, line: 0, texture: 0, conflict: 0 };

    if (intent.category.some(k => (meta.category_tags || []).includes(k))) {
      score += 100; breakdown.category = +100;
    }
    // 복합 피부 타입 중 하나라도 일치하면 가점
    if (intent.skin_types.some(k => (meta.skin_type_tags || []).includes(k))) {
      score += 40; breakdown.skin_type = +40;
    }
    // 전용 라인 일치 가점
    if (intent.preferred_lines.has((meta.line_tags || [])[0])) {
      score += 30; breakdown.line = +30;
    }
    
    const matchedConcerns = (meta.concern_tags || []).filter(k => intent.concerns.includes(k));
    if (matchedConcerns.length > 0) {
      const s = matchedConcerns.length * 30;
      score += s; breakdown.concern = s;
    }

    // 제형 선호/상충 (합집합 기반)
    if (intent.textures.some(k => (meta.texture_tags || []).includes(k))) {
      score += 20; breakdown.texture = +20;
    }
    if (intent.avoid_textures.some(k => (meta.texture_tags || []).includes(k))) {
      score -= 50; breakdown.conflict = -50;
    }

    return { score, breakdown };
  },

  normalizeUserIntent(args) {
    // 🎯 💡 기획자 요청: 복합 피부 타입 분해 처리
    const rawTypes = String(args.skin_type || '').split(/[,\s]+/).filter(Boolean);
    
    // 개별 타입별 데이터 맵
    const skinMap = { '수부지': ['수부지', '복합성', '지성'], '지성': ['지성', '수부지'], '건성': ['건성'], '민감성': ['민감성'] };
    const lineMap = { '건성': '레이저', '민감성': '포스트알파', '지성': '아쿠아티카', '수부지': '아쿠아티카' };
    const textureMap = { '지성': ['가벼움', '산뜻함', '워터리'], '수부지': ['가벼움', '산뜻함', '워터리'], '건성': ['리치함', '크림타입'] };
    const avoidMap = { '지성': ['리치함', '밤타입', '오일타입'], '수부지': ['리치함', '밤타입', '오일타입'], '건성': ['가벼움', '젤타입'] };

    // 합집합을 위한 Set/Array 초기화
    const skinTypes = new Set();
    const preferredLines = new Set();
    const textures = new Set();
    const avoidTextures = new Set();

    rawTypes.forEach(t => {
      const type = t.trim();
      (skinMap[type] || [type]).forEach(s => skinTypes.add(s));
      if (lineMap[type]) preferredLines.add(lineMap[type]);
      (textureMap[type] || []).forEach(tx => textures.add(tx));
      (avoidMap[type] || []).forEach(av => avoidTextures.add(av));
    });

    return {
      category: args.category_aliases || [args.category], 
      skin_types: Array.from(skinTypes),
      preferred_lines: preferredLines,
      concerns: args.concerns || [],
      textures: Array.from(textures),
      avoid_textures: Array.from(avoidTextures)
    };
  },

  async scoreAndFilterProducts(normalizedProducts, args, limit = 3) {
    if (!normalizedProducts || normalizedProducts.length === 0) return { recommendations: [], summary: {} };

    const intent = recommendationService.normalizeUserIntent(args);

    const finalRanked = normalizedProducts.map(p => {
      const { score, breakdown } = recommendationService.calculateScore(p, intent);
      return { ...p, _score: score, _breakdown: breakdown };
    }).sort((a, b) => b._score - a._score);
    
    const topChoices = finalRanked.slice(0, limit);

    const gptInput = topChoices.map(p => ({
      id: p.id,
      name: p.name,
      tags: p.ai_tags || [],
      desc: p.summary_description.slice(0, 100)
    }));

    try {
      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "system",
          content: `너는 "카드형 UI에 최적화된 뷰티 큐레이터"야. 아래 제약을 엄수해.
          
          [출력 제약]
          1. strategy: 딱 한 문장, 35자 내외로 핵심만 작성 (예: "건조함과 민감함을 동시에 잡는 수분 루틴입니다.")
          2. conclusion: 반드시 "최종 추천은 OOO입니다." 형식으로 1위 제품명만 언급.
          3. comment: 자연스러운 한 문장. 상황 중심 (세안 후, 외부 자극 등).
          4. 여러 제품 비교 금지. 순위 판단은 코드가 이미 완료함.
          
          [JSON] { "summary": { "strategy":"", "conclusion":"" }, "results": [{ "id", "comment": "" }] }`
        }, {
          role: "user",
          content: `질문상태: ${JSON.stringify(args)}\n후보: ${JSON.stringify(gptInput)}`
        }],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(resp.choices[0].message.content);
      
      return {
        recommendations: topChoices.map(p => {
          const aiInfo = (parsed.results || []).find(r => String(r.id) === String(p.id)) || {};
          return { ...p, match_reasons: aiInfo.comment || "임상 데이터 분석 기반 최적 추천입니다." };
        }),
        summary: parsed.summary || { 
          strategy: "피부 타입별 정밀 분석 리포트", 
          conclusion: `최종 추천은 ${topChoices[0].name}입니다.` 
        }
      };

    } catch (e) {
      console.error("[Clinical Card Fail]", e.message);
      return { recommendations: topChoices, summary: { strategy: "분석 리포트", conclusion: `최종 추천은 ${topChoices[0]?.name}입니다.` } };
    }
  }
};
