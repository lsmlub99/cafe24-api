import React, { useEffect, useRef, useState } from 'react';
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

function CardText({ label, text }) {
  if (!text) return null;
  return (
    <div style={{ fontSize: '0.82rem', color: '#444', marginBottom: '8px', lineHeight: '1.55' }}>
      <strong>{label}:</strong> {text}
    </div>
  );
}

const FORBIDDEN_COPY_TERMS = ['점수', '의미 매칭', '알고리즘', '추천 로직', '모델', '요청 상황과 잘 맞는 추천'];

const FOLLOW_UP_CTAS = ['번들거림 적은 제품만 다시 보기', '민감성 기준으로 다시 좁히기', '톤업 없는 제품만 보기'];

function removeForbiddenCopy(text = '') {
  let out = String(text || '').trim();
  FORBIDDEN_COPY_TERMS.forEach((term) => {
    out = out.replaceAll(term, '');
  });
  return out.replace(/\s{2,}/g, ' ').trim();
}

function trimReasonText(text = '', max = 26) {
  const source = removeForbiddenCopy(text);
  if (!source) return '';
  return source.length > max ? `${source.slice(0, max - 1)}…` : source;
}

function toneFromReasonCode(item = {}, rank = 1) {
  const reasonCode = String(item.reason_code || '');
  const rawWhy = String(item.why_pick || item.key_point || '');
  const why = removeForbiddenCopy(rawWhy);
  const lowerName = String(item.name || '').toLowerCase();
  const form = String(item.form || '').toLowerCase();

  const hasTone = lowerName.includes('토닝') || lowerName.includes('톤') || lowerName.includes('bb');
  const isSpray = form.includes('spray') || lowerName.includes('스프레이');
  const isStick = form.includes('stick') || lowerName.includes('스틱');
  const isSerum = form.includes('serum') || lowerName.includes('세럼');

  if (reasonCode === 'SEMANTIC_MATCH') {
    if (hasTone) {
      return rank === 1
        ? { core: '톤 보정까지 챙기기 좋은 타입', support: '피부 표현을 정리하고 싶을 때 보기 좋아요.' }
        : { core: '톤업 필요할 때 고르기 좋음', support: '데일리 톤 보정용으로 비교해보기 좋아요.' };
    }
    if (isSpray) return { core: '가볍게 덧바르기 편한 타입', support: '외출 중 빠르게 보충하기 좋은 제형이에요.' };
    if (isStick) return { core: '보송하게 수정하기 쉬운 타입', support: '번들거림이 올라올 때 빠르게 쓰기 좋아요.' };
    if (isSerum) return { core: '얇고 가벼운 밀착감 중심', support: '무거운 크림이 부담될 때 선택하기 좋아요.' };
    return rank === 1
      ? { core: '데일리로 쓰기 편한 사용감', support: '처음 고를 때 부담이 적은 기본형에 가까워요.' }
      : { core: '가볍고 번들거림 부담 적음', support: '답답함을 줄여서 쓰고 싶을 때 비교하기 좋아요.' };
  }

  if (reasonCode === 'CONDITION_MATCH') {
    if (rank === 1) {
      return {
        core: trimReasonText(why, 26) || '피부 고민에 맞춰 고른 1순위',
        support: '현재 조건에서 가장 무난한 데일리 후보로 보기 좋아요.',
      };
    }
    if (rank === 2) {
      return {
        core: '사용감 기준으로 비교할 대안',
        support: '1순위와 결은 비슷하지만 체감 사용감이 더 가벼운 편이에요.',
      };
    }
    return {
      core: '보조 목적까지 함께 볼 후보',
      support: '톤 보정이나 덧바름 목적이 있으면 비교해볼 만해요.',
    };
  }

  if (rank === 1) return { core: '무난한 데일리 기본형', support: '처음 시작할 때 실패 부담이 적은 쪽이에요.' };
  if (rank === 2) return { core: '산뜻한 사용감 중심 대안', support: '가벼운 발림감을 원할 때 비교해보기 좋아요.' };
  return { core: '특정 목적용으로 비교할 후보', support: '상황에 따라 보조 선택지로 보기 좋아요.' };
}

