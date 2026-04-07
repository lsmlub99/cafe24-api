import express from 'express';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from '../config/env.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { recommendationService } from '../services/recommendationService.js';

const router = express.Router();

/**
 * 🚀 [MCP SDK Server] - 진짜 AI 도구 서버 가동
 */
const server = new Server(
  { name: "cafe24-mcp-server", version: "2.1.0" },
  { capabilities: { tools: {} } }
);

let transport = null;

// 1. [List Tools] AI에게 사용 가능한 도구 목록을 알려줍니다.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_cafe24_real_products",
      description: "사용자의 피부 타입, 고민, 카테고리에 맞는 셀퓨전씨 실제 상품을 AI가 실시간 분석하여 추천합니다.",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string", description: "찾는 카테고리 (예: 선크림, 토너, 앰플, 세럼)" },
          skin_type: { type: "string", description: "사용자 피부 타입 (예: 지성, 건성, 수부지)" },
          concerns: { type: "array", items: { type: "string" }, description: "피부 고민 목록 (예: 수분, 진정, 트러블)" },
          count: { type: "number", description: "추천 개수 (1-5)" }
        }
      }
    }
  ]
}));

// 2. [Call Tool] AI가 실제 도구를 실행했을 때의 로직 (타임아웃 & 카드 UI 포함)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "search_cafe24_real_products") {
    try {
      let accessToken = await tokenStore.getAccessToken(config.MALL_ID);
      
      const toolTask = async () => {
        let categoryArg = (args.category || '').trim();
        let searchKeyword = categoryArg;

        // 지능형 키워드 맵핑
        if (categoryArg.includes('선') || categoryArg.includes('썬')) searchKeyword = '썬';
        else if (categoryArg.includes('앰플') || categoryArg.includes('세럼')) searchKeyword = '앰플';
        else if (categoryArg.includes('토너') || categoryArg.includes('스킨')) searchKeyword = '토너';
        else if (categoryArg.includes('크림') || categoryArg.includes('로션')) searchKeyword = '크림';

        // 데이터 확보
        let response = await cafe24ApiService.getProducts(accessToken, 60, searchKeyword);
        let products = response.products || [];
        if (products.length === 0) {
            response = await cafe24ApiService.getProducts(accessToken, 80, '');
            products = response.products || [];
        }

        // AI 셀렉터 선정
        const topN = await recommendationService.scoreAndFilterProducts(products, args, 3);
        const sanitize = (v) => (v || '').replace(/\r?\n|\r/g, ' ').trim();

        // 💎 Premium Vertical Card UI 생성
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

        const slimData = topN.map(p => ({ n: p.name, pr: p.price, re: p.match_reasons }));

        return {
          content: [{
            type: "text",
            text: [
                '======= [DISPLAY_START] =======',
                '# 🏥 셀퓨전씨 AI 실시간 추천 리포트',
                preRendered,
                '======= [DISPLAY_END] =======',
                '',
                '※ 지침: DISPLAY 영역을 100% 그대로 복사하여 답변 최상단에 출력하고, 아래의 분석 데이터를 바탕으로 큐레이터 멘트를 덧붙여 마무리하십시오.',
                JSON.stringify(slimData, null, 2)
            ].join('\n')
          }]
        };
      };

      // 타임아웃 보호 (20초)
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 20000));
      return await Promise.race([toolTask(), timeoutPromise]);

    } catch (error) {
      console.error("[Tool Call Error]", error.message);
      return { content: [{ type: "text", text: "잠시 후 다시 시도해 주세요. (추천 엔진 로딩 중)" }] };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

/**
 * 🛣️ [SSE Router] - 클라이언트(Claude)와의 실시간 통신 연결
 */
router.get("/", async (req, res) => {
    console.log("[MCP SSE] 🟢 새로운 연결 시도...");
    transport = new SSEServerTransport("/mcp/message", res);
    await server.connect(transport);
});

router.post("/message", async (req, res) => {
    if (transport) {
        console.log("[MCP Message] 📩 요청 수신");
        await transport.handlePostMessage(req, res);
    } else {
        res.status(400).send("No transport initialized.");
    }
});

export default router;
