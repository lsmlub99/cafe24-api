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

function buildCompactConsultText(args = {}, mainRecommendations = []) {
  if (!Array.isArray(mainRecommendations) || mainRecommendations.length === 0) {
    return '조건에 맞는 본품 후보를 찾지 못했어요. 원하시면 피부 타입이나 사용감을 알려주시면 다시 좁혀드릴게요.';
  }

  const skinType = String(args.skin_type || '').trim();
  const concerns = Array.isArray(args.concerns) ? args.concerns.filter(Boolean) : [];
  const context = [skinType ? `${skinType} 피부` : '', concerns.length ? `고민: ${concerns.join(', ')}` : '']
    .filter(Boolean)
    .join(' / ');

  const names = mainRecommendations.slice(0, 3).map((x) => x.name);
  const lines = [];
  if (context) lines.push(`선택 요약: ${context} 기준으로 카드 1~3번을 비교해보세요.`);
  else lines.push('선택 요약: 카드 1~3번을 사용감 기준으로 비교해보세요.');
  lines.push(`지금 후보는 ${names.join(' / ')} 순서예요.`);
  lines.push('다음으로는 번들거림 적은 타입만 다시 보거나, 민감성 기준으로 다시 좁혀드릴 수 있어요.');
  return lines.join('\n');
}

function buildCanonicalConsultText(mainRecommendations = []) {
  if (!Array.isArray(mainRecommendations) || mainRecommendations.length === 0) {
    return '조건에 맞는 추천 결과를 찾지 못했어요. 피부 타입이나 원하는 사용감을 알려주시면 다시 맞춰드릴게요.';
  }

  const ranked = mainRecommendations.slice(0, 3);
  const lines = ['카드에 나온 추천을 같은 순서로 간단히 설명드릴게요.', ''];

  ranked.forEach((item, idx) => {
    const rank = idx + 1;
    const name = String(item?.name || '').trim();
    const why = String(item?.why_pick || item?.key_point || '').trim();
    const tip = String(item?.usage_tip || '').trim();

    lines.push(`${rank}순위: ${name}`);
    if (why) lines.push(`- 추천 이유: ${why}`);
    if (tip) lines.push(`- 사용 팁: ${tip}`);
    if (idx < ranked.length - 1) lines.push('');
  });

  lines.push('', '피부 타입이나 원하는 사용감을 알려주시면 1개로 좁혀드릴게요.');
  return lines.join('\n');
}

function buildCanonicalConsultTextV2(mainRecommendations = []) {
  if (!Array.isArray(mainRecommendations) || mainRecommendations.length === 0) {
    return '조건에 맞는 추천 결과를 찾지 못했어요. 피부 타입이나 원하는 사용감을 알려주시면 다시 맞춰드릴게요.';
  }

  const ranked = mainRecommendations.slice(0, 3);
  const lines = ['카드와 같은 추천을 순서대로 간단히 설명드릴게요.', ''];

  ranked.forEach((item, idx) => {
    const rank = idx + 1;
    const name = String(item?.name || '').trim();
    const why = String(item?.why_pick || item?.key_point || '').trim();
    const tip = String(item?.usage_tip || '').trim();

    lines.push(`${rank}순위: ${name}`);
    if (why) lines.push(`- 추천 이유: ${why}`);
    if (tip) lines.push(`- 사용 팁: ${tip}`);
    if (idx < ranked.length - 1) lines.push('');
  });

  lines.push('');
  lines.push('고르는 기준이 애매하면 1순위부터 비교해보는 게 가장 안전해요.');
  lines.push('원하시면 피부 타입이나 원하는 사용감을 알려주시면 1개로 좁혀드릴게요.');
  return lines.join('\n');
}

