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
  자외선: '선크림',
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
  sunspray: '선스프레이',
  'sun spray': '선스프레이',
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

function buildConsultText(recommendations, promotions = [], referenceRecommendations = []) {
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

  if (Array.isArray(referenceRecommendations) && referenceRecommendations.length > 0) {
    lines.push('');
    lines.push('참고용으로 다른 제형 대안도 함께 추천드릴게요.');
    referenceRecommendations.forEach((item) => {
      lines.push(`- ${item.name} (${item.price}원 / ${item.form || '다른 제형'})`);
    });
  }

  const parsedPrices = recommendations
    .map((r) => Number.parseInt(String(r?.price || '').replace(/[^\d]/g, ''), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const minPrice = parsedPrices.length ? Math.min(...parsedPrices) : null;
  const budgetGuide =
    minPrice == null
      ? '원하시면 예산대를 알려주시면 그 범위 안에서 다시 좁혀드릴까요?'
      : minPrice <= 20000
      ? '원하시면 2만원 이하 예산으로만 다시 추려드릴까요?'
      : minPrice <= 30000
      ? '원하시면 3만원대 이내로만 다시 추려드릴까요?'
      : '원하시면 3만원 이하/이상으로 나눠서 다시 정리해드릴까요?';

  const firstName = String(recommendations[0]?.name || '');
  let comboGuide = '함께 쓰면 좋은 제품(토너/수분크림/진정템)도 같이 묶어서 추천드릴까요?';
  if (/세럼|serum/i.test(firstName)) {
    comboGuide = '세럼과 같이 쓰면 좋은 수분크림/선케어 조합도 바로 맞춰드릴까요?';
  } else if (/선|sun|썬/i.test(firstName)) {
    comboGuide = '선케어와 궁합 좋은 베이스(토너/수분크림/메이크업 전 단계)도 같이 추천드릴까요?';
  } else if (/크림|cream/i.test(firstName)) {
    comboGuide = '크림과 같이 쓰면 좋은 진정 세럼/선케어 조합도 같이 추천드릴까요?';
  }

  lines.push('');
  lines.push(`- ${budgetGuide}`);
  lines.push(`- ${comboGuide}`);

  return lines.join('\n');
}

function buildConsultNarrative(recommendations, promotions = [], referenceRecommendations = [], args = {}) {
  const lines = [];
  const skinType = String(args.skin_type || '').trim();
  const concernText = Array.isArray(args.concerns) && args.concerns.length > 0 ? args.concerns.join(', ') : '';

  lines.push('상단 카드에는 제품별 근거와 핵심 포인트를 정리해두었고, 아래에서는 실제 사용 흐름 중심으로 안내드릴게요.');
  lines.push('');

  if (skinType || concernText) {
    lines.push(
      `${skinType ? `${skinType} 피부` : '현재 피부 상태'} 기준으로` +
        `${concernText ? ` (${concernText})` : ''} ` +
        '무겁지 않게 밀착되고, 덧발라도 부담이 적은 쪽으로 큐레이션했어요.'
    );
    lines.push('');
  }

  lines.push('이렇게 사용하시면 만족도가 높아요.');
  lines.push('1) 아침: 1위 제품을 메인으로 얇게 2회 레이어링');
  lines.push('2) 외출 중: 땀/유분이 올라오면 문지르지 말고 가볍게 덧바르기');
  lines.push('3) 저녁: 자극감이 느껴진 날은 진정 위주 스킨케어로 마무리');
  lines.push('');

  if (recommendations.length >= 2) {
    lines.push(`메인 선택은 1위(${recommendations[0].name})로 시작하고, 사용감이 안 맞으면 2위(${recommendations[1].name})로 바꿔보세요.`);
  } else if (recommendations.length === 1) {
    lines.push(`우선 1위(${recommendations[0].name})로 3일 정도 사용감부터 확인해보시는 걸 추천드려요.`);
  }

  if (recommendations.length >= 3) {
    lines.push(`3위(${recommendations[2].name})는 보완용 대안으로 두고, 피부 반응에 따라 교체하시면 됩니다.`);
  }

  if (promotions.length > 0) {
    lines.push('');
    lines.push('행사 상품은 하단 배너에서 확인하실 수 있고, 본품이 맞는지 먼저 체크한 뒤 선택하시는 걸 권장드려요.');
  }

  if (Array.isArray(referenceRecommendations) && referenceRecommendations.length > 0) {
    lines.push('');
    lines.push('참고용 추천은 다른 제형 대안이에요. 메인 제품이 답답하거나 밀릴 때 교체 옵션으로 보시면 좋아요.');
  }

  lines.push('');
  lines.push('원하시면 다음 답변에서 아침/야외/메이크업 전 3상황으로 나눠 더 구체적인 사용 순서까지 맞춰드릴게요.');

  return lines.join('\n');
}

function buildConsultNarrativeV2(recommendations, promotions = [], referenceRecommendations = [], args = {}) {
  const lines = [];
  const skinType = String(args.skin_type || '').trim();
  const concernText = Array.isArray(args.concerns) && args.concerns.length > 0 ? args.concerns.join(', ') : '';
  const categoryText = String(args.category || '').trim();

  lines.push('상단 카드에는 제품별 근거를 담아두었고, 아래에서는 실제 사용 방법 중심으로 안내드릴게요.');
  lines.push('');

  const conditionLabel = [skinType ? `${skinType} 피부` : '', concernText || '', categoryText || '']
    .filter(Boolean)
    .join(' / ');
  if (conditionLabel) {
    lines.push(`현재 조건(${conditionLabel}) 기준으로, 밀착력과 사용 편의성을 함께 고려해 구성했습니다.`);
    lines.push('');
  }

  lines.push('사용은 아래 순서로 진행해보세요.');
  lines.push('1) 아침: 1위 제품을 얇게 2회 레이어링해서 밀착');
  lines.push('2) 낮 시간: 유분/땀이 올라오면 문지르지 말고 가볍게 덧바르기');
  lines.push('3) 저녁: 자극감이 느껴진 날은 진정 위주 스킨케어로 마무리');
  lines.push('');

  if (recommendations.length >= 2) {
    lines.push(`첫 선택은 1위(${recommendations[0].name})로 시작하고, 사용감이 안 맞으면 2위(${recommendations[1].name})로 교체해보세요.`);
  } else if (recommendations.length === 1) {
    lines.push(`우선 1위(${recommendations[0].name})를 3일 정도 사용해보며 밀착감/당김 여부를 체크해보시면 됩니다.`);
  }

  if (recommendations.length >= 3) {
    lines.push(`3위(${recommendations[2].name})는 보완용 카드로 두고, 계절이나 컨디션에 따라 교체해 쓰시면 효율적이에요.`);
  }

  if (promotions.length > 0) {
    lines.push('');
    lines.push('행사 구성은 하단 배너에서 확인 가능하고, 본품 사용감이 맞는지 먼저 확인한 뒤 선택하시는 걸 권장드려요.');
  }

  if (Array.isArray(referenceRecommendations) && referenceRecommendations.length > 0) {
    lines.push('');
    lines.push('참고용 추천은 다른 제형 대안입니다. 메인 제품이 답답하거나 밀릴 때 교체 옵션으로 활용해보세요.');
  }

  lines.push('');
  lines.push('원하시면 다음 답변에서 아침/야외활동/메이크업 전 3상황으로 나눠, 제품별 바르는 양과 순서를 더 구체적으로 맞춰드릴게요.');
  return lines.join('\n');
}

function buildConsultNarrativeV3(recommendations, promotions = [], referenceRecommendations = [], args = {}) {
  const lines = [];
  const skinType = String(args.skin_type || '').trim();
  const concernText = Array.isArray(args.concerns) && args.concerns.length > 0 ? args.concerns.join(', ') : '';
  const categoryText = String(args.category || '').trim();

  lines.push('상단 카드에는 제품별 근거를 담아두었고, 아래에서는 실제 사용 방법 중심으로 안내드릴게요.');
  lines.push('');

  const conditionLabel = [skinType ? `${skinType} 피부` : '', concernText || '', categoryText || '']
    .filter(Boolean)
    .join(' / ');
  if (conditionLabel) {
    lines.push(`현재 조건(${conditionLabel}) 기준으로, 밀착력과 사용 편의성을 함께 고려해 구성했습니다.`);
    lines.push('');
  }

  lines.push('사용은 아래 순서로 진행해보세요.');
  lines.push('1) 아침: 1위 제품을 얇게 2회 레이어링해서 밀착');
  lines.push('2) 낮 시간: 유분/땀이 올라오면 문지르지 말고 가볍게 덧바르기');
  lines.push('3) 저녁: 자극감이 느껴진 날은 진정 위주 스킨케어로 마무리');
  lines.push('');

  if (recommendations.length >= 2) {
    lines.push(`첫 선택은 1위(${recommendations[0].name})로 시작하고, 사용감이 안 맞으면 2위(${recommendations[1].name})로 교체해보세요.`);
  } else if (recommendations.length === 1) {
    lines.push(`우선 1위(${recommendations[0].name})를 3일 정도 사용해보며 밀착감/당김 여부를 체크해보시면 됩니다.`);
  }
  if (recommendations.length >= 3) {
    lines.push(`3위(${recommendations[2].name})는 보완용 카드로 두고, 계절이나 컨디션에 따라 교체해 쓰시면 효율적이에요.`);
  }

  if (promotions.length > 0) {
    lines.push('');
    lines.push('행사 구성은 하단 배너에서 확인 가능하고, 본품 사용감이 맞는지 먼저 확인한 뒤 선택하시는 걸 권장드려요.');
  }
  if (Array.isArray(referenceRecommendations) && referenceRecommendations.length > 0) {
    lines.push('');
    lines.push('참고용 추천은 다른 제형 대안입니다. 메인 제품이 답답하거나 밀릴 때 교체 옵션으로 활용해보세요.');
  }

  lines.push('');
  lines.push(`- 원하는 가격대 있으신가요?${skinType ? ` ${skinType} 피부 기준으로` : ''} 예산에 맞춰 루틴을 맞춤으로 구성해드릴게요.`);
  lines.push('- 같이 쓰면 좋은 제품(예: 토너/수분크림/진정템)도 묶어서 추천해드릴까요?');

  return lines.join('\n');
}

function buildFollowUpQuestions(args = {}) {
  const skinType = String(args.skin_type || '').trim();
  return [
    `원하는 가격대 있으신가요?${skinType ? ` ${skinType} 피부 기준으로` : ''} 예산에 맞춰 루틴을 맞춤으로 구성해드릴게요.`,
    '같이 쓰면 좋은 제품(예: 토너/수분크림/진정템)도 묶어서 추천해드릴까요?',
  ];
}

function buildConsultNarrativeV4(recommendations, promotions = [], referenceRecommendations = [], args = {}) {
  const lines = [];
  const skinType = String(args.skin_type || '').trim();
  const concerns = Array.isArray(args.concerns) ? args.concerns.filter(Boolean) : [];

  const condition = [skinType ? `${skinType} 피부` : '', concerns.length ? `고민: ${concerns.join(', ')}` : '']
    .filter(Boolean)
    .join(' / ');
  if (condition) {
    lines.push(`요청 조건(${condition}) 기준으로 다시 정리해드릴게요.`);
    lines.push('');
  }

  recommendations.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.name}`);
    lines.push(`- 추천 이유: ${item.why_pick || item.key_point || '요청 조건과의 일치도가 높은 후보예요.'}`);
    lines.push(`- 사용 팁: ${item.usage_tip || '기초 마지막 단계에서 2~3회 나눠 바르면 밀림이 덜해요.'}`);
    if (item.caution) lines.push(`- 체크 포인트: ${item.caution}`);
    lines.push('');
  });

  if (promotions.length > 0) {
    lines.push('행사 구성은 카드 아래 배너에서 같이 확인하실 수 있어요.');
    lines.push('');
  }

  if (Array.isArray(referenceRecommendations) && referenceRecommendations.length > 0) {
    lines.push('지금 추천이 사용감과 맞지 않으면 참고용 다른 제형 후보로 바로 바꿔드릴 수 있어요.');
    lines.push('');
  }

  lines.push('원하시면 다음 단계로 이어서 도와드릴게요.');
  lines.push('- 예산에 맞춘 2~3개 루틴 조합');
  lines.push('- 오전/야외/메이크업용으로 상황별 분리 추천');
  return lines.join('\n');
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

function computeEnrichMaxFetch(args = {}) {
  const concerns = Array.isArray(args.concerns) ? args.concerns : [];
  const mergedText = [
    args.category || '',
    args.skin_type || '',
    args.q || '',
    args.query || '',
    concerns.join(' '),
  ]
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
  if (enrichMaxFetch > 0) {
    logger.info(`[Tool Exec] Hybrid enrich enabled: maxFetch=${enrichMaxFetch}`);
  }
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
    recommendations,
    promotions,
    summary,
    reference_recommendations: referenceRecommendations = [],
  } = result;
  const safeSummary = summary || { message: '조건에 맞는 상품을 찾지 못했습니다.' };

  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    return {
      content: [{ type: 'text', text: safeSummary.message }],
      structuredContent: {
        requested_category: requestedCategory,
        main_recommendations: [],
        secondary_recommendations: [],
        reasoning_tags: reasoningTags,
        applied_policy: appliedPolicy,
        recommendations: [],
        promotions: [],
        reference_recommendations: [],
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
          promotions: [],
          reference_recommendations: [],
          summary: safeSummary,
        },
      },
    };
  }

  const consultText = buildConsultNarrativeV4(
    recommendations,
    promotions || [],
    referenceRecommendations || [],
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
