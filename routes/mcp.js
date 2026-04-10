import express from 'express';
import { config } from '../config/env.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { recommendationService } from '../services/recommendationService.js';
import fs from 'fs';
import path from 'path';

const router = express.Router();

let clientStream = null;

// [MCP-Apps 최종 설정] 가장 호환성 높은 HTTPS 기반 리소스 URI 사용
const DEFAULT_BASE_URL = 'https://cafe24-api.onrender.com';
const BASE_URL = (config.PUBLIC_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
const WIDGET_URI = `${BASE_URL}/ui/recommendation`;
const TOOL_NAME = 'search_cafe24_real_products';

const RESOURCES = [
    {
        uri: WIDGET_URI,
        name: "CellFusionC AI Curation UI",
        description: "고급 상품 추천 및 피부 분석 결과를 시각화하는 리액트 위젯",
        mimeType: "text/html",
        _meta: {
            "openai/widgetDescription": "CellFusionC 추천 결과를 카드 UI로 렌더링합니다.",
            "openai/widgetPrefersBorder": true
        }
    }
];

const TOOLS = [
    {
        name: TOOL_NAME,
        description: "[👑GEN-UI ENABLED] 사용자의 피부 고민을 분석하고 최적의 상품 리스트를 '네이티브 리액트 위젯'으로 출력합니다.",
        _meta: {
            "openai/outputTemplate": WIDGET_URI,
            "openai/toolInvocation/invoking": "추천 조건 분석 중...",
            "openai/toolInvocation/invoked": "추천 결과 준비 완료",
            "ui": { "resourceUri": WIDGET_URI }
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
    '이너뷰티': '이너뷰티', '먹는': '이너뷰티'
};

const sendToClient = (msg) => {
    if (clientStream && !clientStream.writableEnded) {
        clientStream.write(`event: message\n`);
        clientStream.write(`data: ${JSON.stringify(msg)}\n\n`);
    }
};

const sendError = (id, code, message, data = undefined) => {
    sendToClient({
        jsonrpc: "2.0",
        id,
        error: {
            code,
            message,
            ...(data ? { data } : {})
        }
    });
};

async function executeTool(name, args = {}) {
    console.log(`[Tool Exec] 🛠️ ${name} 기동...`);
    const rawCat = (args.category || '').toLowerCase().trim();
    const standardCat = CATEGORY_SYNONYM_MAP[rawCat] || rawCat;
    const forcedLookup = {
        '선크림': ['선케어'],
        '썬크림': ['선케어'],
        '선스틱': ['선스틱'],
        '선스프레이': ['선스프레이'],
        '선쿠션': ['선쿠션']
    };
    const lookupKeywords = forcedLookup[standardCat] || [standardCat];
    const categoryNos = cafe24ApiService.getDynamicCategoryNos(lookupKeywords);
    
    let rawProducts = [];
    if (categoryNos.length > 0) {
        rawProducts = cafe24ApiService.getProductsFromCache({ categoryNos });
        if (rawProducts.length === 0) {
            rawProducts = cafe24ApiService.getProductsFromCache({ keyword: rawCat });
        }
    } else {
        rawProducts = cafe24ApiService.getProductsFromCache({ keyword: rawCat });
    }
    rawProducts = await cafe24ApiService.enrichProductsWithIngredientText(rawProducts, 12);

    const result = await recommendationService.scoreAndFilterProducts(
        rawProducts,
        { 
            ...args, 
            category_aliases: [standardCat],
            target_category_ids: categoryNos // 🎯 실제 감지된 번호 탑재
        },
        3
    );

    const { recommendations, promotions, summary } = result;
    if (!recommendations || recommendations.length === 0) {
        return { content: [{ type: "text", text: summary?.message || "찾으시는 제품이 없습니다." }] };
    }

    const lines = [];
    lines.push(`가장 잘 맞는 1순위는 ${recommendations[0].name}입니다.`);
    lines.push('아래 추천은 일반(상시) 제품을 우선으로 골랐고, 제품별로 이유와 사용 팁을 함께 안내드립니다.');
    lines.push('');
    recommendations.forEach((item, idx) => {
        lines.push(`${idx + 1}. ${item.name} - ${item.price}원`);
        lines.push(`- 추천 이유: ${item.why_pick || item.key_point || '요청 조건 기반 선별'}`);
        lines.push(`- 사용 팁: ${item.usage_tip || '아침 기초 마지막 단계에서 충분량 도포'}`);
        lines.push(`- 참고: ${item.caution || '야외 활동 시 2-3시간 간격 덧바름 권장'}`);
        lines.push(`- 링크: ${item.buy_url}`);
        lines.push('');
    });

    if (Array.isArray(promotions) && promotions.length > 0) {
        lines.push('행사 상품도 별도로 진행 중입니다.');
        promotions.forEach((item) => {
            lines.push(`- ${item.name} (${item.price}원): ${item.buy_url}`);
        });
    }

    return {
        content: [{ type: "text", text: lines.join('\n') }],
        structuredContent: {
            recommendations: recommendations,
            promotions: promotions || [],
            summary: summary,
            strategy: summary?.strategy || "",
            conclusion: summary?.conclusion || ""
        },
        _meta: {
            "openai/outputTemplate": WIDGET_URI,
            "widgetData": {
                recommendations: recommendations,
                promotions: promotions || [],
                summary: summary
            },
            "ui": { "resourceUri": WIDGET_URI }
        }
    };
}

router.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.write(`event: endpoint\ndata: /mcp/message\n\n`);
    res.flushHeaders();
    clientStream = res;
    res.on('close', () => {
        if (clientStream === res) {
            clientStream = null;
        }
    });
});

router.post('/message', async (req, res) => {
    const { jsonrpc, method, params, id } = req.body;
    res.status(202).send('Accepted');
    
    console.log(`[MCP Inbound] 📥 Method: ${method} | ID: ${id}`);

    try {
        if (method === "initialize") {
            console.log(`[MCP Protocol] Handshake Refreshed!`);
            sendToClient({ 
                jsonrpc: "2.0", id, 
                result: { 
                    protocolVersion: "2024-11-05", 
                    capabilities: {
                        tools: { listChanged: false },
                        resources: { subscribe: false }
                    }, 
                    serverInfo: { name: "cafe24-api-genui", version: "4.0.0" } 
                } 
            });
        } else if (method === "notifications/initialized") {
            return;
        } else if (method === "resources/list") {
            console.log(`[MCP Protocol] Listing Resources...`);
            sendToClient({ jsonrpc: "2.0", id, result: { resources: RESOURCES } });
        } else if (method === "resources/read") {
            const requestedUri = params?.uri || "";
            console.log(`[MCP Protocol] 📢 Resource READ: ${requestedUri}`);
            
            // HTTPS 주소로 정확히 들어왔는지 체크
            if (requestedUri !== WIDGET_URI) {
                sendError(id, -32602, `Unknown resource URI: ${requestedUri}`, { available: [WIDGET_URI] });
                return;
            }

            const indexPath = path.join(process.cwd(), 'client/dist/index.html');
            if (!fs.existsSync(indexPath)) {
                sendError(id, -32000, `Widget build not found at ${indexPath}`);
                return;
            }
            let html = fs.readFileSync(indexPath, 'utf8');
            
            // Widget mode bootstrap and absolute asset path rewriting.
            html = html.replace(
                '<head>',
                '<head><script>window.__WIDGET_MODE__=true;window.__MCP_WIDGET__=true;</script>'
            );
            html = html.replace(/src="\//g, `src="${BASE_URL}/`);
            html = html.replace(/href="\//g, `href="${BASE_URL}/`);
            
            sendToClient({
                jsonrpc: "2.0", id,
                result: { contents: [{ uri: WIDGET_URI, mimeType: "text/html", text: html }] }
            });
            console.log(`[MCP Protocol] ✅ Final High-Fidelity HTML sent.`);
        } else if (method === "tools/list") {
            console.log(`[MCP Protocol] Listing Tools...`);
            sendToClient({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
        } else if (method === "tools/call") {
            console.log(`[MCP Protocol] 🚀 Executing with Hybrid Data Binding...`);
            const toolName = params?.name;
            if (toolName !== TOOL_NAME) {
                sendError(id, -32601, `Tool not found: ${toolName}`);
                return;
            }
            const toolArgs = params?.arguments && typeof params.arguments === 'object'
                ? params.arguments
                : {};
            const toolResult = await executeTool(toolName, toolArgs);
            
            // 모든 가능성 있는 필드에 데이터 주입
            const finalResult = { ...toolResult };
            if (toolResult.structuredContent) {
                finalResult.data = toolResult.structuredContent;
                finalResult.output = toolResult.structuredContent;
            }
            
            sendToClient({ jsonrpc: "2.0", id, result: finalResult });
            console.log(`[MCP Protocol] ✅ Result dispatched.`);
        } else {
            sendError(id, -32601, `Method not found: ${method}`);
        }
    } catch (e) {
        console.error('[MCP Error]', e);
        sendError(id, -32000, e.message);
    }
});

export default router;
