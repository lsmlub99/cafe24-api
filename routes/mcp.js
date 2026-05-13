import express from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { recommendationService } from '../services/recommendationService.js';
import { buildMcpToolResult as buildMcpToolResultContract } from './mcpResponseContract.js';

const router = express.Router();
const clientStreams = new Map(); // sessionId → res (SSE stream)

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
  'openai/widgetDescription': '셀퓨전씨 AI 추천 카드가 위젯에 자동 표시됩니다. 제품 목록·가격·성분을 텍스트로 반복하지 마세요.',
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
    description:
      '[GEN-UI] Returns pre-formatted CellFusionC product recommendations. The recommendation widget is displayed automatically. Output the tool result text as-is — do NOT add tables, prices, bullet lists, or extra analysis.',
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
      required: ['category'],
      properties: {
        category: { type: 'string', description: '추천 카테고리 (예: 선크림, 토너, 세럼, 크림)' },
        q: { type: 'string', description: '사용자 자연어 쿼리 (피부 고민, 제형 요청 등 전체 문장)' },
        skin_type: { type: 'string', description: '피부 타입 (건성, 지성, 수부지, 민감성)' },
        concerns: { type: 'array', items: { type: 'string' }, description: '피부 고민 목록 (보습, 진정, 유분, 톤업 등)' },
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

function buildMcpToolResult({
  requestedCategory = null,
  canonicalMain = [],
  canonicalSecondary = [],
  reasoningTags = [],
  appliedPolicy = {},
  promotions = [],
  safeSummary = {},
  consultText = '',
  bodyTemplateVersion = 'fixed_v1',
} = {}) {
  return buildMcpToolResultContract({
    requestedCategory,
    canonicalMain,
    canonicalSecondary,
    reasoningTags,
    appliedPolicy,
    promotions,
    safeSummary,
    consultText,
    bodyTemplateVersion,
    widgetHttpUri: WIDGET_HTTP_URI,
    minimalStructuredEnv: process.env.MCP_MINIMAL_STRUCTURED,
  });
}

function getSessionId(req) {
  return (
    req.headers['x-openai-conversation-id'] ||
    req.headers['x-openai-session-id'] ||
    req.headers['x-session-id'] ||
    req.headers['x-request-id'] ||
    'global'
  );
}

function sendToClient(sessionId, msg) {
  const stream = clientStreams.get(sessionId) || clientStreams.get('global');
  if (stream && !stream.writableEnded) {
    stream.write('event: message\n');
    stream.write(`data: ${JSON.stringify(msg)}\n\n`);
  } else {
    logger.warn(`[MCP Stream] No active clientStream for session=${sessionId}. Message not delivered via SSE.`);
  }
}

function sendError(sessionId, id, code, message, data = undefined) {
  sendToClient(sessionId, {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data ? { data } : {}) },
  });
}

