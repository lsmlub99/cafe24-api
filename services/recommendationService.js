import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * 👑 [Clean Meta Engine 11.3]
 * 상품 데이터와 요약 메타데이터를 분리하여 데이터 구조의 완결성을 확보한 최종 버전입니다.
 */
export const recommendationService = {

  normalizeProduct(p, aiMeta = {}) {
    let thumb = p.list_image || p.detail_image || p.tiny_image || '';
    if (thumb.startsWith('//')) thumb = `https:${thumb}`;
    thumb = thumb.replace('http:', 'https:');

    return {
      id: String(p.product_no || p.id),
      name: p.product_name || p.name,
      price: (parseInt(p.price) || 0).toLocaleString(),
      retail_price: (parseInt(p.retail_price) || 0).toLocaleString(),
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
    if (intent.preferred_lines.some(k => (meta.line_tags || []).includes(k))) {
      score += 30; breakdown.line = +30;
    }
    const matchedConcerns = (meta.concern_tags || []).filter(k => intent.concerns.includes(k));
    if (matchedConcerns.length > 0) {
      const s = matchedConcerns.length * 30;
      score += s; breakdown.concern = s;
    }
    const matchedTextures = (meta.texture_tags || []).filter(k => intent.textures.includes(k));
    if (matchedTextures.length > 0) {
      const s = matchedTextures.length * 20;
      score += s; breakdown.texture = s;
    }
    if (intent.avoid_textures.some(k => (meta.texture_tags || []).includes(k))) {
      score -= 50; breakdown.conflict = -50;
    }

    return { score, breakdown };
  },

  normalizeUserIntent(args) {
    const skinMap = { '수부지': ['수부지', '복합성', '지성'], '지성': ['지성', '수부지'], '건성': ['건성'] };
    const lineMap = { '건성': ['레이저', '패리어'], '지성': ['아쿠아티카'], '수부지': ['아쿠아티카'], '민감성': ['포스트알파'] };
    const textureMap = { '지성': ['가벼움', '산뜻함', '워터리'], '수부지': ['가벼움', '산뜻함', '워터리'], '건성': ['리치함', '크림타입'] };
    const avoidMap = { '지성': ['리치함', '밤타입', '오일타입'], '수부지': ['리치함', '밤타입', '오일타입'], '건성': ['가벼움', '젤타입'] };

    return {
      category: args.category_aliases || [args.category], 
      skin_types: skinMap[args.skin_type] || [args.skin_type],
      preferred_lines: lineMap[args.skin_type] || [],
      concerns: args.concerns || [],
      textures: textureMap[args.skin_type] || [],
      avoid_textures: avoidMap[args.skin_type] || []
    };
  },

  async scoreAndFilterProducts(normalizedProducts, args, limit = 3) {
    if (!normalizedProducts || normalizedProducts.length === 0) return { recommendations: [], summary: {} };

    const intent = recommendationService.normalizeUserIntent(args);

    const finalRanked = normalizedProducts.map(p => {
      const { score, breakdown } = recommendationService.calculateScore(p, intent);
      return { ...p, _score: score, _breakdown: breakdown };
    }).sort((a, b) => b._score - a._score);

    console.log(`[Engine 11.3] 🎯 Top1: ${finalRanked[0]?.name} (Score: ${finalRanked[0]?._score})`);
    
    const topChoices = finalRanked.slice(0, limit);

    const gptInput = topChoices.map(p => ({
      id: p.id,
      name: p.name,
      tags: p.ai_tags || [],
      desc: p.summary_description.slice(0, 150)
    }));

    try {
      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "system",
          content: `너는 "데이터 팩트 큐레이터"야. 기결정된 순위를 유지하며 사실 근거 요약만 한국어로 작성해.
          [JSON] { "summary": { "strategy":"", "conclusion":"" }, "results": [{ "id", "comment": "" }] }`
        }, {
          role: "user",
          content: JSON.stringify(gptInput)
        }],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(resp.choices[0].message.content);
      
      const recommendations = topChoices.map(p => {
        const aiInfo = (parsed.results || []).find(r => String(r.id) === String(p.id)) || {};
        return {
          ...p,
          match_reasons: aiInfo.comment || "데이터 속성 일치도 기반의 추천 품목입니다."
        };
      });

      return {
        recommendations,
        summary: {
          strategy: parsed.summary?.strategy || "데이터 기반 맞춤 솔루션 분석입니다.",
          conclusion: parsed.summary?.conclusion || `오늘의 분석 결과 1순위는 ${topChoices[0].name}입니다.`
        }
      };

    } catch (e) {
      console.error("[GPT Unified Fail]", e.message);
      return { recommendations: topChoices, summary: { strategy: "분석 리포트", conclusion: "추천 상품 리스트" } };
    }
  }
};
