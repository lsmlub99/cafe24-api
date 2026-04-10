import express from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { recommendationService } from '../services/recommendationService.js';

const router = express.Router();
let clientStream = null;

const DEFAULT_BASE_URL = 'https://cafe24-api.onrender.com';
const BASE_URL = (config.PUBLIC_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
const WIDGET_UI_URI = 'ui://widget/recommendation.html';
const WIDGET_HTTP_URI = `${BASE_URL}/ui/recommendation`;
const TOOL_NAME = 'search_cafe24_real_products';

const RESOURCES = [
  {
    uri: WIDGET_UI_URI,
    name: 'CellFusionC Recommendation Widget',
    description: '셀퓨전씨 추천 결과를 카드 UI로 렌더링합니다.',
    mimeType: 'text/html;profile=mcp-app',
    _meta: {
      'openai/widgetDescription': '추천 결과와 사용 팁을 카드 형태로 보여줍니다.',
      'openai/widgetPrefersBorder': true,
    },
  },
  {
    uri: WIDGET_HTTP_URI,
    name: 'CellFusionC Recommendation Widget (HTTP)',
    description: 'Fallback HTTP widget URI',
    mimeType: 'text/html;profile=mcp-app',
  },
];

const TOOLS = [
  {
    name: TOOL_NAME,
    description: '[GEN-UI] 사용자 피부 고민을 분석하고 상품을 추천합니다.',
    _meta: {
      // Keep HTTP alias for compatibility; ui.resourceUri remains canonical.
      'openai/outputTemplate': WIDGET_HTTP_URI,
      'openai/toolInvocation/invoking': '추천 조건을 분석 중입니다...',
      'openai/toolInvocation/invoked': '추천 결과 준비가 완료되었습니다.',
      ui: { resourceUri: WIDGET_UI_URI },
    },
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        skin_type: { type: 'string' },
        concerns: { type: 'array', items: { type: 'string' } },
      },
    },
  },
];

const CATEGORY_SYNONYM_MAP = {
  선크림: '선크림',
  썬크림: '선크림',
  자외선: '선크림',
  선케어: '선크림',
  크림: '크림',
  보습크림: '크림',
  수분크림: '크림',
  세럼: '세럼',
  에센스: '세럼',
  앰플: '세럼',
  비비: '비비크림',
  비비크림: '비비크림',
  클렌징: '클렌징',
  세안: '클렌징',
  토너: '토너',
  스킨: '토너',
  마스크: '마스크팩',
  팩: '마스크팩',
  이너뷰티: '이너뷰티',
};

const FORCED_LOOKUP = {
  선크림: ['선케어'],
  썬크림: ['선케어'],
  선스틱: ['선케어'],
  선스프레이: ['선케어'],
  선쿠션: ['선케어'],
};

function sendToClient(msg) {
  if (clientStream && !clientStream.writableEnded) {
    clientStream.write('event: message\n');
    clientStream.write(`data: ${JSON.stringify(msg)}\n\n`);
  }
}

function sendError(id, code, message, data = undefined) {
  sendToClient({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data ? { data } : {}),
    },
  });
}

