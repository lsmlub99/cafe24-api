import express from 'express';
import { config } from '../config/env.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { recommendationService } from '../services/recommendationService.js';

const router = express.Router();

/**
 * 🚀 [Lightweight MCP Bridge] 
 * 외부 SDK 없이 순수 Express로 구현하는 AI 도구 엔진
 */

// 1. [도구 정의] AI가 인식할 수 있게 명확한 Schema를 정의합니다.
const TOOLS = [
  {
    name: "search_cafe24_real_products",
    description: "사용자의 피부 타입, 고민, 카테고리에 맞는 셀퓨전씨 실제 상품을 AI가 실시간 분석하여 추천합니다.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        skin_type: { type: "string" },
        concerns: { type: "array", items: { type: "string" } },
        count: { type: "number" }
      }
    }
  }
];

// 2. [도구 실행 로직] - 실시간 AI 분석기 (25초 타임아웃 레이스 포함)
const handleToolCall = async (name, args) => {
  if (name === "search_cafe24_real_products") {
    try {
      let accessToken = await tokenStore.getAccessToken(config.MALL_ID);
      
      const runner = async () => {
        let categoryArg = (args.category || '').trim();
        let searchKeyword = categoryArg;

        // 지능형 키워드 정문화 (셀퓨전씨 특화)
        if (categoryArg.includes('선') || categoryArg.includes('썬')) searchKeyword = '썬';
        else if (categoryArg.includes('앰플') || categoryArg.includes('세럼')) searchKeyword = '앰플';
        else if (categoryArg.includes('토너') || categoryArg.includes('스킨')) searchKeyword = '토너';
        else if (categoryArg.includes('크림') || categoryArg.includes('로션')) searchKeyword = '크림';

        // 1. 상품 리스트 확보
        let response = await cafe24ApiService.getProducts(accessToken, 60, searchKeyword);
        let products = response.products || [];
        if (products.length === 0) {
            response = await cafe24ApiService.getProducts(accessToken, 80, '');
            products = response.products || [];
        }

        // 2. AI 셀렉터 실시간 가동
        const topN = await recommendationService.scoreAndFilterProducts(products, args, 3);
        const sanitize = (v) => (v || '').replace(/\r?\n|\r/g, ' ').trim();

        // 3. 💎 Premium Vertical Card UI 생성 (절대 깨지지 않는 레이아웃)
        let preRendered = '\n\n---\n\n';
        topN.forEach((p, i) => {
            const medal = ['🥇','🥈','🥉'][i] || '✨';
            const dc = p.discount_rate > 0 ? `<span style="color:red;">(${p.discount_rate}%↓)</span> ` : '';
            preRendered += `### ${medal} 추천 상품: **${p.name}**\n\n`;
            preRendered += `![상품](${p.thumbnail})\n\n`;
            preRendered += `💰 **가격**: ${dc}**${p.price}원**\n\n`;
            preRendered += `💡 **큐레이터 팁**: ${sanitize(p.match_reasons)}\n\n`;
            preRendered += `👉 [[🛒 공식몰 상세보기]](${p.product_url})\n\n---\n\n`;
        });

        return {
          content: [{
            type: "text",
            text: [
                '======= [DISPLAY_START (COPY_ONLY)] =======',
                '# 🏥 셀퓨전씨 AI 실시간 추천 리포트',
                preRendered,
                '======= [DISPLAY_END] =======',
                '',
                '※ 지침: DISPLAY 영역을 100% 그대로 답변 최상단에 출력하고, 그 뒤에만 요약 분석을 덧붙여 마무리하십시오.',
                JSON.stringify(topN.map(p => ({ n: p.name, pr: p.price, re: p.match_reasons })), null, 2)
            ].join('\n')
          }]
        };
      };

      // 타임아웃 레이스 (25초)
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 25000));
      return await Promise.race([runner(), timeout]);

    } catch (error) {
      console.error("[Tool Error]", error.message);
      return { content: [{ type: "text", text: "잠시 후 다시 시도해 주세요. 시스템 응답이 지연되고 있습니다." }] };
    }
  }
  return { content: [{ type: "text", text: "알 수 없는 도구입니다." }] };
};

/**
 * 🛣️ [Express Interface] MCP Protocol Bridge
 */
router.get('/', (req, res) => {
    console.log("[MCP] SSE 연동 대기중 - 수동 테스트 가능");
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    
    // AI 연결 상태 유지...
    setInterval(() => res.write(':\n\n'), 15000);
});

router.post('/message', async (req, res) => {
    const { method, params, id } = req.body;
    console.log(`[MCP Message] ${method} (id: ${id}) 수신`);

    if (method === "tools/list") {
        return res.json({ id, result: { tools: TOOLS } });
    }

    if (method === "tools/call") {
        const result = await handleToolCall(params.name, params.arguments);
        return res.json({ id, result });
    }

    res.status(404).json({ id, error: { message: "Method not found" } });
});

export default router;
