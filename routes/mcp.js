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
            description: '사용자의 피부 고민(건성, 트러블 등)이나 원하는 카테고리(크림, 앰플 등)에 맞춰 셀퓨전씨 실제 판매 상품을 카페24 API에서 라이브로 검색하여 맞춤 추천합니다. 베스트셀러/랭킹/인기 순위를 묻는 질문에는 이 도구를 사용하지 마세요.',
            inputSchema: {
              type: 'object',
              properties: {
                skin_type: { type: 'string', description: '요청받은 피부 타입 (예: 건성, 지성, 민감성 등)' },
                concerns: { type: 'array', items: { type: 'string' }, description: '고객의 피부 고민들 (예: 수분, 진정, 트러블, 커버 등)' },
                category: { type: 'string', description: '원하는 카테고리 종류 (예: 비비, 크림, 앰플, 클렌징)' },
                count: { type: 'number', description: '사용자가 특별히 요청한 추천 개수. 특별한 언급이 없으면 3위까지. (예: 5위까지 보여줘 -> 5)' }
              },
              required: []
            }
          },
          {
            name: 'get_bestseller_ranking',
            description: '셀퓨전씨 공식몰의 실시간 베스트셀러 랭킹(인기 순위)을 가져옵니다. 사용자가 "잘 나가는 거 뭐야", "베스트 보여줘", "인기 순위", "랭킹", "요즘 뭐가 잘 팔려" 등 인기/판매 순위를 물어볼 때 반드시 이 도구를 사용하세요.',
            inputSchema: {
              type: 'object',
              properties: {
                count: { type: 'number', description: '보여줄 랭킹 개수. 기본 5개. (예: 3위까지만 -> 3, 10위까지 -> 10)' }
              },
              required: []
            }
          }
        ]
      };
      
    } else if (method === 'tools/call') {
      const { name, arguments: args } = params;

      if (name === 'search_cafe24_real_products') {
        let accessToken = await tokenStore.getAccessToken(config.MALL_ID);
        if (!accessToken) {
            throw new Error("카페24 접근 토큰이 만료되었거나 DB에 없습니다. 시스템 관리자 인증이 우선 필요합니다.");
        }
        
        let response;
        try {
            console.log("[MCP] 상품 추천 도구 가동 - 카페24 API 실시간 조회 중...");
            response = await cafe24ApiService.getProducts(accessToken, 100);
        } catch (apiError) {
            // [오류 자동 복구 로직] 만약 카페24에서 401(토큰 만료 Auth 오류)를 뱉으면 멈추지 않고 스마트하게 자동 재발급 진행
            if (apiError.status === 401) {
                console.log("[MCP] ⚠️ 엑세스 토큰 2시간 만료 감지(401). 자동 복구(Refresh Token)를 시도합니다...");
                const refreshToken = await tokenStore.getRefreshToken(config.MALL_ID);
                if (!refreshToken) throw new Error("리프레시 토큰이 소실되어 자동 연장이 불가합니다. 브라우저에서 서버주소/cafe24/start 로 재로그인 해주세요.");
                
                // 1. 카페24 측에 리프레시 토큰을 주고, 새 번호판(새 엑세스 토큰)을 발급받아옴
                const tokenData = await cafe24AuthService.refreshAccessToken(refreshToken);
                // 2. 받아온 새 토큰들을 MongoDB에 덮어씌워서 안전하게 저장
                await tokenStore.saveTokens(
                    config.MALL_ID, 
                    tokenData.access_token, 
                    tokenData.refresh_token, 
                    tokenData.expires_at
                );
                accessToken = tokenData.access_token;
                console.log("[MCP] ✅ 토큰 갱신 성공! 끊긴 접속을 잇고 다시 상품 조회를 이어갑니다!");
                
                // 3. 발급받은 빳빳한 새 토큰으로 튕겼던 상품 조회(API)를 실패 없이 재시도!
                response = await cafe24ApiService.getProducts(accessToken, 100);
            } else {
                throw apiError; // 만료 문제가 아닌 다른 에러(권한없음, 주소잘못됨 등)라면 위로 던져서 에러 메시지로 표출
            }
        }

        const products = response.products || [];

        // 🏆 [Service Layer 호출]: 지저분한 채점 알고리즘을 밖으로 빼고 단 한 줄로 깔끔하게 명령 위임
        // args.count가 있으면 그만큼(최대 5), 없으면 기본 3개
        const recommendCount = Math.min(args.count || 3, 5); 
        const topN = recommendationService.scoreAndFilterProducts(products, args, recommendCount);
        
        // 👉 [마스터피스] 3개 고정을 풀고 배열 길이에 따라 (3개~5개) 동적으로 늘어나는 마크다운 표 자동 생성
        let markdownTable = `✅ **본 추천은 셀퓨전씨 공식몰의 실시간 최신 판매 데이터를 바탕으로 분석된 100% 확실한 정보입니다.**\n\n`;
        
        // 헤더 동적 생성 (1순위, 2순위...)
        markdownTable += `| ${topN.map((_, i) => `${['🥇','🥈','🥉','🏅','🏅'][i]} ${i+1}순위 추천`).join(' | ')} |\n`;
        markdownTable += `| ${topN.map(() => `:---:`).join(' | ')} |\n`;
        
        // 아이템 출력 동적 생성
        markdownTable += `| ${topN.map(p => `[![상품명](${p.thumbnail})](${p.product_url})`).join(' | ')} |\n`;
        markdownTable += `| ${topN.map(p => `**[${p.name.replace(/\|/g, '')}](${p.product_url})**`).join(' | ')} |\n`;
        markdownTable += `| ${topN.map(p => `**💳 ${p.price}**`).join(' | ')} |\n`;
        markdownTable += `| ${topN.map(p => `💡 ${p.match_reasons.split(',')[0]}`).join(' | ')} |\n`;
        markdownTable += `| ${topN.map(p => `[🛒 즉시 구매하기](${p.product_url})`).join(' | ')} |\n`;
        
        // 1+1 업셀 링크 동적 생성
        const getUpsellLink = (p) => p && p.upsell_options && p.upsell_options.length > 0 ? `🎁 연관 혜택: [관련 세트상품 보기](${p.upsell_options[0].product_url})` : '🎁 (기획세트 없음)';
        markdownTable += `| ${topN.map(p => getUpsellLink(p)).join(' | ')} |\n\n`;

        result = { 
            content: [
                { 
                    type: 'text', 
                    text: `[시스템 핵심 통제/강제 사항]
당신은 셀퓨전씨의 VIP 뷰티 큐레이터입니다. 당신(LLM)이 표 양식을 제멋대로 일반 세로형 테이블로 무너뜨리는 것을 방지하기 위해, 백엔드 서버가 이미 디자인이 완벽하게 끝난 "완제품 마크다운 표"를 텍스트로 넘겨주었습니다.
당신은 아래의 [완성된 마크다운 표 기성품] 이라는 텍스트 블록 전체를 "단 한 글자도, 단 한 줄도 수정하지 말고 무조건 100% 완벽히 똑같이 복사해서 화면 가장 상단에 1빠따로 출력" 하세요! 絶対(절대)로 표 구조를 다시 만들거나 요약하지 마세요.

[완성된 마크다운 표 기성품] (이 부분을 가장 먼저 출력할 것)
${markdownTable}

[🧴 핵심 요약 코멘트] 영역 추가 지시사항
위의 표를 무사히 복붙해 띄웠다면, 그 아래쪽에 요약 코너를 만들어주세요. 같이 제공된 [JSON 원본 데이터]를 참고하여, 각각의 제품이 왜 고객에게 찰떡궁합인지 다정하고 경쾌한 말투로 **"무조건 딱 2줄 이내로 아주 짧고 임팩트 있게"** 핵심만 코멘트하세요. 장황하게 길게 설명하는 것을 엄격히 금지합니다. (고객이 읽다 지칩니다)

===== [AI가 상세 분석 코멘트를 작성할 때 참고할 JSON 원본 데이터] =====
${JSON.stringify({ recommendations: topN }, null, 2)}
===== [데이터 끝] =====`
                }
            ] 
        };

      } else if (name === 'get_bestseller_ranking') {
        // ====== [베스트셀러 랭킹 전용 파이프라인] ======
        // 카페24 공식몰 '베스트' 카테고리(47번)의 진열 순서를 그대로 가져옵니다.
        const BEST_CATEGORY_NO = 47;
        let accessToken = await tokenStore.getAccessToken(config.MALL_ID);
        if (!accessToken) {
            throw new Error("카페24 접근 토큰이 없습니다. 관리자 인증이 필요합니다.");
        }

        const rankingCount = Math.min(args.count || 5, 10);
        let catResponse;
        try {
            console.log(`[MCP] 🏆 베스트셀러 랭킹 조회 시작 (카테고리 ${BEST_CATEGORY_NO})`);
            catResponse = await cafe24ApiService.getCategoryProducts(accessToken, BEST_CATEGORY_NO, rankingCount);
        } catch (apiError) {
            if (apiError.status === 401) {
                console.log("[MCP] ⚠️ 토큰 만료 감지. 자동 갱신 시도...");
                const refreshToken = await tokenStore.getRefreshToken(config.MALL_ID);
                if (!refreshToken) throw new Error("리프레시 토큰 소실. /cafe24/start 재로그인 필요.");
                const tokenData = await cafe24AuthService.refreshAccessToken(refreshToken);
                await tokenStore.saveTokens(config.MALL_ID, tokenData.access_token, tokenData.refresh_token, tokenData.expires_at);
                accessToken = tokenData.access_token;
                catResponse = await cafe24ApiService.getCategoryProducts(accessToken, BEST_CATEGORY_NO, rankingCount);
            } else {
                throw apiError;
            }
        }

        // 카테고리 API는 product_no 목록만 반환하므로, 각 상품의 상세 정보를 가져와야 합니다.
        const productNos = (catResponse.products || []).map(p => p.product_no);
        if (productNos.length === 0) throw new Error("베스트 카테고리에 진열된 상품이 없습니다.");

        // 상품 번호들로 상세 정보 일괄 조회
        const detailUrl = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?product_no=${productNos.join(',')}&fields=product_no,product_name,price,list_image,detail_image,tiny_image,summary_description,product_tag,sold_out`;
        const detailRes = await fetch(detailUrl, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
        const detailData = await detailRes.json();
        const detailProducts = detailData.products || [];

        // 카테고리 진열 순서를 유지하면서 상세 정보를 매핑
        const rankedProducts = productNos.map(no => detailProducts.find(p => p.product_no === no)).filter(Boolean);

        // 랭킹 전용 마크다운 표 생성 (순서 = 쇼핑몰 공식 진열 순서 그대로!)
        const rankItems = rankedProducts.map((p, i) => {
            let img = p.list_image || p.detail_image || p.tiny_image;
            if (!img) img = 'https://dummyimage.com/180x180/e0e0e0/555555.png?text=No_Image';
            if (img.startsWith('//')) img = `https:${img}`;
            if (img.startsWith('http://')) img = img.replace('http://', 'https://');
            const url = `https://cellfusionc.co.kr/product/detail.html?product_no=${p.product_no}`;
            return { rank: i + 1, name: p.product_name, price: `${parseInt(p.price)}원`, thumbnail: img, product_url: url };
        });

        let markdownTable = `🏆 **셀퓨전씨 공식몰 실시간 베스트셀러 TOP ${rankItems.length} (공식 랭킹)**\n\n`;
        markdownTable += `| ${rankItems.map(r => `${['🥇','🥈','🥉','🏅','🏅','🏅','🏅','🏅','🏅','🏅'][r.rank-1]} ${r.rank}위`).join(' | ')} |\n`;
        markdownTable += `| ${rankItems.map(() => ':---:').join(' | ')} |\n`;
        markdownTable += `| ${rankItems.map(r => `[![${r.name}](${r.thumbnail})](${r.product_url})`).join(' | ')} |\n`;
        markdownTable += `| ${rankItems.map(r => `**[${r.name.replace(/\|/g, '')}](${r.product_url})**`).join(' | ')} |\n`;
        markdownTable += `| ${rankItems.map(r => `**💳 ${r.price}**`).join(' | ')} |\n`;
        markdownTable += `| ${rankItems.map(r => `[🛒 구매하기](${r.product_url})`).join(' | ')} |\n\n`;

        result = {
            content: [{
                type: 'text',
                text: `[시스템 핵심 통제/강제 사항]
당신은 셀퓨전씨 공식 랭킹 리포터입니다. 아래의 [완성된 마크다운 표]는 백엔드가 카페24 공식몰 베스트 카테고리의 "실제 진열 순서"를 그대로 가져와 만든 것입니다.
이 순서는 쇼핑몰 관리자가 직접 설정한 공식 랭킹이므로, 절대로 순서를 변경하거나 표를 재구성하지 마세요.
아래 표를 단 한 글자도 수정하지 말고 100% 그대로 복사하여 가장 먼저 출력하세요.

[완성된 마크다운 표 기성품]
${markdownTable}

[🧴 핵심 요약 코멘트] 영역
위 표를 그대로 출력한 후, 아래쪽에 "현재 셀퓨전씨 공식몰에서 가장 사랑받고 있는 TOP ${rankItems.length} 제품입니다" 라는 한 줄 요약 후, 각 제품에 대해 딱 1줄로 짧고 위트있게 왜 인기인지 코멘트하세요. 장황하게 길게 설명하는 것은 엄격히 금지합니다.

===== [참고 JSON 데이터] =====
${JSON.stringify({ ranking: rankItems }, null, 2)}
===== [데이터 끝] =====`
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
