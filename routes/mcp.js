import express from 'express';
import { config } from '../config/env.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { recommendationService } from '../services/recommendationService.js';

const router = express.Router();

let clientStream = null;

// ══════════════════════════════════════════════════════════════
//  📌 카테고리 고유번호 매핑 (실제 Cafe24 관리자 기준 확정값)
//  - 이 번호로 캐시에서 category_no 기반 구조적 필터링을 수행합니다.
//  - 텍스트 검색에 의존하지 않으므로 오분류가 원천 차단됩니다.
// ══════════════════════════════════════════════════════════════
const CATEGORY_ID_MAP = {
    '선크림':   [29],   // 선케어
    '선케어':   [29],
    'bb크림':   [159],  // BB크림/베이스
    '비비크림': [159],
    '크림':     [49],   // 크림
    '세럼':     [58],   // 앰플/세럼
    '앰플':     [58],
    '마스크팩': [59],   // 마스크팩/패드
    '패드':     [59],
    '클렌징':   [30],   // 클렌징
    '토너':     [31],   // 토너
    '세트':     [60],   // 세트
    '이너뷰티': [145],  // 이너뷰티
    '베이비케어': [174] // 베이비케어
};

// 동의어 매핑 (지시서 2️⃣: 동의어는 룰로 처리)
const CATEGORY_SYNONYM_MAP = {
    '선크림': '선크림', '썬크림': '선크림', '자외선차단': '선크림', '선세럼': '선크림', 'sunscreen': '선크림', 'sun': '선크림',
    '크림': '크림', 'cream': '크림', '보습크림': '크림', '수분크림': '크림',
    '세럼': '세럼', '에센스': '세럼', 'serum': '세럼',
    '앰플': '앰플', 'ampoule': '앰플',
    '토너': '토너', '스킨': '토너', 'toner': '토너',
    '클렌징': '클렌징', '세안': '클렌징',
    '마스크팩': '마스크팩', '팩': '마스크팩', '패드': '패드',
    '비비크림': '비비크림', 'bb크림': '비비크림', 'bb': '비비크림',
    '세트': '세트', '기획세트': '세트',
    '이너뷰티': '이너뷰티',
    '베이비케어': '베이비케어', '아기': '베이비케어'
};

const TOOLS = [
    {
        name: "search_cafe24_real_products",
        description: "피부 타입, 고민, 카테고리에 맞는 셀퓨전씨 실제 상품을 분석 및 추천합니다.",
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

/**
 * 🎯 executeTool: 추천 파이프라인 실행
 * 
 * 흐름 (지시서 5️⃣ 준수):
 *   1. 사용자 입력에서 카테고리 동의어 → 표준 카테고리명 변환
 *   2. 표준 카테고리명 → category_no 매핑
 *   3. 캐시에서 category_no 기반 즉시 필터링 (실시간 API 호출 없음)
 *   4. recommendationService로 룰베이스 점수 계산 + AI 문구 생성
 *   5. 결과 반환
 */
async function executeTool(name, args) {
    console.log(`[Tool Exec] 🛠️ ${name} 기동...`);

    // ── Step 1: 카테고리 동의어 → 표준명 변환 ──
    const rawCat = (args.category || '').toLowerCase().trim();
    const standardCat = CATEGORY_SYNONYM_MAP[rawCat] || rawCat;
    const categoryNos = CATEGORY_ID_MAP[standardCat] || [];

    console.log(`[Category] 입력: '${rawCat}' → 표준: '${standardCat}' → ID: [${categoryNos.join(',')}]`);

    // ── Step 2: 캐시에서 즉시 필터링 (실시간 API 호출 절대 없음) ──
    let rawProducts = [];

    if (categoryNos.length > 0) {
        // category_no 기반 구조적 필터링 (가장 정확)
        rawProducts = cafe24ApiService.getProductsFromCache({ categoryNos });
        console.log(`[Cache Hit] category_no ${categoryNos.join(',')} → ${rawProducts.length}개 매칭`);
    } else {
        // 매핑되지 않은 카테고리는 키워드 폴백
        rawProducts = cafe24ApiService.getProductsFromCache({ keyword: rawCat });
        console.log(`[Cache Fallback] 키워드 '${rawCat}' → ${rawProducts.length}개 매칭`);
    }

    // ── Step 3: 룰베이스 점수 + AI 문구 → 최종 결과 ──
    const categoryAliases = [standardCat];
    const { recommendations, summary } = await recommendationService.scoreAndFilterProducts(
        rawProducts,
        { ...args, category_aliases: categoryAliases },
        3
    );

    // [Fast Verification Log]
    console.log(`[Verification] rawProducts: ${rawProducts.length}, Top3: ${recommendations.map(p => p.name).join(' | ')}`);
    console.log(`[Verification] shape: recommendations=${!!recommendations}, summary=${!!summary}`);
    if (recommendations.length > 0) {
        console.log(`[Verification] top1.key_point=${!!recommendations[0].key_point}, top1.ai_tags=${!!recommendations[0].ai_tags}`);
    }

    const top1 = recommendations[0];

    if (!top1) {
        return {
            content: [{ type: "text", text: "해당 조건에 맞는 상품을 찾을 수 없습니다." }]
        };
    }

    const rest = recommendations.slice(1);

    // 🎨 Premium Card UI 렌더링
    const header = [
        '---',
        `💡 **이런 피부에 맞아요** : ${summary.strategy || "고객님의 피부 고민 해결 솔루션"}`,
        `🏆 **그래서 이걸 추천합니다** : ${summary.conclusion || "검증된 베스트 아이템"}`,
        '---'
    ].join('\n');

    const img1 = top1.thumbnail || "https://cellfusionc.co.kr/web/upload/common/no_img.gif";
    let spotlight = `## 🏆 **${top1.name}**\n`;
    spotlight += `![상품](${img1})\n\n`;
    spotlight += `💰 **판매가: ${top1.price}원**\n`;
    spotlight += `✨ **핵심 태그**: ${(top1.ai_tags || []).slice(0, 3).map(b => `\`#${b}\``).join(' ')}\n`;
    spotlight += `🔥 **핵심 포인트**: **${top1.key_point}**\n`;
    spotlight += `🧪 **수석 큐레이터 가이드**: *"${top1.match_reasons}"*\n\n`;
    spotlight += `[**🚀 전용 혜택으로 구매하기**](https://cellfusionc.co.kr/product/detail.html?product_no=${top1.id})\n\n`;

    let restTable = "";
    if (rest.length > 0) {
        let r1 = '| **제안 순위** |', r2 = '| :---: |', r3 = '| **이미지** |', r4 = '| **상세** |';
        rest.forEach((p, i) => {
            const medal = ['🥈 2위', '🥉 3위'][i] || '✨ PICK';
            const buyUrl = `https://cellfusionc.co.kr/product/detail.html?product_no=${p.id}`;
            const img = p.thumbnail || "https://cellfusionc.co.kr/web/upload/common/no_img.gif";
            r1 += ` ${medal} |`; r2 += ` :---: |`; r3 += ` [![상품](${img})](${buyUrl}) |`; r4 += ` [**구매**](${buyUrl}) |`;
        });
        restTable = `### 📋 함께 고려해볼 다른 선택지\n${r1}\n${r2}\n${r3}\n${r4}\n`;
    }

    const markdownResult = [header, '', spotlight, '---', restTable, '※ 본 큐레이션은 실시간 임상 데이터 분석을 기반으로 작성되었습니다.'].join('\n');

    return {
        content: [{
            type: "text",
            text: markdownResult
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
            sendToClient({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "cafe24-mcp", version: "2.0.0" } } });
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
