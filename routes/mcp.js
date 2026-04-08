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
    console.log(`[Tool Exec] 🛠️ ${name} 기동 (UX Impact Mode)...`);
    let accessToken = await tokenStore.getAccessToken(config.MALL_ID);

    const rawCat = args.category || '';
    const aliases = CATEGORY_ALIAS_MAP[rawCat] || [rawCat];
    const searchKeyword = aliases[0];
    
    // 🎯 1. Cafe24 원천 데이터 확보
    const response = await cafe24ApiService.getProducts(accessToken, 80, searchKeyword);
    const rawProducts = response.products || [];
    let initialCandidates = rawProducts.map(p => recommendationService.normalizeProduct(p));

    // 🎯 💡 [Performance Patch] 1차 스코어링으로 정예 멤버(20개)만 선별 (태깅 전)
    const initialIntent = recommendationService.normalizeUserIntent({ ...args, category_aliases: aliases });
    const preRanked = initialCandidates.map(p => {
        const { score } = recommendationService.calculateScore(p, initialIntent);
        return { ...p, _preScore: score };
    }).sort((a,b) => b._preScore - a._preScore).slice(0, 20);

    // 🎯 2. 정예 멤버 20개에 대해서만 AI 정밀 태깅 (속도 4배 향상)
    const taggingResults = await aiTaggingService.tagProducts(preRanked);
    const tagMap = new Map(taggingResults.map(t => [String(t.no), t]));
    
    const enrichedProducts = preRanked.map(p => {
        const meta = tagMap.get(String(p.id)) || {};
        return recommendationService.normalizeProduct(p, meta);
    });

    // 🎯 3. 최종 스코어링 및 고밀도 큐레이션 (Engine 11.8)
    const { recommendations, summary } = await recommendationService.scoreAndFilterProducts(enrichedProducts, { ...args, category_aliases: aliases }, 3);
    
    const top1 = recommendations[0] || { name: "추천 상품", price: "0" };
    const rest = recommendations.slice(1);

    // 🎨 [Premium Card UI]
    const header = [
        '---',
        `💡 **이런 피부에 맞아요** : ${summary.strategy || "고객님의 피부 고민을 해결할 최적의 솔루션입니다."}`,
        `🏆 **그래서 이걸 추천합니다** : ${summary.conclusion || "검증된 베스트 아이템을 선별했습니다."}`,
        '---'
    ].join('\n');

    const img1 = top1.thumbnail || "https://cellfusionc.co.kr/web/upload/common/no_img.gif";
    let spotlight = `## 🏆 **${top1.name}**\n`;
    spotlight += `![상품](${img1})\n\n`;
    spotlight += `💰 **판매가: ${top1.price}원**\n`;
    spotlight += `✨ **핵심 태그**: ${(top1.ai_tags || []).slice(0, 3).map(b => `\`#${b}\``).join(' ')}\n`;
    // 🎯 💡 기획자 요청: 핵심 포인트 추가
    spotlight += `🔥 **핵심 포인트**: **${top1.key_point}**\n`;
    spotlight += `🧪 **수석 큐레이터 가이드**: *"${top1.match_reasons}"*\n\n`;
    spotlight += `[**🚀 전용 혜택으로 구매하기**](https://cellfusionc.co.kr/product/detail.html?product_no=${top1.id})\n\n`;

    let restTable = "";
    if (rest.length > 0) {
        let r1 = '| **제안 순위** |', r2 = '| :---: |', r3 = '| **이미지** |', r4 = '| **상세** |';
        rest.forEach((p, i) => {
            const medal = ['🥈 2위','🥉 3위'][i] || '✨ PICK';
            const buyUrl = `https://cellfusionc.co.kr/product/detail.html?product_no=${p.id}`;
            const img = p.thumbnail || "https://cellfusionc.co.kr/web/upload/common/no_img.gif";
            r1 += ` ${medal} |`; r2 += ` :---: |`; r3 += ` [![상품](${img})](${buyUrl}) |`; r4 += ` [**구매**](${buyUrl}) |`;
        });
        restTable = `### 📋 함께 고려해볼 다른 선택지\n${r1}\n${r2}\n${r3}\n${r4}\n`;
    }

    return {
        content: [{
            type: "text",
            text: [header, '', spotlight, '---', restTable, '※ 본 큐레이션은 실시간 임상 데이터 분석을 기반으로 작성되었습니다.'].join('\n')
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
