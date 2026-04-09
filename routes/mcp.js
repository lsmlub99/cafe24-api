import express from 'express';
import { config } from '../config/env.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { recommendationService } from '../services/recommendationService.js';
import fs from 'fs';
import path from 'path';

const router = express.Router();

let clientStream = null;

// [MCP-Apps 핵심 설정] 지피티 네이티브 위젯용 URI 및 리소스
const BASE_URL = 'https://cafe24-api.onrender.com';
const WIDGET_URI = "ui://widget/recommendation.html";

const RESOURCES = [
    {
        uri: WIDGET_URI,
        name: "CellFusionC AI Curation UI",
        description: "고급 상품 추천 및 피부 분석 결과를 시각화하는 리액트 위젯",
        mimeType: "text/html"
    }
];

const TOOLS = [
    {
        name: "search_cafe24_real_products",
        description: "[👑GEN-UI ENABLED] 사용자의 피부 고민을 분석하고 최적의 상품 리스트를 '네이티브 리액트 위젯'으로 출력합니다.",
        _meta: {
            "openai/outputTemplate": WIDGET_URI,
            ui: { resourceUri: WIDGET_URI }
        },
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

const CATEGORY_SYNONYM_MAP = {
    '선크림': '선크림', '썬크림': '선크림', '자외선': '선크림', '선케어': '선크림',
    '크림': '크림', '수분크림': '크림', '보습크림': '크림',
    '세럼': '세럼', '에센스': '세럼', '앰플': '세럼',
    '비비': '비비크림', '비비크림': '비비크림',
    '클렌징': '클렌징', '세안': '클렌징',
    '토너': '토너', '스킨': '토너',
    '마스크': '마스크팩', '팩': '마스크팩',
    '이너뷰티': '이너뷰티', '먹는': '이너뷰티',
    '베이비케어': '베이비케어', '아기': '베이비케어'
};

const sendToClient = (msg) => {
    if (clientStream && !clientStream.writableEnded) {
        clientStream.write(`event: message\n`);
        clientStream.write(`data: ${JSON.stringify(msg)}\n\n`);
    }
};

async function executeTool(name, args) {
    console.log(`[Tool Exec] 🛠️ ${name} 기동...`);
    const rawCat = (args.category || '').toLowerCase().trim();
    const standardCat = CATEGORY_SYNONYM_MAP[rawCat] || rawCat;
    const categoryNos = cafe24ApiService.getDynamicCategoryNos([standardCat]);
    
    let rawProducts = [];
    if (categoryNos.length > 0) {
        rawProducts = cafe24ApiService.getProductsFromCache({ categoryNos });
        if (rawProducts.length === 0) {
            rawProducts = cafe24ApiService.getProductsFromCache({ keyword: rawCat });
        }
    } else {
        rawProducts = cafe24ApiService.getProductsFromCache({ keyword: rawCat });
    }

    const result = await recommendationService.scoreAndFilterProducts(
        rawProducts,
        { ...args, category_aliases: [standardCat] },
        3
    );

    const { recommendations, summary } = result;
    if (!recommendations || recommendations.length === 0) {
        return { content: [{ type: "text", text: summary?.message || "해당 상품이 없습니다." }] };
    }

    return {
        content: [{ type: "text", text: "추천 결과를 위젯 리포트로 생성합니다." }],
        structuredContent: {
            recommendations: recommendations,
            summary: summary,
            strategy: summary?.strategy || "",
            conclusion: summary?.conclusion || ""
        },
        _meta: {
            "openai/outputTemplate": WIDGET_URI,
            ui: { resourceUri: WIDGET_URI }
        }
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
    
    console.log(`[MCP Inbound] 📥 Method: ${method} | ID: ${id}`);

    try {
        if (method === "initialize") {
            console.log(`[MCP Protocol] Initializing Handshake...`);
            sendToClient({ 
                jsonrpc: "2.0", id, 
                result: { 
                    protocolVersion: "2024-11-05", 
                    capabilities: { tools: {}, resources: { subscribe: true } }, 
                    serverInfo: { name: "cafe24-mcp-premium", version: "3.5.0" } 
                } 
            });
        } else if (method === "resources/list") {
            console.log(`[MCP Protocol] Listing Resources...`);
            sendToClient({ jsonrpc: "2.0", id, result: { resources: RESOURCES } });
        } else if (method === "resources/read") {
            console.log(`[MCP Protocol] 📢 Resource READ: ${params?.uri}`);
            if (params?.uri === WIDGET_URI) {
                const indexPath = path.join(process.cwd(), 'client/dist/index.html');
                let html = fs.readFileSync(indexPath, 'utf8');
                html = html.replace('<head>', `<head><script>window.__WIDGET_MODE__=true;</script>`);
                html = html.replace(/src="\//g, `src="${BASE_URL}/`).replace(/href="\//g, `href="${BASE_URL}/`);
                sendToClient({
                    jsonrpc: "2.0", id,
                    result: { contents: [{ uri: WIDGET_URI, mimeType: "text/html", text: html }] }
                });
                console.log(`[MCP Protocol] ✅ Widget HTML injected and sent.`);
            }
        } else if (method === "tools/list") {
            console.log(`[MCP Protocol] Listing Tools...`);
            sendToClient({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
        } else if (method === "tools/call") {
            console.log(`[MCP Protocol] 🚀 Calling Tool: ${params.name}`);
            const toolResult = await executeTool(params.name, params.arguments);
            const finalResult = {
                ...toolResult,
                data: toolResult.structuredContent,
                output: toolResult.structuredContent
            };
            sendToClient({ jsonrpc: "2.0", id, result: finalResult });
            console.log(`[MCP Protocol] ✅ Curation Result with multi-binding data sent.`);
        }
    } catch (e) {
        console.error('[MCP Error]', e);
        sendToClient({ jsonrpc: "2.0", id, error: { message: e.message } });
    }
});

export default router;
