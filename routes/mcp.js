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
// 동의어 매핑 (지시서 2️⃣: 동의어는 룰로 처리)
const CATEGORY_SYNONYM_MAP = {
    '선크림': '선크림', '썬크림': '선크림', '자외선차단': '선크림', '선세럼': '선크림', 'sunscreen': '선크림', 'sun': '선크림', '선스틱': '선스틱', '썬스틱': '선스틱', '슥': '선스틱', '간편': '선스틱',
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
        description: "[⚠️SYSTEM-ONLY DATA] 피부 분석 결과(recommendations)를 전송합니다. AI 모델은 절대로 이 데이터의 상세 내용을 텍스트로 중복 설명하지 마십시오. 사용자에게는 오직 '시스템 카드를 확인하십시오'라는 취지의 짧은 안내만 하십시오. 상품 목록을 텍스트로 반복하는 행위는 심각한 시스템 중복 오류로 간주됩니다.",
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
    // ── Step 2: 캐시 필터링 (동적 ID 감지 적용) ──
    const categoryNos = cafe24ApiService.getDynamicCategoryNos([standardCat]);
    console.log(`[Category] 입력: '${rawCat}' → 표준: '${standardCat}' → 감지된 ID: [${categoryNos.join(',')}]`);

    let rawProducts = [];

    if (categoryNos.length > 0) {
        // category_no 기반 구조적 필터링
        rawProducts = cafe24ApiService.getProductsFromCache({ categoryNos });
        
        // 0건 시 키워드 폴백
        if (rawProducts.length === 0) {
            console.warn(`[Fallback] category_no ${categoryNos} → 0건. 키워드 '${rawCat}' 폴백 검색`);
            rawProducts = cafe24ApiService.getProductsFromCache({ keyword: rawCat });
        }
    } else {
        // 카테고리 매핑이 안 된 경우 키워드 검색
        rawProducts = cafe24ApiService.getProductsFromCache({ keyword: rawCat });
    }

    // ── Step 3: 룰베이스 점수 + 데이터 엔진 → 최종 결과 ──
    const categoryAliases = [standardCat];
    const { recommendations, summary } = await recommendationService.scoreAndFilterProducts(
        rawProducts,
        { ...args, category_aliases: categoryAliases },
        3
    );

    if (!recommendations || recommendations.length === 0) {
        return {
            content: [{ type: "text", text: "해당 조건에 맞는 상품을 찾을 수 없습니다." }]
        };
    }

    // 📦 [Pure Data Response]
    // AI의 잔소리를 방지하기 위해 텍스트는 최소화하고, 순수 데이터 배열(items)만 강조하여 반환
    return {
        content: [
            {
                type: "text",
                text: "피부 타입 분석 결과를 토대로 시스템 카드를 생성합니다."
            }
        ],
        recommendations: recommendations,
        items: recommendations, // 플랫폼 호환성을 위해 items 키 추가
        summary: summary
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
