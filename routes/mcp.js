import { config } from '../config/env.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { recommendationService } from '../services/recommendationService.js';

/**
 * 🚀 [MCP Core] 전속 인텔리전트 툴 핸들러
 */
export const mcpHandler = async (request) => {
    const { name, arguments: args } = request.params;
    let result = { content: [] };

    try {
        console.log(`[MCP Tool Request] 🛠️ ${name} 가동...`);
        let accessToken = await tokenStore.getAccessToken(config.MALL_ID);
        
        // 1. 도구 실행 타임아웃 방어막 (25초 이상 걸리면 강제 응답)
        const toolTask = async () => {
            if (name === 'search_cafe24_real_products') {
                let categoryArg = (args.category || '').trim();
                let searchKeyword = categoryArg;

                // 지능형 키워드 매핑 (셀퓨전씨 특화)
                if (categoryArg.includes('선') || categoryArg.includes('썬')) searchKeyword = '썬';
                else if (categoryArg.includes('세럼') || categoryArg.includes('앰플')) searchKeyword = '앰플';
                else if (categoryArg.includes('토너') || categoryArg.includes('스킨')) searchKeyword = '토너';
                else if (categoryArg.includes('크림') || categoryArg.includes('로션')) searchKeyword = '크림';
                else if (categoryArg.includes('마스크') || categoryArg.includes('팩')) searchKeyword = '마스크';

                // 데이터 조회 (실시간 API + 메모리 하이브리드)
                const fetchLimit = searchKeyword ? 50 : 80;
                let response = await cafe24ApiService.getProducts(accessToken, fetchLimit, searchKeyword);
                let products = response.products || [];

                if (products.length === 0) {
                    response = await cafe24ApiService.getProducts(accessToken, 50, ''); // 광역 조회
                    products = response.products || [];
                }

                // 🧠 AI 셀렉터 가동 (Top 3~5 추천)
                const topN = await recommendationService.scoreAndFilterProducts(products, args, 3);
                
                // 💎 [Premium Vertical UI] 생성
                const sanitize = (v) => (v || '').replace(/\r?\n|\r/g, ' ').trim();
                let preRendered = '\n\n---\n\n';
                
                topN.forEach((p, i) => {
                    const medal = ['🥇','🥈','🥉'][i] || '✨';
                    const dc = p.discount_rate > 0 ? `<span style="color:red;">(${p.discount_rate}%↓)</span> ` : '';
                    preRendered += `### ${medal} 추천: **${p.name}**\n\n`;
                    preRendered += `![상품](${p.thumbnail})\n\n`;
                    preRendered += `💰 **가격**: ${dc}**${p.price}원**\n\n`;
                    preRendered += `💡 **수석 큐레이터 팁**: ${sanitize(p.match_reasons)}\n\n`;
                    preRendered += `👉 [[🛒 공식몰 상품보기]](${p.product_url})\n\n---\n\n`;
                });

                return { 
                    content: [{ 
                        type: 'text', 
                        text: [
                            '======= [DISPLAY_START] =======',
                            '# 🏥 셀퓨전씨 AI 실시간 추천 리포트',
                            preRendered,
                            '======= [DISPLAY_END] =======',
                            '',
                            '======= [AI_RAW_DATA (FOR_INTERNAL_USE)] =======',
                            JSON.stringify(topN.map(p => ({ n: p.name, pr: p.price, reason: p.match_reasons })), null, 2),
                            '======= [DATA_END] =======',
                            '',
                            '※ 지침: DISPLAY 영역을 100% 그대로 답변 최상단에 출력하고, 그 뒤에만 요약 분석을 덧붙이세요.'
                        ].join('\n')
                    }]
                };
            }
            return { content: [{ type: 'text', text: "요청하신 도구를 찾을 수 없습니다." }] };
        };

        // 타임아웃 레이스 (25초)
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Timeout")), 25000)
        );

        result = await Promise.race([toolTask(), timeoutPromise]);

    } catch (error) {
        console.error(`[MCP Critical Fail]`, error.message);
        result = { content: [{ type: 'text', text: "죄송합니다. 서버 응답 지연으로 실시간 분석을 완료하지 못했습니다. 대신 셀퓨전씨 베스트 제품을 먼저 확인해보시겠어요?" }] };
    }

    return result;
};
