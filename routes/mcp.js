import express from 'express';
import { tokenStore } from '../stores/tokenStore.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
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
            description: '사용자의 피부 고민과 일치하는 셀퓨전씨 실제 판매 상품을 카페24 API에서 라이브로 검색하여 추천합니다.',
            inputSchema: {
              type: 'object',
              properties: {
                skin_type: { type: 'string', description: '요청받은 피부 타입 (예: 건성, 지성, 민감성 등)' },
                concerns: { type: 'array', items: { type: 'string' }, description: '고객의 피부 고민들 (예: 수분, 진정, 트러블, 커버 등)' },
                category: { type: 'string', description: '원하는 카테고리 종류 (예: 비비, 크림, 앰플, 클렌징)' }
              },
              required: [] // 모든 필드는 상황에 따라 선택적으로 입력
            }
          }
        ]
      };
      
    } else if (method === 'tools/call') {
      const { name, arguments: args } = params;

      if (name === 'search_cafe24_real_products') {
        const accessToken = await tokenStore.getAccessToken(config.MALL_ID);
        if (!accessToken) {
            throw new Error("카페24 접근 토큰이 만료되었거나 DB에 없습니다. 시스템 관리자 인증이 우선 필요합니다.");
        }
        
        // 카페24 API에서 최신 상품 100개를 불러와 넓은 범위에서 검색
        console.log("[MCP] 상품 추천 도구 가동 - 카페24 API에서 실시간 조회 처리 중...");
        const response = await cafe24ApiService.getProducts(accessToken, 100);
        const products = response.products || [];

        const { skin_type, concerns = [], category } = args;
        
        // 실시간 상품 채점 로직 (태그, 상품명, 상세 설명 텍스트를 모두 통합해서 AI가 준 키워드 포함 여부 판별)
        const scoredProducts = products.map(p => {
            let score = 0;
            let reasons = [];
            
            // 검색 대상 텍스트 압축
            const searchTarget = [
                p.product_name, 
                p.summary_description, 
                ...(Array.isArray(p.product_tag) ? p.product_tag : [])
            ].join(' ').toLowerCase();

            // 1. 카테고리 일치검사 (비중 높음)
            if (category && searchTarget.includes(category.toLowerCase())) {
                score += 3;
                reasons.push(`[${category}] 카테고리 매칭`);
            }

            // 2. 피부타입 일치검사
            if (skin_type && searchTarget.includes(skin_type.toLowerCase())) {
                score += 2;
                reasons.push(`${skin_type} 피부 타입 적합`);
            }
            
            // 3. 솔루션(고민) 일치검사
            concerns.forEach(c => {
                if (c && searchTarget.includes(c.toLowerCase())) {
                    score += 2;
                    reasons.push(`'${c}' 고민 해결 도움`);
                }
            });

            // 4. 품절 시 추천 제외 페널티
            if (p.sold_out === 'T' || p.selling === 'F') {
                score -= 10; 
                reasons.push(`현재 품절/미판매 상태`);
            }

            // 키워드 매칭은 안 됐지만 품절도 아니면 기본 추천점수 부여
            if (reasons.length === 0 && score === 0 && p.sold_out === 'F') {
               score += 0.5;
               reasons.push("셀퓨전씨 추천 베스트 상품");
            }

            return {
                id: p.product_no,
                name: p.product_name,
                price: `${parseInt(p.price)}원`,
                product_url: `https://cellfusionc.co.kr/product/detail.html?product_no=${p.product_no}`,
                thumbnail: p.list_image,
                tags: p.product_tag,
                score,
                match_reasons: reasons.join(', ') || '정보 없음'
            };
        });

        // 점수 기준 내림차순 정렬 후 양수 점수품목만 최대 3개 추출
        const validProducts = scoredProducts.filter(p => p.score > 0);
        validProducts.sort((a, b) => b.score - a.score);
        const top3 = validProducts.slice(0, 3);
        
        result = { 
            content: [{ 
                type: 'text', 
                text: JSON.stringify({ 
                    ai_notice: `[최고급 쇼핑몰 UI 출력 지시사항] 당신은 셀퓨전씨 VIP 뷰티 큐레이터입니다. 추천 결과를 출력할 때는 '반드시' 아래의 마크다운 표(Table) 양식을 사용하여, 롯데시네마나 쿠팡처럼 상품들이 가로로 나란히(UI 카드 형태로) 한눈에 쏙 들어오게 배치하세요. 매우 중요합니다! 단순 텍스트 나열은 금지합니다.

[카드형 마크다운 테이블 템플릿 예시]
| 🥇 1순위 | 🥈 2순위 | 🥉 3순위 |
|:---:|:---:|:---:|
| <a href="상품url"><img src="thumbnail주소" width="180"></a> | <a href="상품url"><img src="thumbnail주소" width="180"></a> | <a href="상품url"><img src="thumbnail주소" width="180"></a> |
| **[상품명1](상품url)** | **[상품명2](상품url)** | **[상품명3](상품url)** |
| **💳 가격1** | **💳 가격2** | **💳 가격3** |
| 💡 매칭이유1 | 💡 매칭이유2 | 💡 매칭이유3 |
| [🛒 구매하기](상품url) | [🛒 구매하기](상품url) | [🛒 구매하기](상품url) |

이 양식을 절대적으로 엄수하여 표를 그리세요. 데이터가 3개면 가로 3칸, 2개면 가로 2칸으로 작성합니다. 이미지가 화면을 가리지 않도록 반드시 HTML img 태그의 width 속성(예: width="180")을 유지해야 합니다. 표 아래에는 종합적인 추천 코멘트 한두 줄만 짧게 덧붙여 마무리하세요.`,
                    recommendations: top3 
                }, null, 2) 
            }] 
        };

      } else {
        throw new Error(`Unknown tool requested: ${name}`);
      }
    } else {
      throw new Error(`Unsupported MCP method: ${method}`);
    }

    // 존재하는 모든 SSE 연결 채널에 결과 브로드캐스팅 (실시간 AI 통신)
    for (const [connId, connRes] of mcpConnections) {
      connRes.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`);
    }

    // 일반 HTTP POST 응답 반환
    res.json({ jsonrpc: '2.0', id, result });

  } catch (error) {
    console.error('[MCP Error]:', error.message);
    const errorResponse = { jsonrpc: '2.0', id, error: { code: -32603, message: error.message } };
    
    for (const [connId, connRes] of mcpConnections) {
      connRes.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
    }
    res.json(errorResponse);
  }
});

export default router;
