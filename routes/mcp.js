import express from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { recommendationService } from '../services/recommendationService.js';

const router = express.Router();
let clientStream = null;

const DEFAULT_BASE_URL = 'https://cafe24-api.onrender.com';
const BASE_URL = (config.PUBLIC_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

const WIDGET_TEMPLATE_VERSION = 'v20260413';
const WIDGET_UI_URI = `ui://widget/recommendation-${WIDGET_TEMPLATE_VERSION}.html`;
const WIDGET_HTTP_URI = `${BASE_URL}/ui/recommendation`;
const TOOL_NAME = 'search_cafe24_real_products';
const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';

const RESOURCE_META = {
  ui: {
    prefersBorder: true,
    domain: BASE_URL,
    csp: {
      connectDomains: [BASE_URL],
      resourceDomains: [
        BASE_URL,
        'https://cellfusionc.co.kr',
        'https://img.cellfusionc.co.kr',
        'https://persistent.oaistatic.com',
      ],
    },
  },
  'openai/widgetDescription': 'CellFusionC recommendation cards',
  'openai/widgetPrefersBorder': true,
  'openai/widgetCSP': {
    connect_domains: [BASE_URL],
    resource_domains: [
      BASE_URL,
      'https://cellfusionc.co.kr',
      'https://img.cellfusionc.co.kr',
      'https://persistent.oaistatic.com',
    ],
    redirect_domains: ['https://cellfusionc.co.kr'],
  },
};

const RESOURCES = [
  {
    uri: WIDGET_UI_URI,
    name: 'CellFusionC Recommendation Widget',
    description: 'Interactive recommendation cards for CellFusionC products.',
    mimeType: RESOURCE_MIME_TYPE,
    _meta: RESOURCE_META,
  },
  {
    uri: WIDGET_HTTP_URI,
    name: 'CellFusionC Recommendation Widget (HTTP)',
    description: 'Fallback HTTP widget URI',
    mimeType: RESOURCE_MIME_TYPE,
    _meta: RESOURCE_META,
  },
];

const TOOLS = [
  {
    name: TOOL_NAME,
    title: 'Search CellFusionC Products',
    description: '[GEN-UI] Analyze skin needs and recommend matching products.',
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
    _meta: {
      ui: { resourceUri: WIDGET_UI_URI, visibility: ['model', 'app'] },
      'openai/outputTemplate': WIDGET_UI_URI,
      'openai/widgetAccessible': true,
      'openai/toolInvocation/invoking': 'Analyzing your skin needs...',
      'openai/toolInvocation/invoked': 'Recommendation results are ready.',
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
  } else {
    logger.warn('[MCP Stream] No active clientStream. Message not delivered via SSE.');
  }
}

function sendError(id, code, message, data = undefined) {
  sendToClient({
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data ? { data } : {}) },
  });
}

