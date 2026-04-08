import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * 👑 [High-Impact Engine 11.8]
 * 복합 피부 상태를 타격하는 강력한 큐레이션 문구와 '핵심 포인트'를 생성합니다.
 */
export const recommendationService = {

  normalizeProduct(p, aiMeta = {}) {
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
    if (intent.skin_types.some(k => (meta.skin_type_tags || []).includes(k))) {
      score += 40; breakdown.skin_type = +40;
    }
    if (intent.preferred_lines.has((meta.line_tags || [])[0])) {
      score += 30; breakdown.line = +30;
    }
    const matchedConcerns = (meta.concern_tags || []).filter(k => intent.concerns.includes(k));
    if (matchedConcerns.length > 0) {
      const s = matchedConcerns.length * 30;
      score += s; breakdown.concern = s;
    }
    if (intent.textures.some(k => (meta.texture_tags || []).includes(k))) {
      score += 20; breakdown.texture = +20;
    }
    if (intent.avoid_textures.some(k => (meta.texture_tags || []).includes(k))) {
      score -= 50; breakdown.conflict = -50;
    }

    return { score, breakdown };
  },

  normalizeUserIntent(args) {
    const rawTypes = String(args.skin_type || '').split(/[,\s]+/).filter(Boolean);
    const skinMap = { '수부지': ['수부지', '복합성', '지성'], '지성': ['지성', '수부지'], '건성': ['건성'], '민감성': ['민감성'] };
    const lineMap = { '건성': '레이저', '민감성': '포스트알파', '지성': '아쿠아티카', '수부지': '아쿠아티카' };
    const textureMap = { '지성': ['가벼움', '산뜻함', '워터리'], '수부지': ['가벼움', '산뜻함', '워터리'], '건성': ['리치함', '크림타입'] };
    const avoidMap = { '지성': ['리치함', '밤타입', '오일타입'], '수부지': ['리치함', '밤타입', '오일타입'], '건성': ['가벼움', '젤타입'] };

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
    
    // 💡 퀄리티 유지 및 속도 개선을 위해 상위 15개로 정예화
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
          content: `너는 "임상 기반 뷰티 마스터"야. 기획자 지침을 100% 준수해.
          
          [큐레이션 강화]
          1. 핵심 포인트(point): 해당 제품이 왜 최고인지 7자 내외 강렬한 한 문장 추출.
          2. 복합 코멘트(comment): 최소 2가지 이상의 피부 상태(ex: 건조함+민감함)를 연결하여 "언제, 왜" 좋은지 설명.
          3. strategy/conclusion: 따뜻하고 확신에 찬 전문가 문체 사용.
          
          [JSON] { "summary": { "strategy":"", "conclusion":"" }, "results": [{ "id", "point": "", "comment": "" }] }`
        }, {
          role: "user",
          content: `질문: ${JSON.stringify(args)}\n후보: ${JSON.stringify(gptInput)}`
        }],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(resp.choices[0].message.content);
      
      return {
        recommendations: topChoices.map(p => {
          const aiInfo = (parsed.results || []).find(r => String(r.id) === String(p.id)) || {};
          return { 
            ...p, 
            key_point: aiInfo.point || "피부 속성 맞춤 케어",
            match_reasons: aiInfo.comment || "임상 데이터 분석 기반 최적 추천입니다." 
          };
        }),
        summary: parsed.summary
      };

    } catch (e) {
      console.error("[Clinical High-Impact Fail]", e.message);
      return { recommendations: topChoices, summary: { strategy: "분석 루틴", conclusion: `최종 추천은 ${topChoices[0]?.name}입니다.` } };
    }
  }
};