function buildCardCopy(item = {}, rank = 1) {
  const mapped = toneFromReasonCode(item, rank);
  const tip = removeForbiddenCopy(item.usage_tip || '');

  return {
    coreReason: trimReasonText(mapped.core, 26) || '무난한 데일리 기본형',
    supportReason: removeForbiddenCopy(mapped.support) || '데일리로 사용하기 좋은 타입이에요.',
    usageTip: trimReasonText(tip || '기초 마지막 단계에서 얇게 2~3회 나눠 바르세요.', 52),
  };
}

function buildSelectionGuide(recommendations = []) {
  const [a, b, c] = recommendations;
  const used = new Set();
  const uniqueLine = (preferred, fallback) => {
    if (!used.has(preferred)) {
      used.add(preferred);
      return preferred;
    }
    used.add(fallback);
    return fallback;
  };

  const toLine = (item, rank) => {
    if (!item) return `${rank}번: 비슷한 조건에서 대안으로 비교할 때`;
    const name = String(item.name || '').toLowerCase();
    const form = String(item.form || '').toLowerCase();

    if (rank === 1) return uniqueLine('1번: 매일 무난하게 쓸 제품이 필요할 때', '1번: 먼저 실패 부담이 적은 쪽부터 볼 때');
    if (rank === 2) {
      if (form.includes('spray') || name.includes('스프레이')) {
        return uniqueLine('2번: 외출 중 덧바름 편의가 중요할 때', '2번: 사용감 차이를 비교해보고 싶을 때');
      }
      if (form.includes('serum') || name.includes('세럼')) {
        return uniqueLine('2번: 더 얇고 가벼운 발림감을 원할 때', '2번: 1번이 무겁게 느껴질 때 대안으로');
      }
      if (form.includes('stick') || name.includes('스틱')) {
        return uniqueLine('2번: 보송하게 빠른 수정이 필요할 때', '2번: 번들거림 관리용 대안이 필요할 때');
      }
      return uniqueLine('2번: 1번보다 산뜻한 사용감을 원할 때', '2번: 체감 사용감 기준으로 대안이 필요할 때');
    }

    if (name.includes('토닝') || name.includes('톤') || name.includes('bb')) {
      return uniqueLine('3번: 톤 보정이 필요한 날에 선택', '3번: 보정 목적까지 함께 고려할 때');
    }
    return uniqueLine('3번: 덧바름/보조 목적까지 같이 볼 때', '3번: 상황별 보조 선택지가 필요할 때');
  };

  return [toLine(a, 1), toLine(b, 2), toLine(c, 3)];
}

function buildGuideContextLine(widgetData = {}) {
  const tags = Array.isArray(widgetData.reasoning_tags) ? widgetData.reasoning_tags : [];
  const hasOily = tags.includes('skin_type:oily') || tags.includes('skin_type:combination');
  const hasDry = tags.includes('skin_type:dry');
  const hasSensitive = tags.includes('skin_type:sensitive');
  const hasSebum = tags.includes('concern:sebum_control');
  const hasHydration = tags.includes('concern:hydration');
  const hasSoothing = tags.includes('concern:soothing');

  if (hasSensitive || hasSoothing) return '민감 피부 기준에서는 자극 부담이 적은 타입부터 비교해보세요.';
  if (hasOily || hasSebum) return '지성/수부지 기준에서는 번들거림 부담이 적은 타입부터 비교해보세요.';
  if (hasDry || hasHydration) return '건성 기준에서는 당김 부담이 적은 촉촉한 타입부터 비교해보세요.';
  return '평소 메이크업/외출 패턴에 맞춰 1번부터 순서대로 비교해보세요.';
}