function buildCanonicalConsultTextV3(mainRecommendations = [], args = {}) {
  if (!Array.isArray(mainRecommendations) || mainRecommendations.length === 0) {
    return '조건에 맞는 추천 결과를 찾지 못했어요. 피부 타입이나 원하는 사용감을 알려주시면 다시 맞춰드릴게요.';
  }

  const ranked = mainRecommendations.slice(0, 3);
  const skin = String(args.skin_type || '').trim();
  const concerns = Array.isArray(args.concerns) ? args.concerns.filter(Boolean) : [];
  const query = String(args.query || args.q || '').trim();
  const contextParts = [skin ? `${skin} 피부` : '', concerns.length ? `고민: ${concerns.join(', ')}` : '', query ? `요청: ${query}` : ''].filter(Boolean);

  const lines = [];
  lines.push(contextParts.length ? `요청 기준(${contextParts.join(' / ')})으로 카드와 같은 순서로 설명드릴게요.` : '요청 기준으로 카드와 같은 순서로 설명드릴게요.');
  lines.push('');

  ranked.forEach((item, idx) => {
    const rank = idx + 1;
    const name = String(item?.name || '').trim();
    const why = String(item?.why_pick || item?.key_point || '').trim();
    const tip = String(item?.usage_tip || '').trim();
    const form = String(item?.form || '').toLowerCase();

    const situation =
      form.includes('cushion')
        ? '메이크업 톤 보정이나 커버를 같이 보고 싶을 때'
        : form.includes('serum')
        ? '더 가볍게 바르고 싶은 날'
        : form.includes('stick') || form.includes('spray')
        ? '외출 중 수정이나 덧바름이 필요한 상황'
        : '데일리 베이스 단계에서 무난하게 쓰고 싶을 때';

    lines.push(`${rank}순위: ${name}`);
    lines.push(`- 추천 이유: ${why || '요청 조건과의 일치도가 높은 후보예요.'}`);
    lines.push(`- 잘 맞는 상황: ${situation}.`);
    if (tip) lines.push(`- 사용 팁: ${tip}`);
    if (idx < ranked.length - 1) lines.push('');
  });

  lines.push('');
  lines.push('사용 팁: 기초 마지막 단계에서 얇게 나눠 바르면 밀림 부담을 줄이기 좋아요.');
  return lines.join('\n');
}

function normalizeForKeywordMatch(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\-_:/\\()[\]{}.,!?'"]/g, '');
}

function includesFormKeyword(name = '', categoryHint = '') {
  const normalized = normalizeForKeywordMatch(name);
  if (!normalized) return false;

  const defaultKeywords = ['선크림', '썬크림', '선세럼', '썬세럼', '세럼', '스틱', '스프레이', '쿠션', '비비', 'bb', '톤업'];
  const hasDefaultKeyword = defaultKeywords.some((keyword) =>
    normalized.includes(normalizeForKeywordMatch(keyword))
  );

  const categoryNorm = normalizeForKeywordMatch(categoryHint);
  const isBbContext = ['bb', '비비크림', 'bbcream'].some((token) => categoryNorm.includes(token));
  if (!isBbContext) return hasDefaultKeyword;

  const bbKeywords = ['비비', 'bb', '베이스', '선베이스'];
  return bbKeywords.some((keyword) => normalized.includes(normalizeForKeywordMatch(keyword)));
}