function buildConsultText(recommendations, promotions = []) {
  const lines = [];
  lines.push(`지금 조건에서 1순위는 ${recommendations[0].name}입니다.`);
  lines.push('상시 판매 제품을 우선으로 추천드렸고, 행사 제품은 아래에 따로 정리해드렸어요.');
  lines.push('');

  recommendations.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.name} (${item.price}원)`);
    lines.push(`- 추천 이유: ${item.why_pick || item.key_point || '요청 조건에 맞춘 우선 선별'}`);
    lines.push(`- 사용 팁: ${item.usage_tip || '아침 기초 마지막 단계에서 충분량 도포'}`);
    lines.push(`- 참고: ${item.caution || '야외 활동 시 2~3시간 간격 덧바름 권장'}`);
    lines.push(`- 제품 링크: ${item.buy_url}`);
    lines.push('');
  });

  if (promotions.length > 0) {
    lines.push('행사 상품도 진행 중입니다.');
    promotions.forEach((item) => {
      lines.push(`- ${item.name} (${item.price}원): ${item.buy_url}`);
    });
  } else {
    lines.push('현재 확인된 별도 행사 상품은 없고, 위 상시 판매 제품 기준으로 추천드렸어요.');
  }

  return lines.join('\n');
}

async function executeTool(args = {}) {
  console.log(`[Tool Exec] ${TOOL_NAME} start`);

  const rawCat = String(args.category || '').toLowerCase().trim();
  const standardCat = CATEGORY_SYNONYM_MAP[rawCat] || rawCat;
  const lookupKeywords = FORCED_LOOKUP[standardCat] || [standardCat];
  const categoryNos = cafe24ApiService.getDynamicCategoryNos(lookupKeywords);

  let rawProducts = [];
  if (categoryNos.length > 0) {
    rawProducts = cafe24ApiService.getProductsFromCache({ categoryNos });
    if (rawProducts.length === 0) rawProducts = cafe24ApiService.getProductsFromCache({ keyword: rawCat });
  } else {
    rawProducts = cafe24ApiService.getProductsFromCache({ keyword: rawCat });
  }
  rawProducts = await cafe24ApiService.enrichProductsWithIngredientText(rawProducts, 12);

  const result = await recommendationService.scoreAndFilterProducts(
    rawProducts,
    {
      ...args,
      category_aliases: [standardCat],
      target_category_ids: categoryNos,
    },
    3
  );

  const { recommendations, promotions, summary } = result;
  if (!recommendations || recommendations.length === 0) {
    return { content: [{ type: 'text', text: summary?.message || '찾으시는 제품이 없습니다.' }] };
  }

  const consultText = buildConsultText(recommendations, promotions || []);

  return {
    content: [{ type: 'text', text: consultText }],
    structuredContent: {
      recommendations,
      promotions: promotions || [],
      summary,
      strategy: summary?.strategy || '',
      conclusion: summary?.conclusion || '',
    },
    _meta: {
      'openai/outputTemplate': WIDGET_HTTP_URI,
      widgetData: {
        recommendations,
        promotions: promotions || [],
        summary,
      },
      ui: { resourceUri: WIDGET_UI_URI },
    },
  };
}

router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.write('event: endpoint\ndata: /mcp/message\n\n');
  res.flushHeaders();

  clientStream = res;
  res.on('close', () => {
    if (clientStream === res) clientStream = null;
  });
});

router.post('/message', async (req, res) => {
  const { method, params, id } = req.body || {};
  res.status(202).send('Accepted');

  console.log(`[MCP Inbound] method=${method} id=${id}`);

  try {
    if (method === 'initialize') {
      sendToClient({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false },
          },
          serverInfo: { name: 'cafe24-api-genui', version: '4.1.0' },
        },
      });
      return;
    }

    if (method === 'notifications/initialized') {
      return;
    }

    if (method === 'resources/list') {
      sendToClient({ jsonrpc: '2.0', id, result: { resources: RESOURCES } });
      return;
    }

    if (method === 'resources/read') {
      const requestedUri = String(params?.uri || '');
      const normalized = requestedUri.split(/[?#]/)[0];
      const allowedUris = [WIDGET_UI_URI, WIDGET_HTTP_URI];
      if (!allowedUris.includes(normalized)) {
        sendError(id, -32602, `Unknown resource URI: ${requestedUri}`, { available: allowedUris });
        return;
      }

      const indexPath = path.join(process.cwd(), 'client/dist/index.html');
      if (!fs.existsSync(indexPath)) {
        sendError(id, -32000, `Widget build not found at ${indexPath}`);
        return;
      }

      let html = fs.readFileSync(indexPath, 'utf8');
      html = html.replace(
        '<head>',
        '<head><script>window.__WIDGET_MODE__=true;window.__MCP_WIDGET__=true;</script>'
      );
      html = html.replace(/src="\//g, `src="${BASE_URL}/`);
      html = html.replace(/href="\//g, `href="${BASE_URL}/`);

      sendToClient({
        jsonrpc: '2.0',
        id,
        result: {
          contents: [
            {
              uri: requestedUri,
              mimeType: 'text/html;profile=mcp-app',
              text: html,
            },
          ],
        },
      });
      return;
    }

    if (method === 'tools/list') {
      sendToClient({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      if (toolName !== TOOL_NAME) {
        sendError(id, -32601, `Tool not found: ${toolName}`);
        return;
      }

      const toolArgs = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const toolResult = await executeTool(toolArgs);
      const finalResult = { ...toolResult };

      if (toolResult.structuredContent) {
        finalResult.data = toolResult.structuredContent;
        finalResult.output = toolResult.structuredContent;
      }

      sendToClient({ jsonrpc: '2.0', id, result: finalResult });
      return;
    }

    sendError(id, -32601, `Method not found: ${method}`);
  } catch (e) {
    console.error('[MCP Error]', e);
    sendError(id, -32000, e.message);
  }
});

export default router;
