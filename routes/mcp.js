import express from 'express';
import { config } from '../config/env.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { recommendationService } from '../services/recommendationService.js';
import { aiTaggingService } from '../services/aiTaggingService.js';

const router = express.Router();

let clientStream = null;

const CATEGORY_ALIAS_MAP = {
  '세럼': ['세럼', '앰플', 'serum', 'ampoule'],
  '앰플': ['앰플', '세럼', 'ampoule', 'serum'],
  '선크림': ['선크림', '선세럼', '썬', '선', 'sunscreen', 'sun'],
  '크림': ['크림', 'cream', '밤', 'balm'],
  '토너': ['토너', '스킨', 'toner', '패드']
};

const TOOLS = [
    {
        name: "search_cafe24_real_products",
        description: "피부 타입, 고민, 카테고리에 맞는 셀퓨전씨 실제 상품을 실시간 분석 및 추천합니다.",
        inputSchema: {
            type: "object",
            properties: {
                category: { type: "string" },
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

    const rawCat = args.category || '';
    const aliases = CATEGORY_ALIAS_MAP[rawCat] || [rawCat];
    const searchKeyword = aliases[0];
    
    // 🎯 Cafe24 상품 조회
    const response = await cafe24ApiService.getProducts(accessToken, 80, searchKeyword);
    const rawProducts = response.products || [];

    // 🎯 상품 정규화 및 AI 태깅 병합
    let candidates = rawProducts.map(p => recommendationService.normalizeProduct(p));
    const taggingResults = await aiTaggingService.tagProducts(candidates);
    const tagMap = new Map(taggingResults.map(t => [String(t.no), t]));
    
    const enrichedProducts = candidates.map(p => {
        const meta = tagMap.get(String(p.id)) || {};
        return recommendationService.normalizeProduct(p, meta);
    });

    // 🎯 💡 기획자 요청: 11.7 Engine (복합 피부타입 & 카드 UX 최적화)
    const scoringArgs = { ...args, category_aliases: aliases };
    const { recommendations, summary } = await recommendationService.scoreAndFilterProducts(enrichedProducts, scoringArgs, 3);
    
    const top1 = recommendations[0] || { name: "추천 상품", price: "0" };
    const rest = recommendations.slice(1);

    // 🏆 [Card Header]
    const header = [
        '---',
        `📋 **전략** : ${summary.strategy || "피부 맞춤형 최적 분석입니다."}`,
        `🎯 **결론** : ${summary.conclusion || "검증된 솔루션을 선별했습니다."}`,
        '---'
    ].join('\n');

    // 🏆 [Main Spotlight Card]
    const img1 = top1.thumbnail || "https://cellfusionc.co.kr/web/upload/common/no_img.gif";
    let spotlight = `### 🏆 **${top1.name}**\n`;
    spotlight += `![상품](${img1})\n\n`;
    spotlight += `💰 **판매가: ${top1.price}원**\n`;
    spotlight += `✨ **핵심 태그**: ${(top1.ai_tags || []).slice(0, 3).map(b => `\`#${b}\``).join(' ')}\n`;
    spotlight += `🧪 **큐레이션**: *"${top1.match_reasons}"*\n\n`;
    spotlight += `[**🚀 공식몰 혜택받고 구매하기**](https://cellfusionc.co.kr/product/detail.html?product_no=${top1.id})\n\n`;

    // 🥈🥉 [Comparison Table]
    let restTable = "";
    if (rest.length > 0) {
        let r1 = '| **다음 순위** |', r2 = '| :---: |', r3 = '| **이미지** |', r4 = '| **상세** |';
        rest.forEach((p, i) => {
            const medal = ['🥈 2위','🥉 3위'][i] || '✨ PICK';
            const buyUrl = `https://cellfusionc.co.kr/product/detail.html?product_no=${p.id}`;
            const img = p.thumbnail || "https://cellfusionc.co.kr/web/upload/common/no_img.gif";
            r1 += ` ${medal} |`; r2 += ` :---: |`; r3 += ` [![상품](${img})](${buyUrl}) |`; r4 += ` [**구매**](${buyUrl}) |`;
        });
        restTable = `### 📋 다른 추천 상품\n${r1}\n${r2}\n${r3}\n${r4}\n`;
    }

    return {
        content: [{
            type: "text",
            text: [header, '', spotlight, '---', restTable, '※ 본 루틴은 실시간 데이터 분석을 기반으로 제안되었습니다.'].join('\n')
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
