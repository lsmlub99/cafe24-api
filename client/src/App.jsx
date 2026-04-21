import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Send, Sparkles } from 'lucide-react';

function tryParseJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function findStructuredCandidate(node, depth = 0) {
  if (!node || depth > 6) return null;
  const parsed = tryParseJson(node);

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = findStructuredCandidate(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (!isObject(parsed)) return null;
  if (
    Array.isArray(parsed.main_recommendations) ||
    Array.isArray(parsed.secondary_recommendations) ||
    Array.isArray(parsed.recommendations) ||
    Array.isArray(parsed.items) ||
    isObject(parsed.summary)
  ) {
    return parsed;
  }

  const directKeys = ['structuredContent', 'output', 'data', 'result', 'payload', 'toolOutput', '_meta', 'params'];
  for (const key of directKeys) {
    if (parsed[key] == null) continue;
    const found = findStructuredCandidate(parsed[key], depth + 1);
    if (found) return found;
  }

  if (isObject(parsed.widgetData)) {
    const found = findStructuredCandidate(parsed.widgetData, depth + 1);
    if (found) return found;
  }

  for (const value of Object.values(parsed)) {
    const found = findStructuredCandidate(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeWidgetData(raw) {
  const structured = findStructuredCandidate(raw);
  if (!structured) return null;

  const mainRaw = Array.isArray(structured.main_recommendations)
    ? structured.main_recommendations
    : Array.isArray(structured.recommendations)
    ? structured.recommendations
    : Array.isArray(structured.items)
    ? structured.items
    : [];

  const secondaryRaw = Array.isArray(structured.secondary_recommendations)
    ? structured.secondary_recommendations
    : Array.isArray(structured.reference_recommendations)
    ? structured.reference_recommendations
    : [];

  const promotionsRaw = Array.isArray(structured.promotions) ? structured.promotions : [];
  const summary = isObject(structured.summary) ? structured.summary : {};

  const main = mainRaw.filter((item) => isObject(item) && (item.name || item.buy_url || item.image));
  const secondary = secondaryRaw.filter((item) => isObject(item) && (item.name || item.buy_url));
  const promotions = promotionsRaw.filter((item) => isObject(item) && (item.name || item.buy_url));

  return {
    recommendations: main,
    secondary_recommendations: secondary,
    promotions,
    reasoning_tags: Array.isArray(structured.reasoning_tags) ? structured.reasoning_tags : [],
    summary,
    strategy: structured.strategy || summary.strategy || '',
    conclusion: structured.conclusion || summary.conclusion || '',
  };
}

function normalizeText(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function CardText({ label, text }) {
  if (!text) return null;
  return (
    <div style={{ fontSize: '0.82rem', color: '#444', marginBottom: '8px', lineHeight: '1.55' }}>
      <strong>{label}:</strong> {text}
    </div>
  );
}

const FORBIDDEN_COPY_TERMS = ['점수', '의미 매칭', '추천 알고리즘', '모델', '로직 기반', '추천 로직'];
const FOLLOWUP_ERROR_HINT = '요청을 다시 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';

const FOLLOW_UP_CTA_ITEMS = {
  A: [
    { label: '번들거림 적은 제품 다시 보기', query: '번들거림 적은 제품으로 다시 추천해줘', context: 'low_sebum' },
    { label: '민감성 기준으로 다시 좁히기', query: '민감성 피부 기준으로 다시 추천해줘', context: 'sensitive' },
    { label: '톤업 없는 제품만 다시 보기', query: '톤업 없는 제품으로 다시 추천해줘', context: 'no_tone_up' },
  ],
  B: [
    { label: '덜 번들거리는 걸로 다시 볼까요?', query: '번들거림 적은 제품으로 다시 추천해줘', context: 'low_sebum' },
    { label: '민감 피부 기준으로 다시 볼까요?', query: '민감성 피부 기준으로 다시 추천해줘', context: 'sensitive' },
    { label: '톤업 없는 것만 다시 골라드릴까요?', query: '톤업 없는 제품으로 다시 추천해줘', context: 'no_tone_up' },
  ],
};

const FORM_PRIMARY_BENEFIT = {
  cream: '무난한 데일리 사용감',
  lotion: '가볍게 쓰는 데일리형',
  serum: '얇고 가벼운 발림감',
  stick: '수정용으로 편한 타입',
  spray: '빠른 재도포에 편한 타입',
  cushion: '톤 정돈에 편한 타입',
  other: '부담 없이 쓰기 쉬운 타입',
};

const ROLE_BY_RANK = {
  1: ['안정형 데일리 추천', '무난한 데일리형'],
  2: ['비교해보기 좋은 대안형', '조금 더 가볍게 보는 대안형'],
  3: ['취향 따라 고르는 보조형', '상황별로 고르는 보조형'],
};

function removeForbiddenCopy(text = '') {
  let out = normalizeText(text);
  FORBIDDEN_COPY_TERMS.forEach((term) => {
    out = out.replaceAll(term, '');
  });
  return normalizeText(out);
}

function clampText(text = '', max = 26) {
  const src = removeForbiddenCopy(text);
  if (!src) return '';
  return src.length > max ? `${src.slice(0, Math.max(0, max - 1))}…` : src;
}

function detectForm(item = {}) {
  const form = String(item.form || '').toLowerCase();
  const name = String(item.name || '').toLowerCase();
  if (form.includes('spray') || name.includes('스프레이')) return 'spray';
  if (form.includes('stick') || name.includes('스틱')) return 'stick';
  if (form.includes('serum') || name.includes('세럼') || name.includes('앰플')) return 'serum';
  if (form.includes('lotion') || name.includes('로션')) return 'lotion';
  if (form.includes('cushion') || name.includes('쿠션')) return 'cushion';
  if (form.includes('cream') || name.includes('크림') || name.includes('선크림')) return 'cream';
  return 'other';
}

function collectSignals(item = {}) {
  const reasonFacts = isObject(item.reason_facts) ? JSON.stringify(item.reason_facts) : '';
  return normalizeText(
    [
      item.name || '',
      item.key_point || '',
      item.why_pick || '',
      item.usage_tip || '',
      reasonFacts,
      item.reason_code || '',
    ].join(' ')
  ).toLowerCase();
}

function refinePrimaryBenefitOnce(baseBenefit, signals) {
  const rules = [
    { keywords: ['톤업', '톤 보정', '잡티', '화사'], value: '톤 보정이 쉬운 사용감' },
    { keywords: ['보송', '산뜻', '유분', '번들'], value: '번들 부담 적은 사용감' },
    { keywords: ['보습', '수분', '촉촉', '진정'], value: '촉촉한 데일리 사용감' },
    { keywords: ['밀림', '레이어', '메이크업', '밀착'], value: '밀림 부담 적은 밀착감' },
    { keywords: ['수정', '재도포', '휴대', '외출'], value: '수정용으로 편한 사용감' },
  ];

  for (const rule of rules) {
    if (rule.keywords.some((keyword) => signals.includes(keyword))) {
      return rule.value;
    }
  }
  return baseBenefit;
}

function pickSecondaryBenefit(signals) {
  if (signals.includes('번들') || signals.includes('유분')) return '번들거림 부담이 적은 편';
  if (signals.includes('밀림') || signals.includes('레이어') || signals.includes('밀착')) return '덧발라도 밀림 부담이 적은 편';
  if (signals.includes('톤업') || signals.includes('톤 보정') || signals.includes('잡티')) return '피부 표현이 자연스러운 편';
  return '부담 없이 쓰기 쉬운 편';
}

function pickUsageContext(formKey, signals) {
  if (signals.includes('톤업') || signals.includes('톤 보정')) return '톤 보정이 필요한 날';
  if (signals.includes('메이크업') || signals.includes('밀림')) return '메이크업 전 단계에서';
  if (formKey === 'spray' || formKey === 'stick' || signals.includes('수정') || signals.includes('외출')) return '외출 중 수정용으로';
  if (signals.includes('가벼') || signals.includes('산뜻')) return '가볍게 쓰고 싶을 때';
  return '매일 데일리로 사용할 때';
}

function buildCardSlots(item = {}, rank = 1) {
  const formKey = detectForm(item);
  const rankRole = ROLE_BY_RANK[rank]?.[0] || '무난한 기본형';
  const signals = collectSignals(item);
  const baseBenefit = FORM_PRIMARY_BENEFIT[formKey] || FORM_PRIMARY_BENEFIT.other;
  const primaryBenefit = refinePrimaryBenefitOnce(baseBenefit, signals);
  const secondaryBenefit = pickSecondaryBenefit(signals);
  const usageContext = pickUsageContext(formKey, signals);

  return { rankRole, formKey, primaryBenefit, secondaryBenefit, usageContext };
}

function buildCardCopyFromSlots(slots = {}, item = {}) {
  const rawCore = `${slots.rankRole} · ${slots.primaryBenefit}`;
  const supportReason = `${slots.usageContext} ${slots.secondaryBenefit}이에요.`;
  const usageTip = clampText(item.usage_tip || '기초 마지막 단계에서 얇게 2~3회 나눠 바르면 밀착감이 좋아져요.', 52);

  return {
    coreReason: clampText(rawCore, 26) || '무난하게 쓰기 좋은 데일리형',
    supportReason: clampText(supportReason, 70) || '부담 없이 매일 쓰기 좋은 사용감이에요.',
    usageTip,
  };
}

function isNearlySameSlots(a = {}, b = {}) {
  return a.primaryBenefit === b.primaryBenefit && a.secondaryBenefit === b.secondaryBenefit && a.usageContext === b.usageContext;
}

function applySecondRankAlternative(slots = {}) {
  return {
    ...slots,
    rankRole: ROLE_BY_RANK[2]?.[1] || '조금 더 가볍게 보는 대안형',
    usageContext: slots.formKey === 'stick' || slots.formKey === 'spray' ? '외출 중 수정이 필요할 때' : '첫 후보가 무겁게 느껴질 때',
  };
}

function buildCardCopies(recommendations = []) {
  const slotsList = recommendations.map((item, idx) => buildCardSlots(item, idx + 1));

  if (slotsList.length >= 2 && isNearlySameSlots(slotsList[0], slotsList[1])) {
    slotsList[1] = applySecondRankAlternative(slotsList[1]);
  }

  return recommendations.map((item, idx) => buildCardCopyFromSlots(slotsList[idx], item));
}

function buildSelectionGuide(recommendations = []) {
  const lines = recommendations.slice(0, 3).map((item, idx) => {
    const rank = idx + 1;
    const formKey = detectForm(item);
    const signals = collectSignals(item);

    let line = '';
    if (rank === 1) {
      line = '1번: 매일 무난하게 쓸 기본형이 필요할 때';
    } else if (rank === 2) {
      if (formKey === 'serum') line = '2번: 더 가볍고 얇은 발림을 원할 때';
      else if (formKey === 'stick') line = '2번: 보송한 수정용을 함께 챙길 때';
      else if (formKey === 'spray') line = '2번: 빠른 재도포 편의가 중요할 때';
      else if (signals.includes('톤업') || signals.includes('톤 보정')) line = '2번: 톤 보정까지 같이 보고 싶을 때';
      else line = '2번: 1번보다 가벼운 대안을 보고 싶을 때';
    } else {
      if (signals.includes('톤업') || signals.includes('톤 보정')) line = '3번: 피부 보정 목적을 추가로 챙길 때';
      else if (formKey === 'stick' || formKey === 'spray') line = '3번: 외출 중 덧바름 용도를 같이 볼 때';
      else line = '3번: 상황별 보조 옵션까지 비교할 때';
    }
    return clampText(line, 34);
  });

  while (lines.length < 3) {
    lines.push(`${lines.length + 1}번: 비슷한 조건의 대안을 더 볼 때`);
  }

  return lines;
}

function buildGuideContextLine(widgetData = {}) {
  const tags = Array.isArray(widgetData.reasoning_tags) ? widgetData.reasoning_tags : [];
  const hasOily = tags.includes('skin_type:oily') || tags.includes('skin_type:combination');
  const hasDry = tags.includes('skin_type:dry');
  const hasSensitive = tags.includes('skin_type:sensitive');
  const hasSebum = tags.includes('concern:sebum_control');
  const hasHydration = tags.includes('concern:hydration');
  const hasSoothing = tags.includes('concern:soothing');

  if (hasSensitive || hasSoothing) return '민감 신호가 있으면 자극 부담이 적은 후보부터 선택해 보세요.';
  if (hasOily || hasSebum) return '지성/수부지라면 번들거림이 적은 후보를 먼저 비교해 보세요.';
  if (hasDry || hasHydration) return '건성이라면 보습감이 편한 후보를 먼저 보는 편이 좋아요.';
  return '메인 용도와 덧바름 용도를 나눠서 1~3번을 비교해 보세요.';
}

function buildDecisionNudge(recommendations = []) {
  if (!recommendations.length) return '';
  const first = recommendations[0];
  const signals = collectSignals(first);
  if (signals.includes('톤업') || signals.includes('톤 보정')) return '차이가 헷갈리면 1번부터 비교해 보시는 게 가장 안전해요.';
  return '고민된다면 1번부터 시작해 보는 쪽이 가장 무난해요.';
}

function getProductIdFromUrl(url = '') {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('product_no') || '';
  } catch {
    return '';
  }
}

function hashString(input = '') {
  let hash = 2166136261;
  const s = String(input || '');
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

function getOrCreateSessionId() {
  try {
    const key = 'widget_session_id';
    const existing = window.sessionStorage?.getItem(key);
    if (existing) return existing;
    const id = `ws_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    window.sessionStorage?.setItem(key, id);
    return id;
  } catch {
    return `ws_fallback_${Date.now()}`;
  }
}

function pickVariant(experimentKey, sessionId) {
  const h = parseInt(hashString(`${sessionId}:${experimentKey}`), 16);
  return Number.isFinite(h) && h % 2 === 0 ? 'A' : 'B';
}

function getUxVariants(sessionId) {
  return {
    banner: pickVariant('banner', sessionId),
    cta: pickVariant('cta', sessionId),
    buyButton: pickVariant('buyButton', sessionId),
  };
}

function buildRecommendationSignature(widgetData, variants) {
  if (!widgetData?.recommendations?.length) return '';
  const mainIds = widgetData.recommendations.map((p) => getProductIdFromUrl(p.buy_url) || p.name || '').join('|');
  return `${mainIds}::${variants.banner}|${variants.cta}|${variants.buyButton}`;
}

function trackWidgetEvent(name, payload = {}) {
  const event = {
    ts: new Date().toISOString(),
    name,
    ...payload,
  };
  // Future server hook point
  console.info('[Widget Event]', event);
}

function App() {
  const [messages, setMessages] = useState([{ id: 1, type: 'bot', text: '안녕하세요. 셀퓨전씨 AI 뷰티 가이드입니다. 무엇을 추천해드릴까요?' }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [widgetData, setWidgetData] = useState(null);
  const [isFollowupLoading, setIsFollowupLoading] = useState(false);
  const [followupHint, setFollowupHint] = useState('');

  const messagesEndRef = useRef(null);
  const lastWidgetSignatureRef = useRef('');
  const fallbackPollRef = useRef(null);
  const widgetDataRef = useRef(null);
  const sessionIdRef = useRef(getOrCreateSessionId());
  const impressionDedupeRef = useRef(new Set());
  const followupRequestIdRef = useRef(0);
  const followupAbortRef = useRef(null);
  const followupHintTimerRef = useRef(null);

  const variants = useMemo(() => getUxVariants(sessionIdRef.current), []);
  const activeCtas = FOLLOW_UP_CTA_ITEMS[variants.cta] || FOLLOW_UP_CTA_ITEMS.A;

  const clearFollowupHint = () => {
    if (followupHintTimerRef.current) {
      window.clearTimeout(followupHintTimerRef.current);
      followupHintTimerRef.current = null;
    }
    setFollowupHint('');
  };

  const showFollowupHint = (text) => {
    clearFollowupHint();
    setFollowupHint(text);
    followupHintTimerRef.current = window.setTimeout(() => {
      setFollowupHint('');
      followupHintTimerRef.current = null;
    }, 4000);
  };

  const openBuyLink = async (href, rank = null, product = null) => {
    if (!href) return;
    trackWidgetEvent('click_buy_button', {
      rank,
      product_id: getProductIdFromUrl(href),
      product_name: product?.name || null,
      variants,
    });
    try {
      if (window.openai?.openExternal) {
        await window.openai.openExternal({ href });
        return;
      }
    } catch {
      // fallback
    }
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const runFollowupQuery = async (query, context = 'unknown') => {
    if (!query || isFollowupLoading) return;
    clearFollowupHint();

    const nextRequestId = followupRequestIdRef.current + 1;
    followupRequestIdRef.current = nextRequestId;

    if (followupAbortRef.current) {
      try {
        followupAbortRef.current.abort();
      } catch {
        // no-op
      }
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    followupAbortRef.current = controller;
    setIsFollowupLoading(true);

    trackWidgetEvent('click_followup_cta', {
      cta_label: activeCtas.find((x) => x.query === query)?.label || null,
      followup_query: query,
      rank_context: context,
      variants,
    });

    try {
      const response = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: controller?.signal,
      });

      if (nextRequestId !== followupRequestIdRef.current) return;
      if (!response.ok) {
        throw new Error(`http_${response.status}`);
      }

      const payload = await response.json();
      const nextData = normalizeWidgetData(payload);
      if (!nextData) {
        throw new Error('invalid_payload');
      }

      setWidgetData(nextData);
      widgetDataRef.current = nextData;
      clearFollowupHint();
    } catch (error) {
      if (nextRequestId !== followupRequestIdRef.current) return;
      const isAbort = error?.name === 'AbortError';
      if (isAbort) {
        trackWidgetEvent('followup_request_aborted', {
          followup_query: query,
          context,
          variants,
        });
      } else {
        trackWidgetEvent('followup_request_failed', {
          followup_query: query,
          context,
          error_type: String(error?.message || 'unknown'),
          variants,
        });
        // 보수 UX: 기존 추천 유지 + 짧은 힌트만 노출
        showFollowupHint(FOLLOWUP_ERROR_HINT);
      }
    } finally {
      if (nextRequestId === followupRequestIdRef.current) {
        setIsFollowupLoading(false);
      }
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const applyWidgetData = (payload) => {
      const nextData = normalizeWidgetData(payload);
      if (!nextData) return;

      const nextHasRecs = nextData.recommendations.length > 0;
      const currentHasRecs = Array.isArray(widgetDataRef.current?.recommendations) && widgetDataRef.current.recommendations.length > 0;
      if (!nextHasRecs && currentHasRecs) return;

      const signature = JSON.stringify({
        names: nextData.recommendations.map((r) => r?.name || ''),
        promotions: nextData.promotions.map((p) => p?.name || ''),
        secondary: nextData.secondary_recommendations.map((p) => p?.name || ''),
        message: nextData.summary?.message || '',
        strategy: nextData.strategy || '',
        conclusion: nextData.conclusion || '',
      });
      if (signature === lastWidgetSignatureRef.current) return;
      lastWidgetSignatureRef.current = signature;

      setWidgetData(nextData);
      widgetDataRef.current = nextData;
    };

    const handleMessage = (event) => {
      if (!event?.data) return;
      applyWidgetData(event.data);
    };

    window.addEventListener('message', handleMessage);

    const bootstrapCandidates = [
      window.mcpData,
      window.__INITIAL_DATA__,
      window.__MCP_DATA__,
      window.openai?.appData,
      window.openai?.toolOutput,
      window.__TOOL_OUTPUT__,
      window.__WIDGET_DATA__,
    ];
    bootstrapCandidates.forEach((c) => c && applyWidgetData(c));

    fallbackPollRef.current = window.setInterval(() => {
      const candidates = [window.openai?.toolOutput, window.openai?.appData, window.__TOOL_OUTPUT__, window.__WIDGET_DATA__];
      candidates.forEach((c) => c && applyWidgetData(c));
    }, 400);

    const inIframe = window.parent && window.parent !== window;
    if (inIframe) {
      const initId = `init-${Date.now()}`;
      window.parent.postMessage({ jsonrpc: '2.0', id: initId, method: 'ui/initialize', params: { version: '1.0.0' } }, '*');
      window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: { version: '1.0.0' } }, '*');
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      if (fallbackPollRef.current) {
        window.clearInterval(fallbackPollRef.current);
        fallbackPollRef.current = null;
      }
      if (followupAbortRef.current) {
        try {
          followupAbortRef.current.abort();
        } catch {
          // no-op
        }
      }
      clearFollowupHint();
    };
  }, []);

  const handleSend = async () => {
    const query = input.trim();
    if (!query) return;

    setMessages((prev) => [...prev, { id: Date.now(), type: 'user', text: query }]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await response.json();
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          type: 'bot',
          text: data.summary?.message || '고객님을 위한 추천 결과입니다.',
          products: data.recommendations || [],
        },
      ]);
    } catch {
      setMessages((prev) => [...prev, { id: Date.now() + 1, type: 'bot', text: '서버 통신 중 오류가 발생했습니다.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const isWidgetMode = Boolean(window.__WIDGET_MODE__ || window.__MCP_WIDGET__ || widgetData);
  const cardCopies = widgetData?.recommendations?.length ? buildCardCopies(widgetData.recommendations) : [];
  const selectionGuideLines = widgetData?.recommendations?.length ? buildSelectionGuide(widgetData.recommendations) : [];
  const decisionNudge = widgetData?.recommendations?.length ? buildDecisionNudge(widgetData.recommendations) : '';

  useEffect(() => {
    if (!widgetData?.recommendations?.length) return;
    const signature = buildRecommendationSignature(widgetData, variants);
    if (!signature || impressionDedupeRef.current.has(signature)) return;
    impressionDedupeRef.current.add(signature);
    trackWidgetEvent('widget_impression', {
      recommendation_count: widgetData.recommendations.length,
      variants,
    });
  }, [widgetData, variants]);

  if (isWidgetMode && widgetData?.recommendations?.length) {
    return (
      <div className="widget-container" style={{ padding: '16px', background: '#fff', borderRadius: '12px' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#B31312', marginBottom: '16px' }}>
          <Sparkles size={18} fill="#B31312" />
          셀퓨전씨 AI 맞춤 추천
        </h3>

        <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '12px', WebkitOverflowScrolling: 'touch' }}>
          {widgetData.recommendations.map((product, idx) => {
            const rank = idx + 1;
            const cardCopy = cardCopies[idx];
            const isTop = rank === 1;
            const trustLine = isTop
              ? '무난하게 시작하기 좋은 선택이에요.'
              : rank === 2
              ? '1위와 비교해보기 좋은 대안이에요.'
              : '취향이나 상황에 맞춰 고르기 좋아요.';
            const buyButtonLabel = variants.buyButton === 'B' ? '이걸로 시작하기' : '지금 구매하기';

            return (
              <div
                key={`${product.buy_url || product.name}-${idx}`}
                style={{ minWidth: '260px', maxWidth: '300px', border: '1px solid #eee', borderRadius: '12px', padding: '14px', background: '#fff' }}
              >
                <div style={{ fontSize: '0.78rem', fontWeight: 'bold', color: '#B31312', marginBottom: '8px' }}>{isTop ? '🥇 BEST' : `${rank}위`}</div>
                {isTop && variants.banner === 'B' && (
                  <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: '8px', background: '#f7f7f7', borderRadius: '999px', display: 'inline-block', padding: '4px 8px' }}>
                    지금 조건 기준 추천 1순위
                  </div>
                )}
                <img src={product.image} alt={product.name} style={{ width: '100%', height: '150px', objectFit: 'contain', marginBottom: '12px' }} />
                <div style={{ fontWeight: 'bold', fontSize: '1.02rem', marginBottom: '6px', minHeight: '54px' }}>{product.name}</div>
                <div style={{ color: '#666', fontSize: '0.95rem', marginBottom: '12px' }}>{product.price ? `${product.price}원` : ''}</div>

                <div style={{ minHeight: '132px' }}>
                  <CardText label="핵심 포인트" text={cardCopy?.coreReason} />
                  <CardText label="추천 이유" text={cardCopy?.supportReason} />
                  <CardText label="사용 팁" text={cardCopy?.usageTip} />
                </div>

                <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '8px' }}>{trustLine}</div>

                <button
                  type="button"
                  onClick={() => openBuyLink(product.buy_url, rank, product)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'center',
                    background: '#B31312',
                    color: '#fff',
                    padding: '10px',
                    borderRadius: '8px',
                    fontSize: '0.9rem',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                  }}
                >
                  {buyButtonLabel}
                </button>
              </div>
            );
          })}
        </div>

        {widgetData.promotions.length > 0 && (
          <div style={{ marginTop: '14px', borderTop: '1px solid #eee', paddingTop: '12px' }}>
            <div style={{ fontWeight: 700, color: '#B31312', marginBottom: '8px', fontSize: '0.92rem' }}>현재 행사도 함께 진행 중이에요</div>
            {widgetData.promotions.map((product, idx) => (
              <div key={`${product.buy_url || product.name}-${idx}`} style={{ fontSize: '0.84rem', marginBottom: '6px', color: '#444' }}>
                <button
                  type="button"
                  onClick={() => openBuyLink(product.buy_url, null, product)}
                  style={{ color: '#444', textDecoration: 'underline', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', font: 'inherit' }}
                >
                  {product.name}
                </button>
                {product.price ? ` · ${product.price}원` : ''}
              </div>
            ))}
          </div>
        )}

        {widgetData.secondary_recommendations.length > 0 && (
          <div style={{ marginTop: '14px', borderTop: '1px solid #eee', paddingTop: '12px' }}>
            <div style={{ fontWeight: 700, color: '#555', marginBottom: '8px', fontSize: '0.9rem' }}>참고용 추천 (다른 제형)</div>
            {widgetData.secondary_recommendations.map((product, idx) => (
              <div key={`${product.buy_url || product.name}-ref-${idx}`} style={{ fontSize: '0.84rem', marginBottom: '6px', color: '#444' }}>
                <button
                  type="button"
                  onClick={() => openBuyLink(product.buy_url, null, product)}
                  style={{ color: '#444', textDecoration: 'underline', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', font: 'inherit' }}
                >
                  {product.name}
                </button>
                {product.price ? ` · ${product.price}원` : ''}
              </div>
            ))}
          </div>
        )}

        {widgetData.recommendations.length > 0 && (
          <div style={{ marginTop: '14px', borderTop: '1px solid #eee', paddingTop: '12px' }}>
            <div style={{ fontWeight: 700, color: '#333', marginBottom: '8px', fontSize: '0.92rem' }}>선택 가이드</div>
            {selectionGuideLines.map((line, idx) => (
              <div key={`guide-${idx}`} style={{ fontSize: '0.86rem', color: '#444', marginBottom: '6px', lineHeight: 1.5 }}>
                {line}
              </div>
            ))}
            <div style={{ fontSize: '0.85rem', color: '#555', marginTop: '8px', lineHeight: 1.5 }}>{buildGuideContextLine(widgetData)}</div>
            {decisionNudge && <div style={{ fontSize: '0.85rem', color: '#444', marginTop: '8px', fontWeight: 600 }}>{decisionNudge}</div>}
          </div>
        )}

        <div style={{ marginTop: '14px', borderTop: '1px solid #eee', paddingTop: '12px' }}>
          <div style={{ fontWeight: 700, color: '#333', marginBottom: '8px', fontSize: '0.92rem' }}>다음으로 이렇게 좁혀보세요</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {activeCtas.map((cta) => (
              <button
                key={cta.label}
                type="button"
                disabled={isFollowupLoading}
                onClick={() => runFollowupQuery(cta.query, cta.context)}
                style={{
                  border: '1px solid #ddd',
                  background: isFollowupLoading ? '#f5f5f5' : '#fff',
                  color: isFollowupLoading ? '#999' : '#444',
                  fontSize: '0.82rem',
                  borderRadius: '999px',
                  padding: '6px 10px',
                  cursor: isFollowupLoading ? 'not-allowed' : 'pointer',
                }}
                title={isFollowupLoading ? '추천을 다시 불러오는 중입니다.' : '클릭하면 바로 다시 추천해드립니다.'}
              >
                {cta.label}
              </button>
            ))}
          </div>
          {isFollowupLoading && <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '8px' }}>추천을 다시 불러오는 중입니다...</div>}
          {followupHint && <div style={{ fontSize: '0.8rem', color: '#B31312', marginTop: '8px' }}>{followupHint}</div>}
        </div>

        {widgetData.conclusion && (
          <div style={{ marginTop: '16px', fontSize: '0.86rem', color: '#444', fontStyle: 'italic', borderTop: '1px solid #eee', paddingTop: '12px' }}>
            {widgetData.conclusion}
          </div>
        )}
      </div>
    );
  }

  if (isWidgetMode) {
    if (widgetData) {
      return (
        <div style={{ padding: '20px', color: '#555' }}>
          <h4 style={{ color: '#B31312', marginBottom: '10px' }}>추천 결과</h4>
          <div>{widgetData.summary?.message || '조건에 맞는 결과를 찾지 못했어요.'}</div>
        </div>
      );
    }
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        <Sparkles size={24} style={{ marginBottom: '10px', opacity: 0.5 }} />
        <div>맞춤 추천 정보를 불러오는 중입니다...</div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="header">
        <div className="logo-icon">
          <Sparkles size={20} fill="currentColor" />
        </div>
        <div className="header-title">CELLFUSION C</div>
      </header>

      <main className="messages-container">
        {messages.map((msg) => (
          <div key={msg.id} className="message-wrapper">
            <div className={`message-bubble message-${msg.type}`}>{msg.text}</div>
            {Array.isArray(msg.products) && msg.products.length > 0 && (
              <div className="carousel-container">
                {msg.products.map((product, idx) => (
                  <div key={`${product.buy_url || product.name}-${idx}`} className="product-card" onClick={() => openBuyLink(product.buy_url, idx + 1, product)}>
                    <div className="rank-badge">{idx === 0 ? '🥇 BEST' : `${idx + 1}위`}</div>
                    <img src={product.image} alt={product.name} className="product-img" />
                    <div className="product-name">{product.name}</div>
                    <div className="product-price">{product.price ? `${product.price}원` : ''}</div>
                    <button className="buy-button">
                      지금 구매 <ChevronRight size={14} style={{ display: 'inline', verticalAlign: 'middle' }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {isLoading && <div className="message-bubble message-bot">분석 중...</div>}
        <div ref={messagesEndRef} />
      </main>

      <footer className="input-area">
        <input
          type="text"
          className="chat-input"
          placeholder="원하시는 타입이나 고민을 알려주세요."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <button className="send-button" onClick={handleSend} disabled={isLoading}>
          <Send size={20} />
        </button>
      </footer>
    </div>
  );
}

export default App;