function buildShortConclusionName(originalName = '', displayNameShort = '') {
  const original = String(originalName || '').trim();
  if (!original) return '';

  const providedShort = String(displayNameShort || '').trim();
  if (providedShort) return providedShort;

  const withoutSize = original
    .replace(/\s*\d+\s?(ml|g|kg|oz|ea|매|개)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const candidate = withoutSize || original;
  if (candidate.length <= 25) return candidate;
  return `${candidate.slice(0, 25).trim()}…`;
}

function resolveConclusionDisplayName(item = {}, categoryHint = '') {
  const originalName = String(item?.name || '').trim();
  const shortName = buildShortConclusionName(originalName, item?.display_name_short);

  if (!shortName) return originalName;
  if (!includesFormKeyword(shortName, categoryHint)) {
    return originalName;
  }
  return shortName;
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

function buildCanonicalConsultTextRich(mainRecommendations = [], args = {}) {
  if (!Array.isArray(mainRecommendations) || mainRecommendations.length === 0) {
    return '조건에 맞는 추천 결과를 찾지 못했어요. 피부 타입이나 원하는 사용감을 알려주시면 다시 맞춰드릴게요.';
  }

  const ranked = mainRecommendations.slice(0, 3);
  const skin = String(args.skin_type || '').trim();
  const concerns = Array.isArray(args.concerns) ? args.concerns.filter(Boolean) : [];
  const query = String(args.query || args.q || '').trim();
  const contextParts = [skin ? `${skin} 피부` : '', concerns.length ? `고민: ${concerns.join(', ')}` : '', query ? `요청: ${query}` : ''].filter(Boolean);

  const lines = [];
  const topItem = ranked[0] || {};
  const conclusionDisplayName = resolveConclusionDisplayNameV14(topItem, args?.category || '');
  if (conclusionDisplayName) {
    lines.push(`吏湲?湲곗??대㈃ ${conclusionDisplayName}?쇰줈 ?쒖옉?섎뒗 寃?媛???덉젙?곸씠?먯슂.`);
  }
  if (conclusionDisplayName && lines.length > 0) {
    lines[lines.length - 1] = `\uC9C0\uAE08 \uAE30\uC900\uC774\uBA74 ${conclusionDisplayName}\uC73C\uB85C \uC2DC\uC791\uD558\uB294 \uAC8C \uAC00\uC7A5 \uC548\uC815\uC801\uC774\uC5D0\uC694.`;
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
      form.includes('cushion')
        ? '톤 보정이나 커버를 함께 보고 싶을 때'
        : form.includes('serum')
        ? '가볍게 발리고 답답함이 적은 타입이 필요할 때'
        : form.includes('stick') || form.includes('spray')
        ? '외출 중 수정이나 덧바름 편의성이 중요할 때'
        : '메이크업 전 단계에서 밀림 부담을 줄이고 싶을 때';

    lines.push(`${rank}순위 ${name}`);
    lines.push(`- 추천 이유: ${why || '요청 조건에 맞는 사용감 중심으로 선별된 후보예요.'}`);
    lines.push(`- 상황 적합: ${situation}.`);
    if (tip) lines.push(`- 사용 팁: ${tip}`);
    if (idx < ranked.length - 1) lines.push('');
  });

  lines.push('');
  if (ranked.length >= 2) {
    lines.push(
      `비교 포인트: 1순위(${ranked[0].name})를 기준으로, 2순위(${ranked[1].name})는 사용감/표현감 대안으로 비교해보면 선택이 쉬워요.`
    );
  }
  lines.push('마무리 팁: 기초 마지막 단계에서 얇게 나눠 바르면 밀림 부담을 줄이기 좋아요.');
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

  if (!Array.isArray(canonicalMain) || canonicalMain.length === 0) {
    return {
      content: [{ type: 'text', text: safeSummary.message || '조건에 맞는 결과가 없습니다.' }],
      structuredContent: {
        requested_category: requestedCategory,
        main_recommendations: [],
        secondary_recommendations: canonicalSecondary,
        reasoning_tags: reasoningTags,
        applied_policy: appliedPolicy,
        recommendations: [],
        promotions: promotions || [],
        reference_recommendations: canonicalSecondary || [],
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
          secondary_recommendations: canonicalSecondary,
          reasoning_tags: reasoningTags,
          applied_policy: appliedPolicy,
          recommendations: [],
          promotions: promotions || [],
          reference_recommendations: canonicalSecondary || [],
          summary: safeSummary,
        },
      },
    };
  }

  const consultText = buildCanonicalConsultTextRich(canonicalMain, args);

  return {
    content: [{ type: 'text', text: consultText }],
    structuredContent: {
      requested_category: requestedCategory,
      main_recommendations: canonicalMain,
      secondary_recommendations: canonicalSecondary,
      reasoning_tags: reasoningTags,
      applied_policy: appliedPolicy,
      recommendations: canonicalMain,
      promotions: promotions || [],
      reference_recommendations: canonicalSecondary || [],
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
        main_recommendations: canonicalMain,
        secondary_recommendations: canonicalSecondary,
        reasoning_tags: reasoningTags,
        applied_policy: appliedPolicy,
        recommendations: canonicalMain,
        promotions: promotions || [],
        reference_recommendations: canonicalSecondary || [],
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
      html = html.replace(
        '<head>',
        `<head><script>window.__WIDGET_MODE__=true;window.__MCP_WIDGET__=true;window.__API_BASE_URL__='${BASE_URL}';</script>`
      );
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
            ? ` no_result_rate=${metric.no_result_rate} fallback_rate=${metric.fallback_rate} fallback_rate_rolling_100=${metric.fallback_rate_rolling_100 || 0} mismatch_rate_rolling_100=${metric.mismatch_rate_rolling_100 || 0} category_lock_violation_count=${metric.category_lock_violation_count} form_lock_violation_count=${metric.form_lock_violation_count || 0} explanation_mismatch_count=${metric.explanation_mismatch_count || 0}`
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