function App() {
  const [messages, setMessages] = useState([{ id: 1, type: 'bot', text: '안녕하세요. 셀퓨전씨 AI 뷰티 가이드입니다. 무엇을 추천해드릴까요?' }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [widgetData, setWidgetData] = useState(null);

  const messagesEndRef = useRef(null);
  const lastWidgetSignatureRef = useRef('');
  const fallbackPollRef = useRef(null);
  const widgetDataRef = useRef(null);

  const openBuyLink = async (href) => {
    if (!href) return;
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

  if (isWidgetMode && widgetData?.recommendations?.length) {
    return (
      <div className="widget-container" style={{ padding: '16px', background: '#fff', borderRadius: '12px' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#B31312', marginBottom: '16px' }}>
          <Sparkles size={18} fill="#B31312" />
          셀퓨전씨 AI 맞춤 추천
        </h3>

        <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '12px', WebkitOverflowScrolling: 'touch' }}>
          {widgetData.recommendations.map((product, idx) => {
            const cardCopy = buildCardCopy(product, idx + 1);
            return (
              <div
                key={`${product.buy_url || product.name}-${idx}`}
                style={{ minWidth: '260px', maxWidth: '300px', border: '1px solid #eee', borderRadius: '12px', padding: '14px', background: '#fff' }}
              >
                <div style={{ fontSize: '0.78rem', fontWeight: 'bold', color: '#B31312', marginBottom: '8px' }}>{idx === 0 ? '🏅 BEST' : `${idx + 1}위`}</div>
                <img src={product.image} alt={product.name} style={{ width: '100%', height: '150px', objectFit: 'contain', marginBottom: '12px' }} />
                <div style={{ fontWeight: 'bold', fontSize: '1.02rem', marginBottom: '6px', minHeight: '54px' }}>{product.name}</div>
                <div style={{ color: '#666', fontSize: '0.95rem', marginBottom: '12px' }}>{product.price ? `${product.price}원` : ''}</div>

                <div style={{ minHeight: '132px' }}>
                  <CardText label="핵심 포인트" text={cardCopy.coreReason} />
                  <CardText label="추천 이유" text={cardCopy.supportReason} />
                  <CardText label="사용 팁" text={cardCopy.usageTip} />
                </div>

                <button
                  type="button"
                  onClick={() => openBuyLink(product.buy_url)}
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
                  지금 구매하기
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
                  onClick={() => openBuyLink(product.buy_url)}
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
                  onClick={() => openBuyLink(product.buy_url)}
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
            {buildSelectionGuide(widgetData.recommendations).map((line, idx) => (
              <div key={`guide-${idx}`} style={{ fontSize: '0.86rem', color: '#444', marginBottom: '6px', lineHeight: 1.5 }}>
                {line}
              </div>
            ))}
            <div style={{ fontSize: '0.85rem', color: '#555', marginTop: '8px', lineHeight: 1.5 }}>{buildGuideContextLine(widgetData)}</div>
          </div>
        )}

        <div style={{ marginTop: '14px', borderTop: '1px solid #eee', paddingTop: '12px' }}>
          <div style={{ fontWeight: 700, color: '#333', marginBottom: '8px', fontSize: '0.92rem' }}>다음으로 이렇게 좁혀볼 수 있어요</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {FOLLOW_UP_CTAS.map((label) => (
              <button
                key={label}
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(label);
                  } catch {
                    // no-op
                  }
                }}
                style={{
                  border: '1px solid #ddd',
                  background: '#fff',
                  color: '#444',
                  fontSize: '0.82rem',
                  borderRadius: '999px',
                  padding: '6px 10px',
                  cursor: 'pointer',
                }}
                title="클릭하면 문구가 복사됩니다"
              >
                {label}
              </button>
            ))}
          </div>
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
                  <div key={`${product.buy_url || product.name}-${idx}`} className="product-card" onClick={() => openBuyLink(product.buy_url)}>
                    <div className="rank-badge">{idx === 0 ? '🏅 BEST' : `${idx + 1}위`}</div>
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
          placeholder="원하는 타입이나 피부 고민을 알려주세요"
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
