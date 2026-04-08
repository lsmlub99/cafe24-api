import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * 👑 [Master-Class Recommendation Engine 5.0]
 * 브랜드 정책 준수와 최고의 UX를 위해 설계된 고성능 AI 엔진입니다.
 */
export const recommendationService = {
  
  async scoreAndFilterProducts(products, args, limit = 5) {
    if (!products || products.length === 0) return [];

    console.log(`[AI Engine] 🔍 ${args.skin_type || '전체'} 대상 정밀 큐레이션 가동...`);

    // 1. 데이터 전처리 (입력 제한 및 품질 확보)
    const simplifiedList = products.map(p => ({
      no: p.product_no,
      name: p.product_name,
      tags: p.ai_tags || [],
      desc: p.summary_description || p.simple_description || ''
    }));

    const userProfile = `
      [큐레이션 대상]
      - 피부타입: ${args.skin_type} / 고민: ${(args.concerns || []).join(', ')}
      - 카테고리: ${args.category}
    `;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini", // 속도와 효율을 위해 고속 모델 사용
        messages: [
          {
            role: "system",
            content: `너는 "셀퓨전씨(CellFusionC) 기술 수석 큐레이터"야. 아래 [분석 가이드라인]에 따라 100개 중 최적의 5개를 엄선해.

            [브랜드 시리즈 가이드]
            - Aquatica: 수분, 쿨링, 지성/수부지 전용
            - Post Alpha: 진정, 민감성 전용
            - Barrier/Laser: 고보습, 장벽강화, 건성 전용 (지성 추천 금지)
            - Toning: 미백, 잡티케어
            
            [출력 규칙]
            1. selection_strategy: 피부타입 + 고민 + 선별 기준을 포함한 자연스러운 한 줄 요약
            2. conclusion: 전체 추천 상품 중 1순위 제품을 고른 이유와 함께 제시 (예: 건성+재생 기준 1순위는 X예요)
            3. results[].badges: 상품의 핵심 장점 2~3개 (예: "보습 집중", "민감성 적합")
            4. texture_note & caution: 반드시 데이터(tags, desc)에 근거할 것. 추정/환각 금지. 없을 경우 빈값.

            {
              "summary": { "selection_strategy": "", "conclusion": "" },
              "results": [{
                "no": "",
                "fit_score": "High/Medium",
                "badges": ["보습", "진정"],
                "texture_note": "가벼운 젤 / 리치한 크림 등",
                "curator_comment": "사용자 맞춤 조언",
                "caution": "주의사항 또는 팁 (없으면 빈값)"
              }]
            }`
          },
          {
            role: "user",
            content: `${userProfile}\n\n[상품 리스트]\n${JSON.stringify(simplifiedList)}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      const aiResults = parsed.results || [];

      // 🛡️ [Brand Guardrail Pipe] 코드 레벨 후처리
      let finalRecommendations = aiResults.map(res => {
          const p = products.find(prod => String(prod.product_no) === String(res.no));
          if (!p) return null;

          // 1단계: 카테고리 검증 (요청 카테고리와 현격히 다를 경우 필터링)
          if (args.category && !p.product_name.includes(args.category.slice(0, 2)) && products.length > 30) {
              return null; 
          }

          const retail = parseInt(p.retail_price) || 0;
          const current = parseInt(p.price) || 0;
          const discount = retail > current ? Math.round(((retail - current) / retail) * 100) : 0;

          return {
              id: p.product_no,
              name: p.product_name,
              price: current.toLocaleString(),
              discount_rate: discount,
              thumbnail: (() => {
                  let img = p.list_image || p.detail_image || p.tiny_image;
                  if (!img) return 'https://dummyimage.com/180x180/eef2f3/555555.png';
                  if (img.startsWith('//')) img = `https:${img}`;
                  return img.replace('http://', 'https://');
              })(),
              fit_score: res.fit_score || "Medium",
              badges: res.badges || [],
              texture_note: res.texture_note || "",
              match_reasons: res.curator_comment || "추천 상품입니다.",
              caution: (res.caution && res.caution !== "없음" && res.caution !== "빈값") ? res.caution : "",
              selection_strategy: parsed.summary?.selection_strategy || "",
              conclusion: parsed.summary?.conclusion || ""
          };
      }).filter(Boolean);

      // 2단계: 다양성 및 시퀀스 보정 (동일 라인/유사 SKU 과다 노출 시 절삭)
      const seenNames = new Set();
      finalRecommendations = finalRecommendations.filter(p => {
          const baseName = p.name.split(' ')[0]; // 앞단어 기준 유사성 판단
          if (seenNames.has(baseName)) return false;
          seenNames.add(baseName);
          return true;
      }).slice(0, limit);

      // 3단계: 피부타입별 강제 가이드라인 체크 (건성인데 Laser/Barrier가 1개도 없으면 베스트셀러라도 강제 삽입 로직 등 가능)

      return finalRecommendations.length > 0 ? finalRecommendations : this.getPersonalizedFallback(products, args);

    } catch (error) {
      console.error("[AI Engine Error]:", error.message);
      return this.getPersonalizedFallback(products, args);
    }
  },

  /**
   * 🛡️ [Personalized Fallback]
   * 에러 시에도 사용자의 피부타입별 대표 라인을 반환하여 전문성 유지
   */
  getPersonalizedFallback(products, args) {
      console.log(`[Fallback] ⚠️ ${args.skin_type} 기준 개인화된 베스트셀러 매칭`);
      let filtered = products;
      if (args.skin_type === '건성') filtered = products.filter(p => p.product_name.includes('레이저') || p.product_name.includes('패리어'));
      if (args.skin_type === '지성' || args.skin_type === '수부지') filtered = products.filter(p => p.product_name.includes('아쿠아티카'));

      const targets = filtered.length > 0 ? filtered : products;
      return targets.slice(0, 3).map(p => ({
          id: p.product_no,
          name: p.product_name,
          price: (parseInt(p.price) || 0).toLocaleString(),
          match_reasons: `${args.skin_type} 피부에 가장 사랑받는 셀퓨전씨 베스트셀러 제품입니다.`,
          selection_strategy: `${args.skin_type} 피부 타입을 고려한 가장 안전한 선택지를 제안합니다.`
      }));
  }
};
