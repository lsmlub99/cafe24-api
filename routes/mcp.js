import express from 'express';
import { config } from '../config/env.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { recommendationService } from '../services/recommendationService.js';

const router = express.Router();

let clientStream = null;

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

const sendToClient = (msg) => {
    if (clientStream && !clientStream.writableEnded) {
        clientStream.write(`event: message\n`);
        clientStream.write(`data: ${JSON.stringify(msg)}\n\n`);
    }
};

async function executeTool(name, args) {
    console.log(`[Tool Exec] 🛠️ ${name} 기동...`);
    let accessToken = await tokenStore.getAccessToken(config.MALL_ID);

    let cat = (args.category || '').trim();
    let keyword = cat;
    if (cat.includes('선') || cat.includes('썬')) keyword = '썬';
    else if (cat.includes('앰플') || cat.includes('세럼')) keyword = '앰플';

    const response = await cafe24ApiService.getProducts(accessToken, 80, keyword);
    const products = response.products || [];

    // 🎯 이제 recommendationService가 "진짜 정답"인 순위를 담아서 줍니다.
    const topN = await recommendationService.scoreAndFilterProducts(products, args, 3); // 개수는 3개 정도로 압축
    
    // 💎 [Logic-Driven UI] 생성
    const top1 = topN[0];
    const rest = topN.slice(1);
    const strategy = top1?.selection_strategy || "피부 타입별 정밀 매칭 분석 결과입니다.";
    const conclusion = top1?.conclusion || "가장 적합한 제품을 선별했습니다.";

    // 🏆 [Precision Spotlight Card]
    let spotlight = `### 🏆 1순위 추천 | **${top1.name}**\n`;
    spotlight += `![상품](${top1.thumbnail || ""})\n\n`;
    spotlight += `💰 **혜택가: ${top1.price}원**\n`;
    spotlight += `✨ **핵심 특징**: ${(top1.badges || []).map(b => `\`#${b}\``).join(' ')}\n`;
    spotlight += `🧪 **전문가 분석**: *"${top1.match_reasons}"*\n\n`;
    spotlight += `[**🚀 정품 구매하기**](https://cellfusionc.co.kr/product/detail.html?product_no=${top1.id})\n\n`;

    // 📊 [Rest Candidates]
    let restTable = "";
    if (rest.length > 0) {
        let r1 = '| **다음 순위** |', r2 = '| :---: |', r3 = '| **이미지** |', r4 = '| **상세** |';
        rest.forEach((p, i) => {
            const medal = ['🥈 2위','🥉 3위'][i] || '✨ PICK';
            const buyUrl = `https://cellfusionc.co.kr/product/detail.html?product_no=${p.id}`;
            r1 += ` ${medal} |`; r2 += ` :---: |`; r3 += ` [![상품](${p.thumbnail})](${buyUrl}) |`; r4 += ` [**구매**](${buyUrl}) |`;
        });
        restTable = `### 📋 다른 추천 상품\n${r1}\n${r2}\n${r3}\n${r4}\n`;
    }

    return {
        content: [{
            type: "text",
            text: [
                '---',
                `## 🏥 [AI 분석 전략] : ${strategy}`,
                `**🎯 한 줄 결론 : ${conclusion}**`,
                '---',
                '',
                spotlight,
                '---',
                restTable,
                '※ 셀퓨전씨 공식몰 데이터를 기반으로 분석된 전문가 추천 루틴입니다.'
            ].join('\n')
        }]
    };
}

router.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.write(`event: endpoint\ndata: /mcp/message\n\n`);
    res.flushHeaders();
    clientStream = res;
});

router.post('/message', async (req, res) => {
    const { jsonrpc, method, params, id } = req.body;
    res.status(202).send('Accepted');
    try {
        if (method === "initialize") {
            sendToClient({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "cafe24-mcp", version: "1.0.0" } } });
        } else if (method === "tools/list") {
            sendToClient({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
        } else if (method === "tools/call") {
            const toolResult = await executeTool(params.name, params.arguments);
            sendToClient({ jsonrpc: "2.0", id, result: toolResult });
        }
    } catch (e) {
        sendToClient({ jsonrpc: "2.0", id, error: { message: e.message } });
    }
});

export default router;
