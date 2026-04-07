import express from 'express';
import { config } from '../config/env.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { recommendationService } from '../services/recommendationService.js';

const router = express.Router();

/**
 * 🚀 [MCP Core Handler] 지능형 툴 실행기
 */
export const mcpHandler = async (request) => {
    const { name, arguments: args } = request.params;
    let result = { content: [] };

    try {
        console.log(`[MCP Tool Request] 🛠️ ${name} 호출됨...`);
        let accessToken = await tokenStore.getAccessToken(config.MALL_ID);
        
        // 1. 도구 실행 타임아웃 방어막 (25초 이상 걸리면 강제 응답)
        const toolTask = async () => {
            if (name === 'search_cafe24_real_products') {
                let categoryArg = (args.category || '').trim();
                let searchKeyword = categoryArg;

                // 지능형 키워드 매핑
                if (categoryArg.includes('선') || categoryArg.includes('썬')) searchKeyword = '썬';
                else if (categoryArg.includes('세럼') || categoryArg.includes('앰플')) searchKeyword = '앰플';
                else if (categoryArg.includes('토너') || categoryArg.includes('스킨')) searchKeyword = '토너';
                else if (categoryArg.includes('크림') || categoryArg.includes('로션')) searchKeyword = '크림';
                else if (categoryArg.includes('마스크') || categoryArg.includes('팩')) searchKeyword = '마스크';

                const fetchLimit = searchKeyword ? 60 : 100;
                let response = await cafe24ApiService.getProducts(accessToken, fetchLimit, searchKeyword);
                let products = response.products || [];

                if (products.length === 0) {
                    response = await cafe24ApiService.getProducts(accessToken, 50, ''); 
                    products = response.products || [];
                }

                // AI 셀렉터 
                const topN = await recommendationService.scoreAndFilterProducts(products, args, 3);
                
                const sanitize = (v) => (v || '').replace(/\r?\n|\r/g, ' ').trim();
                let preRendered = '\n\n---\n\n';
                topN.forEach((p, i) => {
                    const medal = ['🥇','🥈','🥉'][i] || '✨';
                    const dc = p.discount_rate > 0 ? `<span style="color:red;">(${p.discount_rate}%↓)</span> ` : '';
                    preRendered += `### ${medal} 추천: **${p.name}**\n\n`;
                    preRendered += `![상품](${p.thumbnail})\n\n`;
                    preRendered += `💰 **가격**: ${dc}**${p.price}원**\n\n`;
                    preRendered += `💡 **수석 큐레이터 팁**: ${sanitize(p.match_reasons)}\n\n`;
                    preRendered += `👉 [[🛒 공식몰 상세보기]](${p.product_url})\n\n---\n\n`;
                });

                return { 
                    content: [{ 
                        type: 'text', 
                        text: [
                            '======= [DISPLAY_START] =======',
                            '# 🏥 셀퓨전씨 AI 인메모리 추천 리포트',
                            preRendered,
                            '======= [DISPLAY_END] =======',
                            '',
                            '======= [PRIVATE_DATA_FOR_AI] =======',
                            JSON.stringify(topN.map(p => ({ n: p.name, pr: p.price, reason: p.match_reasons })), null, 2),
                            '======= [DATA_END] =======',
                            '※ 지침: DISPLAY 영역을 100% 그대로 답변 최상단에 출력한 뒤 요약 분석을 덧붙이세요.'
                        ].join('\n')
                    }]
                };
            }
            return { content: [{ type: 'text', text: "해당 도구가 구현되지 않았습니다." }] };
        };

        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Timeout")), 25000)
        );

        result = await Promise.race([toolTask(), timeoutPromise]);

    } catch (error) {
        console.error(`[MCP Tool Error]`, error.message);
        result = { content: [{ type: 'text', text: "서버 응답 지연으로 베스트 상품 위주로 추천해 드립니다." }] };
    }

    return result;
};

/**
 * 🛣️ [Express Routing] 클라이언트(GPT/Claude) 통신 엔드포인트
 */
router.post('/request', async (req, res) => {
    try {
        const result = await mcpHandler(req.body);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