function normalizeCategory(category) {
  const rawCat = String(category || '').toLowerCase().trim();
  if (!rawCat) return { rawCat: '', standardCat: '' };
  const compact = rawCat.replace(/[\s_-]+/g, '');
  const isBbExplicit =
    /(비비\s*크림|bb\s*cream|bb\s*크림|bbcream|비비크림)/i.test(rawCat) ||
    /(비비크림|bbcream)/i.test(compact);

  if (isBbExplicit) {
    return {
      rawCat,
      standardCat: '비비크림',
    };
  }
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

function includesFormKeywordV14(name = '', categoryHint = '') {
  const normalize = (text = '') =>
    String(text || '')
      .toLowerCase()
      .replace(/[\s\-_:/\\()[\]{}.,!?'"]/g, '');

  const normalized = normalize(name);
  if (!normalized) return false;

  const defaultKeywords = [
    '\uC120\uD06C\uB9BC',
    '\uC36C\uD06C\uB9BC',
    '\uC120\uC138\uB7FC',
    '\uC36C\uC138\uB7FC',
    '\uC138\uB7FC',
    '\uC2A4\uD2F1',
    '\uC2A4\uD504\uB808\uC774',
    '\uCFE0\uC158',
    '\uBE44\uBE44',
    'bb',
    '\uD1A4\uC5C5',
  ];
  const hasDefaultKeyword = defaultKeywords.some((keyword) => normalized.includes(normalize(keyword)));

  const categoryNorm = normalize(categoryHint);
  const isBbContext = ['bb', '\uBE44\uBE44\uD06C\uB9BC', 'bbcream'].some((token) =>
    categoryNorm.includes(normalize(token))
  );
  if (!isBbContext) return hasDefaultKeyword;

  const bbKeywords = ['\uBE44\uBE44', 'bb', '\uBCA0\uC774\uC2A4', '\uC120\uBCA0\uC774\uC2A4'];
  return bbKeywords.some((keyword) => normalized.includes(normalize(keyword)));
}

function buildShortConclusionNameV14(originalName = '', displayNameShort = '') {
  const original = String(originalName || '').trim();
  if (!original) return '';

  const providedShort = String(displayNameShort || '').trim();
  if (providedShort) return providedShort;

  const withoutSize = original
    .replace(/\s*\d+\s?(ml|g|kg|oz|ea)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const candidate = withoutSize || original;
  if (candidate.length <= 25) return candidate;
  return `${candidate.slice(0, 25).trim()}...`;
}

function resolveConclusionDisplayNameV14(item = {}, categoryHint = '') {
  const originalName = String(item?.name || '').trim();
  const shortName = buildShortConclusionNameV14(originalName, item?.display_name_short);
  if (!shortName) return originalName;

  if (!includesFormKeywordV14(shortName, categoryHint)) {
    return originalName;
  }
  return shortName;
}

const FORM_BODY_REASON = {
  cream: '크림 타입으로 밀착력이 좋고 데일리 기초에 잘 맞아요.',
  serum: '세럼 타입으로 가볍고 산뜻하게 발려요.',
  stick: '스틱 타입으로 외출 중 덧바름이 간편해요.',
  spray: '스프레이 타입으로 빠르게 재도포할 수 있어요.',
  cushion: '쿠션 타입으로 톤 보정과 선케어를 함께 해요.',
  lotion: '로션 타입으로 가볍게 흡수되고 부담이 적어요.',
};

function buildCanonicalConsultTextFixed(mainRecommendations = [], args = {}) {
  if (!Array.isArray(mainRecommendations) || mainRecommendations.length === 0) {
    return '조건에 맞는 추천 결과를 찾지 못했어요. 피부 타입이나 원하는 사용감을 알려주시면 다시 맞춰드릴게요.';
  }

  const ranked = mainRecommendations.slice(0, 3);
  const topItem = ranked[0] || {};
  const conclusionDisplayName = resolveConclusionDisplayNameV14(topItem, args?.category || '');
  const skin = String(args.skin_type || '').trim();
  const concerns = Array.isArray(args.concerns) ? args.concerns.filter(Boolean) : [];
  const query = String(args.query || args.q || '').trim();
  const contextParts = [
    skin ? `${skin} 피부` : '',
    concerns.length ? `고민: ${concerns.join(', ')}` : '',
    query ? `요청: ${query}` : '',
  ].filter(Boolean);

  const lines = [];
  if (conclusionDisplayName) {
    lines.push(`지금 기준이면 ${conclusionDisplayName}으로 시작하는 게 가장 안정적이에요.`);
  }
  lines.push(
    contextParts.length
      ? `요청 기준(${contextParts.join(' / ')})으로 카드와 같은 순서로 정리해드릴게요.`
      : '요청 기준으로 카드와 같은 순서로 정리해드릴게요.'
  );
  lines.push('');

  ranked.forEach((item, idx) => {
    const rank = idx + 1;
    const name = String(item?.name || '').trim();
    const why = String(item?.why_pick || item?.key_point || '').trim();
    const tip = String(item?.usage_tip || '').trim();
    const form = String(item?.form || '').toLowerCase();

    const situation =
      form === 'cushion'
        ? '톤 보정이나 커버를 함께 보고 싶을 때'
        : form === 'serum'
        ? '가볍게 발리고 답답함이 적은 타입이 필요할 때'
        : form === 'stick' || form === 'spray'
        ? '외출 중 수정이나 덧바름 편의성이 중요할 때'
        : '매일 부담 없이 꾸준히 쓰기 좋은 제품이 필요할 때';

    lines.push(`${rank}순위 ${name}`);
    const bodyReason =
      why && why.length > 15 && !why.includes('후보') && !why.includes('매칭 점수')
        ? why
        : FORM_BODY_REASON[form] || '요청 조건에 맞는 사용감으로 선별됐어요.';
    lines.push(`- 추천 이유: ${bodyReason}`);
    lines.push(`- 상황 적합: ${situation}`);
    if (tip) lines.push(`- 사용 팁: ${tip}`);
    if (idx < ranked.length - 1) lines.push('');
  });

  lines.push('');
  if (ranked.length >= 2) {
    lines.push(
      `비교 포인트: 1순위(${ranked[0].name})를 기준으로, 2순위(${ranked[1].name})는 사용감 대안으로 비교해보면 선택이 쉬워요.`
    );
  }
  lines.push(`처음 고르신다면 ${String(ranked[0]?.name || '').trim()}부터 보셔도 좋고, 원하시면 피부 타입이나 사용감 기준으로 더 좁혀드릴게요.`);
  lines.push('');
  lines.push('다른 제품도 한번 알아볼까요?');

  return lines.join('\n');
}

async function executeTool(args = {}) {
  logger.info(`[Tool Exec] ${TOOL_NAME} start`);

  if ((cafe24ApiService.cacheSize || 0) === 0) {
    logger.info('[Tool Exec] Cache is empty. Triggering on-demand sync...');
    await cafe24ApiService.syncAllProducts();
  }

  const { rawCat, standardCat } = normalizeCategory(args.category);
  const lookupKeywords =
    standardCat === '비비크림'
      ? ['비비크림']
      : FORCED_LOOKUP[standardCat] || [standardCat].filter(Boolean);
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

  // Supplement with keyword search when category pool is small (catches event/bundle products in untracked categories)
  if (rawProducts.length < 20 && categoryNos.length > 0) {
    const supplements = cafe24ApiService.getKeywordSupplementForLookup(lookupKeywords);
    logger.info(`[Tool Exec] Supplement check: rawLen=${rawProducts.length} catNos=${JSON.stringify(categoryNos)} lookupKws=${JSON.stringify(lookupKeywords)} supplements=${JSON.stringify(supplements)}`);
    if (supplements.length > 0) {
      const seen = new Set(rawProducts.map((p) => String(p.product_no)));
      const supplementCats = categoryNos.map((id) => ({ category_no: id }));
      for (const kw of supplements) {
        const found = cafe24ApiService.getProductsFromCache({ keyword: kw });
        const newOnes = found.filter((p) => !seen.has(String(p.product_no)));
        logger.info(`[Tool Exec] Supplement kw='${kw}' found=${found.length} new=${newOnes.length}${newOnes.length > 0 ? ' e.g.' + newOnes[0].product_name : ''}`);
        for (const p of newOnes) {
          seen.add(String(p.product_no));
          const existingCats = Array.isArray(p.categories) ? p.categories : [];
          rawProducts.push({ ...p, categories: [...existingCats, ...supplementCats] });
        }
      }
      logger.info(`[Tool Exec] Supplement result: total rawProducts=${rawProducts.length}`);
    }
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

  const canonicalMain =
    Array.isArray(mainRecommendations) && mainRecommendations.length > 0
      ? mainRecommendations
      : Array.isArray(recommendations)
      ? recommendations
      : [];
  const canonicalSecondary =
    Array.isArray(secondaryRecommendations) && secondaryRecommendations.length > 0
      ? secondaryRecommendations
      : Array.isArray(referenceRecommendations)
      ? referenceRecommendations
      : [];

  const safeSummary =
    summary && typeof summary === 'object'
      ? summary
      : { message: '조건에 맞는 결과가 없습니다.', strategy: '', conclusion: '' };

  // unified body generation path: even when main is empty we keep fixed_v1 text shape.

  const consultText = buildCanonicalConsultTextFixed(canonicalMain, args);
  const bodyTemplateVersion = 'fixed_v1';
  const bodyItemsCount = Array.isArray(canonicalMain) ? canonicalMain.length : 0;
  const bodyRankLinesCount = bodyItemsCount;
  const bodyConclusionProduct = String(canonicalMain?.[0]?.name || '').trim();
  const mainTop1Product = String(canonicalMain?.[0]?.name || '').trim();
  const bodyTop1Match =
    !bodyConclusionProduct || !mainTop1Product ? true : bodyConclusionProduct === mainTop1Product;
  // Body Sync log: submission-time checkpoint for "card = source of truth, body = explanation".
  logger.info(
    `[Body Sync] body_template_version=${bodyTemplateVersion} body_items_count=${bodyItemsCount} body_rank_lines_count=${bodyRankLinesCount} body_conclusion_product="${bodyConclusionProduct}" main_top1_product="${mainTop1Product}" body_top1_match=${bodyTop1Match}`
  );

  const toolResult = buildMcpToolResultContract({
    requestedCategory,
    canonicalMain,
    canonicalSecondary,
    reasoningTags,
    appliedPolicy,
    promotions,
    safeSummary,
    consultText,
    bodyTemplateVersion,
    widgetHttpUri: WIDGET_HTTP_URI,
    minimalStructuredEnv: process.env.MCP_MINIMAL_STRUCTURED,
  });
  const structuredContentKeys = Object.keys(toolResult?.structuredContent || {});
  const structuredContentHasRecommendations = Object.prototype.hasOwnProperty.call(
    toolResult?.structuredContent || {},
    'recommendations'
  );
  const structuredContentHasSummary = Object.prototype.hasOwnProperty.call(toolResult?.structuredContent || {}, 'summary');
  const metaWidgetDataHasRecommendations = Boolean(
    toolResult?._meta?.widgetData?.recommendations || toolResult?._meta?.widgetData?.main_recommendations
  );
  logger.info(
    `[MCP Shape] structuredContent_keys=${structuredContentKeys.join(',')} structuredContent_has_recommendations=${structuredContentHasRecommendations} structuredContent_has_summary=${structuredContentHasSummary} meta_widgetData_has_recommendations=${metaWidgetDataHasRecommendations}`
  );
  return toolResult;
}

function handleSseConnect(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.write('event: endpoint\ndata: /mcp/message\n\n');
  res.flushHeaders();

  const sessionId = getSessionId(req);
  clientStreams.set(sessionId, res);
  logger.mcpVerbose(`[MCP Stream] Connected path=${req.path} session=${sessionId} total=${clientStreams.size}`);

  res.on('close', () => {
    if (clientStreams.get(sessionId) === res) clientStreams.delete(sessionId);
    logger.mcpVerbose(`[MCP Stream] Disconnected path=${req.path} session=${sessionId} total=${clientStreams.size}`);
  });
}

router.get('/', handleSseConnect);
router.get('/sse', handleSseConnect);

async function handleMcpMessage(req, res) {
  const { method, params, id } = req.body || {};
  const startedAt = Date.now();
  const sessionId = getSessionId(req);
  res.status(202).send('Accepted');

  const send = (msg) => sendToClient(sessionId, msg);
  const sendErr = (errId, code, message, data = undefined) => sendError(sessionId, errId, code, message, data);

  if (method === 'tools/call' || method === 'resources/read') {
    logger.info(`[MCP Inbound] method=${method} id=${id} session=${sessionId}`);
  } else {
    logger.mcpVerbose(`[MCP Inbound] method=${method} id=${id} session=${sessionId}`);
  }

  try {
    if (method === 'initialize') {
      send({
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
      send({ jsonrpc: '2.0', id, result: { resources: RESOURCES } });
      return;
    }

    if (method === 'resources/read') {
      const requestedUri = String(params?.uri || '');
      const normalized = requestedUri.split(/[?#]/)[0];
      const allowedUris = [WIDGET_UI_URI, WIDGET_HTTP_URI];
      logger.info(`[MCP Protocol] resources/read requested: ${requestedUri}`);

      if (!allowedUris.includes(normalized)) {
        sendErr(id, -32602, `Unknown resource URI: ${requestedUri}`, { available: allowedUris });
        return;
      }

      const indexPath = path.join(process.cwd(), 'client/dist/index.html');
      if (!fs.existsSync(indexPath)) {
        sendErr(id, -32000, `Widget build not found at ${indexPath}`);
        return;
      }

      let html = fs.readFileSync(indexPath, 'utf8');
      html = html.replace(
        '<head>',
        `<head><script>window.__WIDGET_MODE__=true;window.__MCP_WIDGET__=true;window.__API_BASE_URL__='${BASE_URL}';</script>`
      );
      html = html.replace(/src="\//g, `src="${BASE_URL}/`);
      html = html.replace(/href="\//g, `href="${BASE_URL}/`);

      send({
        jsonrpc: '2.0',
        id,
        result: { contents: [{ uri: requestedUri, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: RESOURCE_META }] },
      });
      return;
    }

    if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      if (toolName !== TOOL_NAME) {
        sendErr(id, -32601, `Tool not found: ${toolName}`);
        return;
      }

      const toolArgs = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const enrichedArgs = { ...toolArgs, __session_key: sessionId };
      const toolResult = await executeTool(enrichedArgs);
      const finalResult = { ...toolResult };
      if (toolResult.structuredContent) {
        finalResult.data = toolResult.structuredContent;
        finalResult.output = toolResult.structuredContent;
      }

      const recCount = Array.isArray(toolResult?._meta?.widgetData?.main_recommendations)
        ? toolResult._meta.widgetData.main_recommendations.length
        : Array.isArray(toolResult?.structuredContent?.main_recommendations)
        ? toolResult.structuredContent.main_recommendations.length
        : Array.isArray(toolResult?.structuredContent?.recommendations)
        ? toolResult.structuredContent.recommendations.length
        : 0;
      const metric = recommendationService.getMetricsSnapshot?.();
      logger.info(
        `[MCP Tool] ${TOOL_NAME} ok id=${id} session=${sessionId} recs=${recCount} elapsed_ms=${Date.now() - startedAt}` +
          (metric
            ? ` no_result_rate=${metric.no_result_rate} fallback_rate=${metric.fallback_rate} fallback_rate_rolling_100=${metric.fallback_rate_rolling_100 || 0} mismatch_rate_rolling_100=${metric.mismatch_rate_rolling_100 || 0} category_lock_violation_count=${metric.category_lock_violation_count} form_lock_violation_count=${metric.form_lock_violation_count || 0} explanation_mismatch_count=${metric.explanation_mismatch_count || 0}`
            : '')
      );

      send({ jsonrpc: '2.0', id, result: finalResult });
      return;
    }

    sendErr(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    logger.error('[MCP Error]', error);
    sendErr(id, -32000, error.message);
  }
}

router.post('/message', handleMcpMessage);
router.post('/messages', handleMcpMessage);

export default router;
