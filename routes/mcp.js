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

const WIDGET_TEMPLATE_VERSION = 'v20260414';
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
      ui: { resourceUri: WIDGET_HTTP_URI, visibility: ['model', 'app'] },
      'openai/outputTemplate': WIDGET_HTTP_URI,
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
  suncream: '선크림',
  sunscreen: '선크림',
  sunblock: '선크림',
  자외선차단: '선크림',
  선케어: '선크림',
  suncare: '선크림',
  선스틱: '선스틱',
  썬스틱: '선스틱',
  sunstick: '선스틱',
  'sun stick': '선스틱',
  선세럼: '선세럼',
  썬세럼: '선세럼',
  sunserum: '선세럼',
  'sun serum': '선세럼',
  선스프레이: '선스프레이',
  썬스프레이: '선스프레이',
  sunspray: '선스프레이',
  'sun spray': '선스프레이',
  크림: '크림',
  보습크림: '크림',
  수분크림: '크림',
  세럼: '세럼',
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
  선세럼: ['선케어'],
};

const ENRICH_TRIGGER_KEYWORDS = [
  '민감',
  '저자극',
  '알러지',
  '알레르기',
  '성분',
  '전성분',
  'ingredient',
  'ingredients',
  'inci',
];

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

function normalizeCategory(category) {
  const rawCat = String(category || '').toLowerCase().trim();
  if (!rawCat) return { rawCat: '', standardCat: '' };
  const compact = rawCat.replace(/[\s_-]+/g, '');
  return {
    rawCat,
    standardCat: CATEGORY_SYNONYM_MAP[rawCat] || CATEGORY_SYNONYM_MAP[compact] || rawCat,
  };
}

function computeEnrichMaxFetch(args = {}) {
  const concerns = Array.isArray(args.concerns) ? args.concerns : [];
  const mergedText = [args.category || '', args.skin_type || '', args.q || '', args.query || '', concerns.join(' ')]
    .join(' ')
    .toLowerCase();
  const shouldEnrich = ENRICH_TRIGGER_KEYWORDS.some((k) => mergedText.includes(String(k).toLowerCase()));
  return shouldEnrich ? config.ENRICH_MAX_FETCH_INGREDIENT : config.ENRICH_MAX_FETCH_BASE;
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

  const enrichMaxFetch = computeEnrichMaxFetch(args);
  if (enrichMaxFetch > 0) logger.info(`[Tool Exec] Hybrid enrich enabled: maxFetch=${enrichMaxFetch}`);
  rawProducts = await cafe24ApiService.enrichProductsWithIngredientText(rawProducts, enrichMaxFetch);

  const result = await recommendationService.scoreAndFilterProducts(
    rawProducts,
    {
      ...args,
      category: standardCat || args.category,
      category_aliases: standardCat ? [standardCat] : [],
      target_category_ids: Array.isArray(categoryNos) ? categoryNos : [],
    },
    3
  );

  const {
    requested_category: requestedCategory = null,
    main_recommendations: mainRecommendations = [],
    secondary_recommendations: secondaryRecommendations = [],
    reasoning_tags: reasoningTags = [],
    applied_policy: appliedPolicy = {},
    recommendations = [],
    promotions = [],
    summary = {},
    reference_recommendations: referenceRecommendations = [],
  } = result;

  const safeSummary =
    summary && typeof summary === 'object'
      ? summary
      : { message: '조건에 맞는 결과가 없습니다.', strategy: '', conclusion: '' };

  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    return {
      content: [{ type: 'text', text: safeSummary.message || '조건에 맞는 결과가 없습니다.' }],
      structuredContent: {
        requested_category: requestedCategory,
        main_recommendations: [],
        secondary_recommendations: [],
        reasoning_tags: reasoningTags,
        applied_policy: appliedPolicy,
        recommendations: [],
        promotions: promotions || [],
        reference_recommendations: referenceRecommendations || [],
        summary: safeSummary,
        strategy: safeSummary.strategy || '',
        conclusion: safeSummary.conclusion || '',
      },
      _meta: {
        ui: { resourceUri: WIDGET_HTTP_URI },
        'openai/outputTemplate': WIDGET_HTTP_URI,
        'openai/widgetAccessible': true,
        widgetData: {
          requested_category: requestedCategory,
          main_recommendations: [],
          secondary_recommendations: [],
          reasoning_tags: reasoningTags,
          applied_policy: appliedPolicy,
          recommendations: [],
          promotions: promotions || [],
          reference_recommendations: referenceRecommendations || [],
          summary: safeSummary,
        },
      },
    };
  }

  const consultText = await recommendationService.generate_consult_narrative(
    recommendations,
    promotions || [],
    referenceRecommendations || secondaryRecommendations || [],
    args
  );

  return {
    content: [{ type: 'text', text: consultText }],
    structuredContent: {
      requested_category: requestedCategory,
      main_recommendations: mainRecommendations,
      secondary_recommendations: secondaryRecommendations,
      reasoning_tags: reasoningTags,
      applied_policy: appliedPolicy,
      recommendations,
      promotions: promotions || [],
      reference_recommendations: referenceRecommendations || [],
      summary: safeSummary,
      strategy: safeSummary.strategy || '',
      conclusion: safeSummary.conclusion || '',
    },
    _meta: {
      ui: { resourceUri: WIDGET_HTTP_URI },
      'openai/outputTemplate': WIDGET_HTTP_URI,
      'openai/widgetAccessible': true,
      widgetData: {
        requested_category: requestedCategory,
        main_recommendations: mainRecommendations,
        secondary_recommendations: secondaryRecommendations,
        reasoning_tags: reasoningTags,
        applied_policy: appliedPolicy,
        recommendations,
        promotions: promotions || [],
        reference_recommendations: referenceRecommendations || [],
        summary: safeSummary,
      },
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
          serverInfo: { name: 'cafe24-api-genui', version: '4.4.0' },
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

      const sessionHeaderKey =
        req.headers['x-openai-conversation-id'] ||
        req.headers['x-openai-session-id'] ||
        req.headers['x-session-id'] ||
        req.headers['x-request-id'] ||
        'global';
      const toolArgs = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const enrichedArgs = { ...toolArgs, __session_key: String(sessionHeaderKey) };
      const toolResult = await executeTool(enrichedArgs);
      const finalResult = { ...toolResult };
      if (toolResult.structuredContent) {
        finalResult.data = toolResult.structuredContent;
        finalResult.output = toolResult.structuredContent;
      }

      const recCount = Array.isArray(toolResult?.structuredContent?.main_recommendations)
        ? toolResult.structuredContent.main_recommendations.length
        : Array.isArray(toolResult?.structuredContent?.recommendations)
        ? toolResult.structuredContent.recommendations.length
        : 0;
      const metric = recommendationService.getMetricsSnapshot?.();
      logger.info(
        `[MCP Tool] ${TOOL_NAME} ok id=${id} recs=${recCount} elapsed_ms=${Date.now() - startedAt}` +
          (metric
            ? ` no_result_rate=${metric.no_result_rate} fallback_rate=${metric.fallback_rate} category_lock_violation_count=${metric.category_lock_violation_count} form_lock_violation_count=${metric.form_lock_violation_count || 0}`
            : '')
      );

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
