function isTruthyEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function buildMinimalStructuredContent(bodyTemplateVersion = 'fixed_v1') {
  return {
    status: 'ok',
    display_mode: 'widget',
    body_template_version: bodyTemplateVersion,
  };
}

function buildLegacyStructuredContent({
  requestedCategory = null,
  canonicalMain = [],
  canonicalSecondary = [],
  reasoningTags = [],
  appliedPolicy = {},
  promotions = [],
  safeSummary = {},
}) {
  return {
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
  };
}

function buildWidgetData({
  requestedCategory = null,
  canonicalMain = [],
  canonicalSecondary = [],
  reasoningTags = [],
  appliedPolicy = {},
  promotions = [],
  safeSummary = {},
}) {
  return {
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
  };
}

function buildSafeBodyText(consultText = '') {
  const text = String(consultText || '').trim();
  return text || '조건에 맞는 제품을 찾지 못했어요.';
}

export function buildMcpToolResult({
  requestedCategory = null,
  canonicalMain = [],
  canonicalSecondary = [],
  reasoningTags = [],
  appliedPolicy = {},
  promotions = [],
  safeSummary = {},
  consultText = '',
  bodyTemplateVersion = 'fixed_v1',
  widgetHttpUri = '',
  minimalStructuredEnv = process.env.MCP_MINIMAL_STRUCTURED,
} = {}) {
  const structuredContent = isTruthyEnv(minimalStructuredEnv)
    ? buildMinimalStructuredContent(bodyTemplateVersion)
    : buildLegacyStructuredContent({
        requestedCategory,
        canonicalMain,
        canonicalSecondary,
        reasoningTags,
        appliedPolicy,
        promotions,
        safeSummary,
      });

  return {
    content: [{ type: 'text', text: buildSafeBodyText(consultText) }],
    structuredContent,
    _meta: {
      ui: { resourceUri: widgetHttpUri },
      'openai/outputTemplate': widgetHttpUri,
      'openai/widgetAccessible': true,
      widgetData: buildWidgetData({
        requestedCategory,
        canonicalMain,
        canonicalSecondary,
        reasoningTags,
        appliedPolicy,
        promotions,
        safeSummary,
      }),
    },
  };
}

