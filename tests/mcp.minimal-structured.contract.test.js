import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMcpToolResult } from '../routes/mcpResponseContract.js';

const FORBIDDEN_STRUCTURED_FIELDS = [
  'recommendations',
  'main_recommendations',
  'secondary_recommendations',
  'reference_recommendations',
  'promotions',
  'summary',
  'strategy',
  'conclusion',
  'why_pick',
  'usage_tip',
  'caution',
  'price',
  'rank',
  'rank_label',
  'buy_url',
  'image',
  'reason_facts',
  'reasoning_tags',
  'applied_policy',
];

function buildSampleMain() {
  return [
    {
      rank: 1,
      name: '레이저 UV 썬스크린 50ml',
      form: 'cream',
      price: '17,000원',
      why_pick: '데일리로 무난한 사용감',
      usage_tip: '얇게 2~3회 나눠 바르기',
      buy_url: 'https://cellfusionc.co.kr/product/detail.html?product_no=1',
      image: 'https://cellfusionc.co.kr/image.jpg',
    },
    {
      rank: 2,
      name: '아쿠아티카 쿨링 썬스크린 50ml',
      form: 'cream',
      price: '16,900원',
    },
  ];
}

test('MCP_MINIMAL_STRUCTURED=1이면 structuredContent는 최소 키만 유지한다', () => {
  const prev = process.env.MCP_MINIMAL_STRUCTURED;
  try {
    process.env.MCP_MINIMAL_STRUCTURED = '1';

    const canonicalMain = buildSampleMain();
    const consultText = '선크림은 현재 2가지가 있어요. 사용 목적에 따라 이렇게 고르면 쉬워요.';
    const toolResult = buildMcpToolResult({
      requestedCategory: 'sunscreen',
      canonicalMain,
      canonicalSecondary: [],
      reasoningTags: ['category:sunscreen', 'form:cream'],
      appliedPolicy: { category_locked: true, form_locked: true },
      promotions: [],
      safeSummary: {
        message: '고객님을 위한 최적 상품입니다.',
        strategy: '요청 카테고리 내에서 정렬했습니다.',
        conclusion: '레이저 UV 썬스크린 50ml 제품이 적합합니다.',
      },
      consultText,
      bodyTemplateVersion: 'fixed_v1',
      widgetHttpUri: 'https://cafe24-api.onrender.com/ui/recommendation',
      minimalStructuredEnv: process.env.MCP_MINIMAL_STRUCTURED,
    });

    const structured = toolResult.structuredContent || {};
    assert.deepStrictEqual(
      Object.keys(structured).sort(),
      ['body_template_version', 'display_mode', 'status'].sort()
    );
    assert.equal(structured.body_template_version, 'fixed_v1');

    for (const key of FORBIDDEN_STRUCTURED_FIELDS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(structured, key),
        false,
        `structuredContent must not include ${key}`
      );
    }

    assert.equal(toolResult.content[0].type, 'text');
    assert.equal(typeof toolResult.content[0].text, 'string');
    assert.equal(toolResult.content[0].text.length > 0, true);
    assert.equal(toolResult.content[0].text.includes('|---'), false);
    assert.equal(toolResult.content[0].text.includes('```'), false);

    assert.equal(Array.isArray(toolResult?._meta?.widgetData?.main_recommendations), true);
    assert.equal(
      Array.isArray(toolResult?._meta?.widgetData?.recommendations) &&
        toolResult._meta.widgetData.recommendations.length > 0,
      true
    );
  } finally {
    if (prev === undefined) {
      delete process.env.MCP_MINIMAL_STRUCTURED;
    } else {
      process.env.MCP_MINIMAL_STRUCTURED = prev;
    }
  }
});