function buildConsultText(recommendations, promotions = []) {
  const lines = [];
  lines.push(`지금 조건 기준 1순위는 ${recommendations[0].name} 입니다.`);
  lines.push('상세 링크는 위젯 카드의 "지금 구매하기" 버튼에서 바로 열 수 있어요.');
  lines.push('');

  recommendations.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.name} (${item.price}원)`);
    lines.push(`- 추천 이유: ${item.why_pick || item.key_point || '요청 조건과의 적합도가 높습니다.'}`);
    lines.push(`- 사용 팁: ${item.usage_tip || '기초 마지막 단계에서 얇게 2~3회 나눠 발라 주세요.'}`);
    lines.push(`- 주의 포인트: ${item.caution || '자외선 노출이 길면 2~3시간 간격으로 덧발라 주세요.'}`);
    lines.push('');
  });

  if (promotions.length > 0) {
    lines.push('현재 행사 상품도 함께 확인할 수 있어요.');
    promotions.forEach((item) => lines.push(`- ${item.name} (${item.price}원)`));
  } else {
    lines.push('현재 별도 행사 매칭 상품은 없고, 정가 기준 추천으로 안내드렸어요.');
  }

  return lines.join('\n');
}

function normalizeCategory(category) {
  const rawCat = String(category || '').toLowerCase().trim();
  if (!rawCat) return { rawCat: '', standardCat: '' };
  return { rawCat, standardCat: CATEGORY_SYNONYM_MAP[rawCat] || rawCat };
}

async function executeTool(args = {}) {
  logger.info(`[Tool Exec] ${TOOL_NAME} start`);

  if ((cafe24ApiService.cacheSize || 0) === 0) {
    logger.info('[Tool Exec] Cache is empty. Triggering on-demand sync...');
    await cafe24ApiService.syncAllProducts();
  }

  const { rawCat, standardCat } = normalizeCategory(args.category);
  const lookupKeywords = FORCED_LOOKUP[standardCat] || [standardCat].filter(Boolean);
  const categoryNos = cafe24ApiService.getDynamicCategoryNos(lookupKeywords) || [];

  let rawProducts = [];
  if (Array.isArray(categoryNos) && categoryNos.length > 0) {
    rawProducts = cafe24ApiService.getProductsFromCache({ categoryNos });
    if (!rawProducts.length && rawCat) rawProducts = cafe24ApiService.getProductsFromCache({ keyword: rawCat });
  } else if (rawCat) {
    rawProducts = cafe24ApiService.getProductsFromCache({ keyword: rawCat });
  }

  if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
    rawProducts = cafe24ApiService.getProductsFromCache({});
  }

  rawProducts = await cafe24ApiService.enrichProductsWithIngredientText(rawProducts, 12);

  const result = await recommendationService.scoreAndFilterProducts(
    rawProducts,
    {
      ...args,
      category_aliases: standardCat ? [standardCat] : [],
      target_category_ids: Array.isArray(categoryNos) ? categoryNos : [],
    },
    3
  );

  const { recommendations, promotions, summary } = result;
  const safeSummary = summary || { message: '조건에 맞는 상품을 찾지 못했습니다.' };

  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    return {
      content: [{ type: 'text', text: safeSummary.message }],
      structuredContent: {
        recommendations: [],
        promotions: [],
        summary: safeSummary,
        strategy: safeSummary.strategy || '',
        conclusion: safeSummary.conclusion || '',
      },
      _meta: {
        ui: { resourceUri: WIDGET_UI_URI },
        'openai/outputTemplate': WIDGET_UI_URI,
        'openai/widgetAccessible': true,
        widgetData: { recommendations: [], promotions: [], summary: safeSummary },
      },
    };
  }

  const consultText = buildConsultText(recommendations, promotions || []);

  return {
    content: [{ type: 'text', text: consultText }],
    structuredContent: {
      recommendations,
      promotions: promotions || [],
      summary: safeSummary,
      strategy: safeSummary.strategy || '',
      conclusion: safeSummary.conclusion || '',
    },
    _meta: {
      ui: { resourceUri: WIDGET_UI_URI },
      'openai/outputTemplate': WIDGET_UI_URI,
      'openai/widgetAccessible': true,
      widgetData: { recommendations, promotions: promotions || [], summary: safeSummary },
    },
  };
}

function handleSseConnect(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.write('event: endpoint\ndata: /mcp/message\n\n');
  res.flushHeaders();
  logger.mcpVerbose(`[MCP Stream] Connected path=${req.path}`);

  clientStream = res;
  res.on('close', () => {
    logger.mcpVerbose(`[MCP Stream] Disconnected path=${req.path}`);
    if (clientStream === res) clientStream = null;
  });
}

router.get('/', handleSseConnect);
router.get('/sse', handleSseConnect);

async function handleMcpMessage(req, res) {
  const { method, params, id } = req.body || {};
  const startedAt = Date.now();
  res.status(202).send('Accepted');

  if (method === 'tools/call' || method === 'resources/read') {
    logger.info(`[MCP Inbound] method=${method} id=${id}`);
  } else {
    logger.mcpVerbose(`[MCP Inbound] method=${method} id=${id}`);
  }

  try {
    if (method === 'initialize') {
      sendToClient({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false }, resources: { subscribe: false } },
          serverInfo: { name: 'cafe24-api-genui', version: '4.3.0' },
        },
      });
      return;
    }

    if (method === 'notifications/initialized') return;

    if (method === 'resources/list') {
      logger.mcpVerbose('[MCP Protocol] resources/list requested');
      sendToClient({ jsonrpc: '2.0', id, result: { resources: RESOURCES } });
      return;
    }

    if (method === 'resources/read') {
      const requestedUri = String(params?.uri || '');
      const normalized = requestedUri.split(/[?#]/)[0];
      const allowedUris = [WIDGET_UI_URI, WIDGET_HTTP_URI];
      logger.info(`[MCP Protocol] resources/read requested: ${requestedUri}`);

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
      html = html.replace('<head>', '<head><script>window.__WIDGET_MODE__=true;window.__MCP_WIDGET__=true;</script>');
      html = html.replace(/src="\//g, `src="${BASE_URL}/`);
      html = html.replace(/href="\//g, `href="${BASE_URL}/`);

      sendToClient({
        jsonrpc: '2.0',
        id,
        result: { contents: [{ uri: requestedUri, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: RESOURCE_META }] },
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

      const recCount = Array.isArray(toolResult?.structuredContent?.recommendations)
        ? toolResult.structuredContent.recommendations.length
        : 0;
      logger.info(`[MCP Tool] ${TOOL_NAME} ok id=${id} recs=${recCount} elapsed_ms=${Date.now() - startedAt}`);

      sendToClient({ jsonrpc: '2.0', id, result: finalResult });
      return;
    }

    sendError(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    logger.error('[MCP Error]', error);
    sendError(id, -32000, error.message);
  }
}

router.post('/message', handleMcpMessage);
router.post('/messages', handleMcpMessage);

export default router;
