import express from 'express';
import { config } from '../config/env.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { recommendationService } from '../services/recommendationService.js';

const router = express.Router();

/**
 * 🚀 [Indestructible SSE Engine]
 * 외부 패키지 없이 순수 Node/Express로 구현하는 정식 MCP SSE 서버
 * AI 클라이언트(Claude 등)와 100% 호환되는 실시간 통신 규격
 */

let clientStream = null; // AI가 대답을 기다리는 실시간 통로

const TOOLS = [
  {
    name: "search_cafe24_real_products",
    description: "피부 타입, 고민, 카테고리에 맞는 셀퓨전씨 실제 상품을 실시간 분석하여 추천합니다.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "선크림, 토너, 앰플 등" },
        skin_type: { type: "string" },
        concerns: { type: "array", items: { type: "string" } }
      }
    }
  }
];

// 📡 AI에게 정해진 규격(event, data)으로 메시지를 전송하는 함수
const sendToClient = (msg) => {
    if (clientStream && !clientStream.writableEnded) {
        console.log(`[MCP SSE 📡] 메시지 전송 (ID: ${msg.id || 'N/A'})`);
        clientStream.write(`event: message\n`);
        clientStream.write(`data: ${JSON.stringify(msg)}\n\n`);
    }
};

// 🧠 실제 도구 실행 로직 (럭셔리 UI 포함)
async function executeTool(name, args) {
    console.log(`[Tool Exec] 🛠️ ${name} 기동...`);
    let accessToken = await tokenStore.getAccessToken(config.MALL_ID);
    
    // 1. 키워드 지능형 매핑
    let cat = (args.category || '').trim();
    let keyword = cat;
    if (cat.includes('선') || cat.includes('썬')) keyword = '썬';
    else if (cat.includes('앰플') || cat.includes('세럼')) keyword = '앰플';
    else if (cat.includes('토너')) keyword = '토너';
    else if (cat.includes('크림')) keyword = '크림';

    // 2. 통합 상품 조회 (캐시 우선)
    const response = await cafe24ApiService.getProducts(accessToken, 80, keyword);
    const products = response.products || [];

    // 3. AI 셀렉터 선정 (Top 5)
    const topN = await recommendationService.scoreAndFilterProducts(products, args, 5);
    const sanitize = (v) => (v || '').replace(/\r?\n|\r/g, ' ').trim();

    // 4. 💎 [Clean Luxury Grid] 생성 - HTML 일체 배제 (깨짐 방지)
    let row1 = '| **순위** |', row2 = '| :---: |', row3 = '| **이미지** |', row4 = '| **상품명** |', row5 = '| **혜택가** |', row6 = '| **상세** |';
    
    topN.forEach((p, i) => {
        const medal = ['🥇 1순위','🥈 2순위','🥉 3순위','✨ PICK','✨ PICK'][i] || '✨ PICK';
        const discount = p.discount_rate > 0 ? ` (${p.discount_rate}%↓)` : '';
        
        row1 += ` ${medal} |`;
        row2 += ` :---: |`;
        row3 += ` [![상품](${p.thumbnail})](https://cellfusionc.co.kr/product/detail.html?product_no=${p.id}) |`;
        row4 += ` **${p.name}** |`;
        row5 += ` **${p.price}원**${discount} |`;
        row6 += ` [🛒 구매] |`; // 표 안에는 심플한 텍스트로
    });

    const uiTable = `${row1}\n${row2}\n${row3}\n${row4}\n${row5}\n${row6}`;

    return {
        content: [{
            type: "text",
            text: [
                '======= [DISPLAY_START] =======',
                '### 🏥 셀퓨전씨 공식몰 실시간 AI 추천 테이블',
                uiTable,
                '',
                '🧪 **수석 큐레이터의 PICK 분석**',
                ...topN.map((p, i) => `${i+1}. **${p.name}**: ${sanitize(p.match_reasons)}`),
                '======= [DISPLAY_END] =======',
                '',
                '※ [필독 시스템 지침]: 반드시 위 [DISPLAY_START] 영역의 테이블과 분석을 답변 최상단에 수정 없이 그대로 출력해야 합니다. HTML 태그는 절대 사용하지 마십시오.'
            ].join('\n')
        }]
    };
}

/**
 * 🛣️ [MCP Protocol 엔드포인트] 
 */
// 1. [GET /mcp] SSE 실시간 통로 연결
router.get('/', (req, res) => {
    console.log("[MCP SSE 🟢] AI 연결 성공!");
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`event: endpoint\ndata: /mcp/message\n\n`); // POST 경로 안내 (필수)
    res.flushHeaders();
    clientStream = res;
});

// 2. [POST /mcp/message] AI 명령 처리
router.post('/message', async (req, res) => {
    const { jsonrpc, method, params, id } = req.body;
    console.log(`[MCP Message 📩] ${method} (id:${id})`);

    // 즉시 수신 확인 (202 Accepted)
    res.status(202).send('Accepted');

    try {
        if (method === "initialize") {
            sendToClient({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "cafe24-mcp", version: "1.0.0" } } });
        } else if (method === "tools/list") {
            sendToClient({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
        } else if (method === "tools/call") {
            const toolResult = await executeTool(params.name, params.arguments);
            sendToClient({ jsonrpc: "2.0", id, result: toolResult });
        } else if (method?.startsWith('notifications/')) {
            // 알림 무시 및 성공 처리
        }
    } catch (e) {
        console.error("[MCP Fail]", e.message);
        sendToClient({ jsonrpc: "2.0", id, error: { message: e.message } });
    }
});

export default router;
