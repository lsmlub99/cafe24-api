import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * 👑 [Brand-Policy Guardrail Engine 7.0]
 * 기혹자님의 피드백을 기반으로 브랜드 추천 정책과 한국어 직관성을 극대화한 버전입니다.
 */
export const recommendationService = {

  normalizeText(text) {
    return (text || '').toLowerCase().replace(/\s+/g, '').trim();
  },

  getSeries(name) {
    const n = name.toLowerCase();
    if (n.includes('레이저') || n.includes('laser')) return 'Laser';
    if (n.includes('패리어') || n.includes('barrier')) return 'Barrier';
    if (n.includes('포스트') || n.includes('post')) return 'PostAlpha';
    if (n.includes('아쿠아티카') || n.includes('aquatica')) return 'Aquatica';
    if (n.includes('토닝') || n.includes('toning')) return 'Toning';
    if (n.includes('pdrn')) return 'PDRN';
    return 'Other';
  },

  async scoreAndFilterProducts(products, args, limit = 5) {
    if (!products || products.length === 0) return [];
    try {
      // 1-1. 후보군 추출 (기존 로직 유지)
      const candidatePool = recommendationService.buildCandidatePool(products, args, 25);
      if (candidatePool.length === 0) return recommendationService.getPersonalizedFallback(products, args);

      const simplifiedList = candidatePool.map(p => ({
        no: p.product_no,
        name: p.product_name,
        tags: (p.ai_tags || []).slice(0, 5),
        desc: (p.summary_description || p.simple_description || '').slice(0, 100)
      }));

      // 1-2. GPT 심층 분석 (한글 강제 + 결론 구조 변경)
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `너는 "셀퓨전씨 임상 기술 수석 큐레이터"야. 모든 답변은 반드시 한국어로만 작성해.
            [출력 규칙]
            - selection_strategy: [피부타입]의 [고민] 해결을 위해 [선별기준] 중심으로 엄선했습니다 (반드시 한국어 한 줄).
            - conclusion: [피부타입] [고민] 기준 1순위는 [상품명]입니다 (반드시 이 형식 준수).
            - results[].fit_score: High/Medium 중 선택.
            - results[].curator_comment: 한국어로 작성.

            [JSON Schema]
            {
              "summary": { "selection_strategy": "", "conclusion": "" },
              "results": [{ "no", "fit_score", "badges":[], "texture_note":"", "curator_comment":"", "caution":"" }]
            }`
          },
          {
            role: "user",
            content: `[분석요청] ${JSON.stringify(args)}\n\n[후보군]\n${JSON.stringify(simplifiedList)}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      const aiResults = parsed.results || [];

      // 🛡️ 2. [Brand & Diversity Guardrail] 코드 레벨 후처리
      let finalRecommendations = aiResults.map(res => {
          const p = candidatePool.find(prod => String(prod.product_no) === String(res.no));
          if (!p) return null;
          return {
              id: p.product_no,
              name: p.product_name,
              price: (parseInt(p.price) || 0).toLocaleString(),
              discount_rate: p.discount_rate || 0,
              thumbnail: p.thumbnail || p.list_image || '',
              series: recommendationService.getSeries(p.product_name),
              fit_score: res.fit_score || "High",
              badges: res.badges || [],
              texture_note: res.texture_note || "촉촉한 제형",
              match_reasons: res.curator_comment || "추천 상품입니다.",
              caution: (res.caution && res.caution !== "없음") ? res.caution : "",
              selection_strategy: parsed.summary?.selection_strategy || "",
              conclusion: parsed.summary?.conclusion || ""
          };
      }).filter(Boolean);

      // 🛡️ 3. [Brand Policy Enforcement] 건성/민감성 타켓 라인 상단 강제 배치
      const sType = args.skin_type;
      const coreLines = { '건성': ['Laser', 'Barrier'], '민감성': ['PostAlpha'], '지성': ['Aquatica'] };
      const targetLines = coreLines[sType] || [];
      
      if (targetLines.length > 0) {
          const hasTargetInTop3 = finalRecommendations.slice(0, 3).some(r => targetLines.includes(r.series));
          if (!hasTargetInTop3) {
              const bestTarget = candidatePool.find(p => targetLines.includes(recommendationService.getSeries(p.product_name)));
              if (bestTarget) {
                  // 타겟 상품을 1위로 강제 삽입 (기존 1위와 교체 또는 상단 배치)
                  const formatted = {
                      id: bestTarget.product_no,
                      name: bestTarget.product_name,
                      price: (parseInt(bestTarget.price) || 0).toLocaleString(),
                      discount_rate: bestTarget.discount_rate || 0,
                      thumbnail: bestTarget.thumbnail || bestTarget.list_image || '',
                      series: recommendationService.getSeries(bestTarget.product_name),
                      fit_score: "High",
                      badges: ["브랜드 추천", "핵심 라인"],
                      texture_note: "전문 임상 기반 제형",
                      match_reasons: `${sType} 피부의 근본적인 케어를 위해 브랜드 핵심 라인을 우선 추천합니다.`,
                      selection_strategy: finalRecommendations[0]?.selection_strategy || "",
                      conclusion: `${sType} 케어 최적의 1순위는 ${bestTarget.product_name}입니다.`
                  };
                  finalRecommendations.unshift(formatted);
              }
          }
      }

      // 🛡️ 4. [Diversity Filter] 동일 시리즈/라인 최대 2개 제한
      const seriesCount = {};
      finalRecommendations = finalRecommendations.filter(p => {
          seriesCount[p.series] = (seriesCount[p.series] || 0) + 1;
          return seriesCount[p.series] <= 2;
      }).slice(0, limit);

      return finalRecommendations.length > 0 ? finalRecommendations : recommendationService.getPersonalizedFallback(products, args);

    } catch (e) {
      console.error("[Fatal AI Error]", e.message);
      return recommendationService.getPersonalizedFallback(products, args);
    }
  },

  buildCandidatePool(products, args, targetSize = 25) {
    const { category, skin_type, concerns } = args;
    const skinKeywords = recommendationService.getSkinTypeKeywords(skin_type);
    const concernKeywords = recommendationService.getConcernKeywords(concerns);
    const scored = products.map(p => {
      let score = 0;
      const text = recommendationService.normalizeText(p.product_name + (p.summary_description || '') + (p.ai_tags || []).join(''));
      if (recommendationService.matchesCategory(p, category)) score += 10;
      if (skinKeywords.some(k => text.includes(k))) score += 5;
      if (concernKeywords.some(k => text.includes(k))) score += 3;
      return { ...p, _score: score };
    });
    return scored.sort((a, b) => b._score - a._score).slice(0, targetSize);
  },

  getSkinTypeKeywords(skinType) {
    const dict = { '건성': ['laser', 'barrier', '레이저', '패리어', '보습', '장벽', '재생', 'creme'], '지성': ['aquatica', '아쿠아티카', '수분', '산뜻', '젤'], '민감성': ['post', 'alpha', '포스트', '알파', '진정', '저자극'] };
    return dict[skinType] || [];
  },

  getConcernKeywords(concerns = []) {
    const dict = { '재생': ['repair', 'regeneration', 'laser'], '보습': ['moisturizing', 'hydration'], '진정': ['soothing', 'calming', 'cica'], '미백': ['brightening', 'toning'], '탄력': ['collagen', 'pdrn'] };
    let combined = []; (concerns || []).forEach(c => { combined = [...combined, ...(dict[c] || [])]; });
    return [...new Set(combined)];
  },

  matchesCategory(p, category) {
    if (!category) return true;
    const name = recommendationService.normalizeText(p.product_name);
    const map = { '선': ['선', '썬', 'sun', '스틱'], '앰플': ['앰플', '세럼', '에센스'], '토너': ['토너', '스킨', 'toner'], '크림': ['크림', '밤', 'cream'] };
    const keywords = map[category.slice(0, 2)] || [category];
    return keywords.some(k => name.includes(k));
  },

  getPersonalizedFallback(products, args) {
      return products.slice(0, 3).map(p => ({
          id: p.product_no,
          name: p.product_name,
          price: (parseInt(p.price) || 0).toLocaleString(),
          badges: ["BEST"],
          match_reasons: `${args.skin_type || '모든'} 피부 타입 추천 상품입니다.`,
          selection_strategy: "현재 시스템 점검 중으로 인기 제품을 제안합니다.",
          conclusion: "셀퓨전씨의 베스트셀러를 먼저 확인해 보세요!",
          thumbnail: p.thumbnail || p.list_image || ''
      }));
  }
};
