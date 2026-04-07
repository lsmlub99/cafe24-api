import express from 'express';
import { config } from '../config/env.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { recommendationService } from '../services/recommendationService.js';

const router = express.Router();

/**
 * 🚀 [Indestructible MCP SSE Core] 
 * 외부 SDK 없이 순수 익스프레스로 구현한 진짜 MCP 전송 엔진
 */

let sseResponse = null; // AI가 대답을 기다리는 전용 통로 (SSE Stream)

const TOOLS = [
  {
    name: "search_cafe24_real_products",
    description: "사용자의 피부 타입, 고민, 카테고리에 맞는 셀퓨전씨 실제 상품을 AI가 실시간 분석하여 추천합니다.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "찾는 카테고리 (예: 선크림, 토너, 앰플)" },
        skin_type: { type: "string", description: "피부 타입 (예: 지성, 건성)" },
        concerns: { type: "array", items: { type: "string" }, description: "피부 고민 목록" },
        count: { type: "number", description: "추천 개수" }
      }
    }
  }
];

// AI에게 보낼 메시지를 전용 통로(SSE)로 쏴주는 함수
const sendToAI = (message) => {
    if (sseResponse) {
        console.log(`[MCP SSE 📡] 대답 전송 중... (ID: ${message.id})`);
        sseResponse.write(`data: ${JSON.stringify(message)}\n\n`);
    } else {
        console.error("[MCP SSE 🚫] 전송 통로가 닫혀있습니다.");
    }
};

// 실시간 AI 분석 로직
const runner = async (name, args) => {
    let accessToken = await tokenStore.getAccessToken(config.MALL_ID);
    let categoryArg = (args.category || '').trim();
    let searchKeyword = categoryArg;

    if (categoryArg.includes('선') || categoryArg.includes('썬')) searchKeyword = '썬';
    else if (categoryArg.includes('앰플') || categoryArg.includes('세럼')) searchKeyword = '앰플';
    else if (categoryArg.includes('토너') || categoryArg.includes('스킨')) searchKeyword = '토너';
    else if (categoryArg.includes('크림') || categoryArg.includes('로션')) searchKeyword = '크림';

    let response = await cafe24ApiService.getProducts(accessToken, 60, searchKeyword);
    let products = response.products || [];
    if (products.length === 0) {
        response = await cafe24ApiService.getProducts(accessToken, 80, '');
        products = response.products || [];
    }

    // 💎 [High-End Luxury UI 3.0] 절대 깨지지 않는 프리미엄 카드 레이아웃
    const sanitize = (v) => (v || '').replace(/\r?\n|\r/g, ' ').trim();

    let preRendered = '\n\n';
    topN.forEach((p, i) => {
        const medal = ['👑 BEST 1','🥈 SECOND','🥉 THIRD'][i] || '✨ PICK';
        const discountLabel = p.discount_rate > 0 ? `🔥 **HOT ${p.discount_rate}% OFF**` : '✨ **NEW ARRIVAL**';
        
        preRendered += `> ### ${medal} | **${p.name}**\n`;
        preRendered += `> ${discountLabel}\n`;
        preRendered += `> ![상품](${p.thumbnail})\n`;
        preRendered += `> \n`;
        preRendered += `> 💰 **판매가: ${p.price}원** (정가 대비 최고 혜택)\n`;
        preRendered += `> 📝 **큐레이터 분석**: *"${sanitize(p.match_reasons)}"* \n`;
        preRendered += `> \n`;
        preRendered += `> [**🚀 지금 바로 구매하기 (공식몰 이동)**](https://cellfusionc.co.kr/product/detail.html?product_no=${p.id})\n\n`;
        preRendered += `---\n\n`;
    });

    return {
        content: [{
            type: "text",
            text: [
                '수석 큐레이터가 엄선한 [셀퓨전씨 실시간 AI 추천 리포트]입니다.',
                '',
                '[[START_UI]]',
                preRendered,
                '[[END_UI]]',
                '',
                '※ 필독 지침: 위 [[START_UI]]와 [[END_UI]] 사이의 "카드형 레이아웃"을 단 한 글자도 수정하지 말고 답변 최상단에 그대로 출력하십시오. (이미지 주소 및 링크 절대 보존)',
                '그 뒤에 아래 데이터를 참고하여 "🧪 수석 큐레이터의 추가 분석"을 덧붙이십시오.',
                '',
                '===== [분석 데이터] =====',
                JSON.stringify(topN.map(p => ({ 상품명: p.name, 혜택: p.discount_rate + '%', 분석: p.match_reasons })), null, 2)
            ].join('\n')
        }]
    };
};

/**
 * 🛣️ [Express Router] MCP SSE Interface
 */
// 1. [GET /mcp] AI가 처음으로 손 잡는 통로 (SSE Stream)
router.get('/', (req, res) => {
    console.log("[MCP SSE 🟢] AI 연결 성공!");
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`event: endpoint\ndata: /mcp/message\n\n`); // 필수: 메시지 수신처 안내
    res.flushHeaders();
    sseResponse = res; // 전용 통로 보관
});

// 2. [POST /mcp/message] AI가 명령어를 던질 때 처리 (JSON-RPC 2.0)
router.post('/message', async (req, res) => {
    const { jsonrpc, method, params, id } = req.body;
    console.log(`[MCP Message 📩] ${method} (id: ${id})`);

    // 즉시 응답 (MCP 규약: POST는 202나 200 반환 후 답장은 SSE로)
    res.status(202).send('Accepted');

    if (method === "initialize") {
        sendToAI({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "cafe24-api", version: "1.0.0" } } });
    } else if (method === "tools/list") {
        sendToAI({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    } else if (method === "tools/call") {
        try {
            const toolResult = await Promise.race([
                runner(params.name, params.arguments),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 25000))
            ]);
            sendToAI({ jsonrpc: "2.0", id, result: toolResult });
        } catch (e) {
            sendToAI({ jsonrpc: "2.0", id, error: { message: "추천 서버 지연" } });
        }
    }
});

export default router;
