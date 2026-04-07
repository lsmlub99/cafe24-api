import express from 'express';
import { tokenStore } from '../stores/tokenStore.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { cafe24AuthService } from '../services/cafe24AuthService.js';
import { recommendationService } from '../services/recommendationService.js';
import { config } from '../config/env.js';

const router = express.Router();

/**
 * [통합 MCP 서버] AI 플러그인용 SSE 및 JSON-RPC 연결 상태 관리
 */
const mcpConnections = new Map();

// 1. MCP SSE (Server-Sent Events) 연결 유지 엔드포인트
router.get('/', (req, res) => {
  console.log('[MCP] AI 에이전트 SSE 연결 수립');
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const connectionId = Date.now().toString();
  mcpConnections.set(connectionId, res);

  res.write(`data: ${JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    method: 'connection/ready',
    params: {}
  })}\n\n`);

  req.on('close', () => {
    mcpConnections.delete(connectionId);
    console.log('[MCP] AI 에이전트 연동 종료:', connectionId);
  });
});

// 2. MCP JSON-RPC 명령어 수신 및 실행
router.post('/', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;
  
  try {
    let result;

    if (method === 'initialize') {
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'CellFusionC-Cafe24-MCP', version: '2.0.0' }
      };
      
    } else if (method === 'tools/list') {
      result = {
        tools: [
          {
            name: 'search_cafe24_real_products',
            description: '사용자의 피부 고민이나 원하는 카테고리(세럼, 크림 등)에 맞춰 셀퓨전씨 실제 판매 상품을 라이브로 검색합니다.',
            inputSchema: {
              type: 'object',
              properties: {
                skin_type: { type: 'string', description: '피부 타입' },
                concerns: { type: 'array', items: { type: 'string' }, description: '피부 고민' },
                category: { type: 'string', description: '원하는 카테고리 (세럼, 크림 등)' },
                count: { type: 'number', description: '추천 개수' }
              },
              required: []
            }
          },
          {
            name: 'get_bestseller_ranking',
            description: '실시간 베스트셀러 랭킹을 가져옵니다.',
            inputSchema: {
              type: 'object',
              properties: {
                count: { type: 'number', description: '랭킹 개수' }
              },
              required: []
            }
          }
        ]
      };
      
    } else if (method === 'tools/call') {
      const { name, arguments: args } = params;

      if (name === 'search_cafe24_real_products') {
        const mallId = config.MALL_ID;
        let accessToken = await tokenStore.getAccessToken(mallId);
        
        // 🕒 [능동적 고속 갱신] 401 에러 나기 5분 전 미리 갱신 서비스
        if (await tokenStore.isExpired(mallId)) {
            console.log("[MCP] 🕒 토큰 만료 임박(5분 전) 감지. 선제적 갱신을 시작합니다.");
            const tokens = await tokenStore.getTokens(mallId);
            if (tokens.refreshToken) {
                try {
                    const tokenData = await cafe24AuthService.refreshAccessToken(tokens.refreshToken);
                    await tokenStore.saveTokens(mallId, tokenData.access_token, tokenData.refresh_token, tokenData.expires_at);
                    accessToken = tokenData.access_token;
                    console.log("[MCP] ✅ 능동적 토큰 갱신 성공 (401 대기 시간 0초)");
                } catch (refreshErr) {
                    console.error("[MCP] ❌ 능동적 갱신 실패, 401 폴백 대기 중...", refreshErr.message);
                }
            }
        }

        if (!accessToken) throw new Error("토큰이 없습니다. /cafe24/start 로 재인증 하십시오.");
        
        let response;
        try {
            // 🔍 [검색어 지능형 확장 & 정규화] 
            // '선제품' → '썬', '크림류' → '크림' 등 핵심어만 추출해 검색 성공률 극대화
            let categoryArg = (args.category || '').trim();
            let searchKeyword = categoryArg;
            
            // 핵심 키워드 매핑 (셀퓨전씨 상품명 DB 맞춤형)
            if (categoryArg.includes('선') || categoryArg.includes('썬') || categoryArg.includes('UV')) {
                searchKeyword = '썬';
                if (categoryArg.includes('스틱')) searchKeyword = '스틱'; // '선스틱' -> '스틱'으로 검색 (더 정확함)
            } else if (categoryArg.includes('세럼') || categoryArg.includes('앰플')) {
                searchKeyword = '세럼'; 
            } else if (categoryArg.includes('토너') || categoryArg.includes('스킨')) {
                searchKeyword = '토너';
            } else {
                // '제품', '류', '종류' 등의 접미사 제거 (예: 크림제품 -> 크림)
                searchKeyword = categoryArg.replace(/(제품|류|종류|타입|관련)$/, '');
            }

            const fetchLimit = searchKeyword ? 80 : 100;
            console.log(`[MCP] 지능형 하이브리드 조회 - 원본: '${categoryArg}' -> 변환: '${searchKeyword}' (${fetchLimit}개)`);
            response = await cafe24ApiService.getProducts(accessToken, fetchLimit, searchKeyword);

            if (!response.products || response.products.length === 0) {
                console.log("[MCP] ⚠️ 키워드 결과 없음 -> 광역 조회로 자동 보정");
                response = await cafe24ApiService.getProducts(accessToken, 100, ''); 
            }
        } catch (apiError) {
            // [폴백 세이프티] 위 선제 갱신이 실패했거나 예상치 못한 이유로 401이 나면 한 번 더 갱신 시도
            if (apiError.status === 401) {
                console.log("[MCP] ⚠️ 401 감지 - 최종 갱신 시도 중...");
                const tokens = await tokenStore.getTokens(mallId);
                const tokenData = await cafe24AuthService.refreshAccessToken(tokens.refreshToken);
                await tokenStore.saveTokens(mallId, tokenData.access_token, tokenData.refresh_token, tokenData.expires_at);
                accessToken = tokenData.access_token;
                response = await cafe24ApiService.getProducts(accessToken, 100, '');
            } else {
                throw apiError;
            }
        }

        const products = response.products || [];
        const recommendCount = Math.min(args.count || 5, 10); 
        const topN = recommendationService.scoreAndFilterProducts(products, args, recommendCount);
        
        // 🚫 결과가 정말 하나도 없는 경우 대응
        if (topN.length === 0) {
            result = {
                content: [{
                    type: 'text',
                    text: "죄송합니다. 현재 조건(피부타입/고민)에 딱 맞는 제품을 찾지 못했습니다. 조금 더 넓은 범위의 추천을 원하시면 '인기 상품 보여줘'라고 말씀해 주세요."
                }]
            };
        } else {
            let preRendered = '';
            preRendered += '| ' + topN.map((_, i) => `${['🥇','🥈','🥉','🏅','🏅','🏅','🏅','🏅','🏅','🏅'][i]} **${i+1}순위**`).join(' | ') + ' |\n';
            preRendered += '| ' + topN.map(() => ':---:').join(' | ') + ' |\n';
            preRendered += '| ' + topN.map(p => `[![상품](${p.thumbnail})](${p.product_url})`).join(' | ') + ' |\n';
            preRendered += '| ' + topN.map(p => `**[${p.name.length > 20 ? p.name.substring(0, 18) + '..' : p.name}](${p.product_url})**`).join(' | ') + ' |\n';
            preRendered += '| ' + topN.map(p => {
                const discountTxt = p.discount_rate > 0 ? `<span style="color:red;">(${p.discount_rate}%↓)</span> ` : '';
                return `💳 ${discountTxt}**${p.price}원**<br>💡 ${p.match_reasons.split(',')[0]}`;
            }).join(' | ') + ' |\n';
            preRendered += '| ' + topN.map(p => `[🛒 구매하기](${p.product_url})`).join(' | ') + ' |\n';
            const getUpsell = (p) => p.upsell_options && p.upsell_options.length > 0 ? `[🎁 세트상품](${p.upsell_options[0].product_url})` : ' ' ;
            preRendered += '| ' + topN.map(p => getUpsell(p)).join(' | ') + ' |\n';

            // 🚀 [CTO 자문 반영] GPT에게 꼭 필요한 핵심 데이터 + 세일 정보 다이어트 버전
            const slimmedTopN = topN.map(p => ({
                name: p.name,
                price: p.price,
                sale: p.discount_rate > 0 ? `${p.discount_rate}% 파격 할인 중` : '정가 판매',
                reasons: p.match_reasons,
                summary: p.summary || '상세 정보 분석 중...'
            }));

            result = { 
                content: [{ 
                    type: 'text', 
                    text: [
                    '### 👤 [전속 수석 큐레이터 페르소나 매뉴얼]',
                    '1. 당신은 20년 경력의 셀퓨전씨 수석 메디컬 뷰티 큐레이터입니다.',
                    '2. [셀퓨전씨 공식 추천 테이블]을 최상단에 수정 없이 그대로 출력하십시오.',
                    '3. 그 뒤 [🧪 수석 큐레이터의 PICK 분석] 세션을 열어 상품당 딱 2줄씩 분석하십시오.',
                    '   - 특히 할인 정보(예: 15% 할인 등)가 있다면 분석에 적극적으로 언급하여 구매를 유도하세요.',
                    '   - 형식: "🧴 [순위] · [상품명] : [전문적 분석 & 세일 정보 포함 코멘트]"',
                    '',
                    '[셀퓨전씨 공식 추천 테이블]',
                    '✅ **셀퓨전씨 공식몰 실시간 판매 데이터 기반 맞춤 추천**',
                    '',
                    preRendered,
                    '',
                    '### 🧪 수석 큐레이터의 PICK 분석',
                    '위 테이블을 고정 출력한 후, 아래 데이터로 전문적인 상세 코멘트를 덧붙이세요.',
                    '',
                    '===== [추천 데이터: 세일 정보 포함] =====',
                    JSON.stringify(slimmedTopN, null, 2),
                    '===== [데이터 분석 완료] ====='
                    ].join('\n')
                }] 
            };
        }

      } else if (name === 'get_bestseller_ranking') {
        let accessToken = await tokenStore.getAccessToken(config.MALL_ID);
        const rankingCount = Math.min(args.count || 5, 10);
        let catResponse;
        try {
            catResponse = await cafe24ApiService.getCategoryProducts(accessToken, 47, rankingCount);
        } catch (apiError) {
            if (apiError.status === 401) {
                const tokens = await tokenStore.getTokens(config.MALL_ID);
                const tokenData = await cafe24AuthService.refreshAccessToken(tokens.refreshToken);
                await tokenStore.saveTokens(config.MALL_ID, tokenData.access_token, tokenData.refresh_token, tokenData.expires_at);
                accessToken = tokenData.access_token;
                catResponse = await cafe24ApiService.getCategoryProducts(accessToken, 47, rankingCount);
            } else {
                throw apiError;
            }
        }

        const productNos = (catResponse.products || []).map(p => p.product_no);
        
        // 🚫 [방어 로직] 랭킹 데이터가 없을 때 무한 대기 방지
        if (!productNos || productNos.length === 0) {
            result = { content: [{ type: 'text', text: "🏆 현재 실시간 베스트셀러 데이터가 집계 중입니다. 잠시 후 다시 시도해 주세요!" }] };
        } else {
            const detailUrl = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?product_no=${productNos.join(',')}&fields=product_no,product_name,price,list_image,detail_image,tiny_image,summary_description,product_tag,sold_out`;
            const detailRes = await fetch(detailUrl, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
            });
            const detailData = await detailRes.json();
            const rankedProducts = productNos.map(no => (detailData.products || []).find(p => p.product_no === no)).filter(Boolean);

            const rankItems = rankedProducts.map((p, i) => {
                let img = p.list_image || p.detail_image || p.tiny_image;
                if (!img) img = 'https://dummyimage.com/180x180/eef2f3/555555.png?text=CellFusionC';
                if (img.startsWith('//')) img = `https:${img}`;
                return img.replace('http://', 'https://');
            });

            let preRendered = '';
            preRendered += '| ' + rankedProducts.map((_, i) => `${['🥇','🥈','🥉','🏅','🏅','🏅','🏅','🏅','🏅','🏅'][i]} **${i+1}위**`).join(' | ') + ' |\n';
            preRendered += '| ' + rankedProducts.map(() => ':---:').join(' | ') + ' |\n';
            preRendered += '| ' + rankItems.map(url => `[![상품](${url})](#)`).join(' | ') + ' |\n';
            preRendered += '| ' + rankedProducts.map(p => `**[${p.product_name.length > 15 ? p.product_name.substring(0, 13) + '..' : p.product_name}](https://cellfusionc.co.kr/product/detail.html?product_no=${p.product_no})**`).join(' | ') + ' |\n';
            preRendered += '| ' + rankedProducts.map(p => `💳 **${parseInt(p.price).toLocaleString()}원**`).join(' | ') + ' |\n';
            preRendered += '| ' + rankedProducts.map(p => `[🛒 구매하기](https://cellfusionc.co.kr/product/detail.html?product_no=${p.product_no})`).join(' | ') + ' |\n';

            result = {
                content: [{
                    type: 'text',
                    text: [
                    '### 🏆 [셀퓨전씨 공식 베스트셀러 랭킹]',
                    '전문 랭킹 리포터 모드로 아래 테이블을 수정 없이 그대로 출력하십시오.',
                    '',
                    preRendered,
                    '',
                    '===== [데이터 분석 완료] ====='
                    ].join('\n')
                }]
            };
        }
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
    } else {
      throw new Error(`Unsupported method: ${method}`);
    }

    // 🏆 [최종 응답] 클라이언트에 결과 반환
    return res.json({ jsonrpc: '2.0', id, result });

  } catch (error) {
    console.error('[MCP Error]:', error.message);
    const errorResponse = { jsonrpc: '2.0', id, error: { code: -32603, message: error.message } };
    return res.json(errorResponse);
  }
});

export default router;
