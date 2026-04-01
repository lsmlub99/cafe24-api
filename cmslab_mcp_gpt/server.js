const express = require('express');
const fs = require('fs');

// products.json 파일에서 데이터 읽기 (서버 시작 시 1회 로드)
const products = JSON.parse(fs.readFileSync('products.json', 'utf8'));

// Express 앱 생성
const app = express();
app.use(express.json({ limit: '10mb' })); // JSON 파싱 한도 증가

// 검색 함수
function searchProducts({ skin_type, concerns, category, time_of_use }) {
  console.log('searchProducts called with:', { skin_type, concerns, category, time_of_use });
  // 입력 검증 및 안전 처리
  if (!skin_type || !category || !time_of_use) {
    throw new Error("필수 입력값이 누락되었습니다: skin_type, category, time_of_use");
  }
  if (!Array.isArray(concerns)) {
    concerns = []; // concerns가 없거나 배열이 아니면 빈 배열로 처리
  }

  // 각 제품에 대해 점수 계산
  const scoredProducts = products.map(product => {
    let score = 0;
    let reasons = [];

    // 피부 타입 일치: +2
    if (product.skin_types && product.skin_types.includes(skin_type)) {
      score += 2;
      reasons.push(`${skin_type} 피부 타입에 적합`);
    }

    // 관심사 일치: 각 관심사마다 +3
    concerns.forEach(concern => {
      if (product.concerns && product.concerns.includes(concern)) {
        score += 3;
        reasons.push(`${concern} 고민 해결`);
      }
    });

    // 카테고리 일치: +2
    if (product.category === category) {
      score += 2;
      reasons.push(`${category} 카테고리`);
    }

    // 사용 시간 일치: +1
    if (product.time_of_use && product.time_of_use.includes(time_of_use)) {
      score += 1;
      reasons.push(`${time_of_use} 사용 추천`);
    }

    // match_reason이 비면 기본 문구
    if (reasons.length === 0) {
      reasons.push("기본 추천 제품");
    }

    return {
      ...product,
      score,
      match_reason: reasons.join(', '),
    };
  });

  // score가 0 이하인 제품 제외
  const filteredProducts = scoredProducts.filter(p => p.score > 0);

  // 점수 높은 순으로 정렬하고 최대 3개 선택
  filteredProducts.sort((a, b) => b.score - a.score);
  const top3 = filteredProducts.slice(0, 3).map(p => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    price: p.price,
    match_reason: p.match_reason,
    url: p.url,
    score: p.score,
  }));

  return { products: top3 };
}

// 상세 정보 함수
function getProductDetail({ product_id }) {
  if (!product_id) {
    throw new Error("product_id가 필요합니다.");
  }

  const product = products.find(p => p.id === product_id);
  if (!product) {
    throw new Error(`제품 ID '${product_id}'을 찾을 수 없습니다.`);
  }
  return product;
}

// MCP 연결 관리
const mcpConnections = new Map();

// MCP SSE 엔드포인트
app.get('/mcp', (req, res) => {
  console.log('MCP SSE connection established');

  // SSE 헤더 설정
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control',
  });

  // 연결 ID 생성
  const connectionId = Date.now().toString();
  mcpConnections.set(connectionId, res);

  // 초기 연결 메시지
  res.write(`data: ${JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    method: 'connection/ready',
    params: {}
  })}\n\n`);

  // 연결 종료 처리
  req.on('close', () => {
    mcpConnections.delete(connectionId);
    console.log('MCP connection closed:', connectionId);
  });

  req.on('error', (err) => {
    console.error('MCP connection error:', err);
    mcpConnections.delete(connectionId);
  });
});

// MCP POST 엔드포인트 (JSON-RPC 요청 처리)
app.post('/mcp', (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  console.log('MCP request:', { method, params });

  try {
    let result;

    if (method === 'initialize') {
      result = {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'cmslab-mcp-server',
          version: '1.0.0'
        }
      };
    } else if (method === 'tools/list') {
      result = {
        tools: [
          {
            name: 'search_products',
            description: '피부 타입, 고민, 카테고리, 사용 시간에 따라 제품을 추천합니다.',
            inputSchema: {
              type: 'object',
              properties: {
                skin_type: { type: 'string', description: '피부 타입 (예: 민감성, 건성, 지성)' },
                concerns: { type: 'array', items: { type: 'string' }, description: '관심사 목록 (예: 붉은기, 건조함)' },
                category: { type: 'string', description: '제품 카테고리 (예: 세럼, 크림)' },
                time_of_use: { type: 'string', description: '사용 시간 (예: 아침, 저녁)' }
              },
              required: ['skin_type', 'category', 'time_of_use']
            }
          },
          {
            name: 'get_product_detail',
            description: '제품 ID로 상세 정보를 조회합니다.',
            inputSchema: {
              type: 'object',
              properties: {
                product_id: { type: 'string', description: '제품 ID' }
              },
              required: ['product_id']
            }
          }
        ]
      };
    } else if (method === 'tools/call') {
      const { name, arguments: args } = params;

      if (name === 'search_products') {
        result = { content: [{ type: 'text', text: JSON.stringify(searchProducts(args), null, 2) }] };
      } else if (name === 'get_product_detail') {
        result = { content: [{ type: 'text', text: JSON.stringify(getProductDetail(args), null, 2) }] };
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
    } else {
      throw new Error(`Unknown method: ${method}`);
    }

    // SSE 연결이 있으면 결과 전송
    for (const [connId, connRes] of mcpConnections) {
      connRes.write(`data: ${JSON.stringify({
        jsonrpc: '2.0',
        id,
        result
      })}\n\n`);
    }

    // HTTP 응답
    res.json({
      jsonrpc: '2.0',
      id,
      result
    });

  } catch (error) {
    console.error('MCP error:', error.message);

    const errorResponse = {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: error.message
      }
    };

    // SSE 연결이 있으면 에러 전송
    for (const [connId, connRes] of mcpConnections) {
      connRes.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
    }

    // HTTP 응답
    res.json(errorResponse);
  }
});

// API 엔드포인트 (기존 REST API 유지)
app.post('/search_products', (req, res) => {
  try {
    console.log('Received search request:', req.body);
    const result = searchProducts(req.body);
    console.log('Search result:', result);
    res.json(result);
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.post('/get_product_detail', (req, res) => {
  try {
    const result = getProductDetail(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Health check 엔드포인트
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Product Recommendation Server is running' });
});

// 서버 시작
const PORT = process.env.PORT || 3002;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`제품 추천 서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`API 엔드포인트: http://localhost:${PORT}`);
    console.log(`MCP 엔드포인트: http://localhost:${PORT}/mcp`);
  });
}

// 함수 export (테스트용)
module.exports = { searchProducts, getProductDetail };
