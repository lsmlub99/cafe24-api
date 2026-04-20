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

const FOLLOW_UP_CTAS = [
  '\uBC88\uB4E4\uAC70\uB9BC \uC801\uC740 \uC81C\uD488\uB9CC \uB2E4\uC2DC \uBCF4\uAE30',
  '\uBBFC\uAC10\uC131 \uAE30\uC900\uC73C\uB85C \uB2E4\uC2DC \uC881\uD788\uAE30',
  '\uD1A4\uC5C5 \uC5C6\uB294 \uC81C\uD488\uB9CC \uBCF4\uAE30',
];

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

function toneFromReasonCode(item = {}) {
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
    if (hasTone) return { core: '톤 보정이 필요한 날에 적합', support: '피부 표현을 정리해주는 타입으로 보기 좋아요.' };
    if (isSpray) return { core: '가볍게 덧바르기 편한 타입', support: '외출 중에도 부담 적게 다시 바르기 좋아요.' };
    if (isStick) return { core: '손대지 않고 바르기 쉬운 타입', support: '번들거림이 올라올 때 빠르게 수정하기 편해요.' };
    if (isSerum) return { core: '얇고 가벼운 밀착감 중심', support: '무거운 크림이 부담될 때 고르기 좋아요.' };
    return { core: '가볍고 번들거림 부담 적음', support: '데일리로 쓰기 편한 사용감 쪽에 가까워요.' };
  }

  if (reasonCode === 'CONDITION_MATCH') {
    return {
      core: trimReasonText(why, 26) || '피부 고민에 맞춰 고른 추천',
      support: '현재 피부 조건에서 부담을 줄인 방향으로 고른 후보예요.',
    };
  }

  return {
    core: '무난한 데일리 기본형',
    support: '처음 시작하기에 부담이 적은 쪽으로 고른 추천이에요.',
  };
}

function buildCardCopy(item = {}) {
  const mapped = toneFromReasonCode(item);
  const tip = removeForbiddenCopy(item.usage_tip || '');

  return {
    coreReason: trimReasonText(mapped.core, 26) || '무난한 데일리 기본형',
    supportReason: removeForbiddenCopy(mapped.support) || '데일리로 사용하기 좋은 타입이에요.',
    usageTip: trimReasonText(tip || '기초 마지막 단계에서 얇게 2~3회 나눠 바르세요.', 52),
  };
}

function buildSelectionGuide(recommendations = []) {
  const [a, b, c] = recommendations;
  const getGuideLine = (item, rank) => {
    if (!item) return `${rank}번: 비슷한 조건에서 대안으로 비교할 때`;
    const name = String(item.name || '').toLowerCase();
    const form = String(item.form || '').toLowerCase();

    if (name.includes('토닝') || name.includes('톤') || name.includes('bb')) return `${rank}번: 톤 보정이 필요한 날에 선택`;
    if (form.includes('spray') || name.includes('스프레이')) return `${rank}번: 외출 중 덧바름 편의가 중요할 때`;
    if (form.includes('stick') || name.includes('스틱')) return `${rank}번: 보송하게 빠른 수정이 필요할 때`;
    if (form.includes('serum') || name.includes('세럼')) return `${rank}번: 가볍고 얇은 사용감을 원할 때`;
    return `${rank}번: 무난한 데일리 사용이 우선일 때`;
  };

  return [getGuideLine(a, 1), getGuideLine(b, 2), getGuideLine(c, 3)];
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
  return '평소 사용하는 메이크업/외출 패턴에 맞춰 1번부터 순서대로 비교해보세요.';
}

function App() {
  const [messages, setMessages] = useState([
    { id: 1, type: 'bot', text: '안녕하세요! 셀퓨전씨 AI 뷰티 가이드입니다. 무엇을 도와드릴까요?' },
  ]);
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
      const currentHasRecs =
        Array.isArray(widgetDataRef.current?.recommendations) && widgetDataRef.current.recommendations.length > 0;

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

        <div
          style={{
            display: 'flex',
            gap: '16px',
            overflowX: 'auto',
            paddingBottom: '12px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {widgetData.recommendations.map((product, idx) => (
            <div
              key={`${product.buy_url || product.name}-${idx}`}
              style={{
                minWidth: '260px',
                maxWidth: '300px',
                border: '1px solid #eee',
                borderRadius: '12px',
                padding: '14px',
                background: '#fff',
              }}
            >
              <div style={{ fontSize: '0.78rem', fontWeight: 'bold', color: '#B31312', marginBottom: '8px' }}>
                {idx === 0 ? '🏅 BEST' : `${idx + 1}위`}
              </div>
              <img
                src={product.image}
                alt={product.name}
                style={{ width: '100%', height: '150px', objectFit: 'contain', marginBottom: '12px' }}
              />
              <div style={{ fontWeight: 'bold', fontSize: '1.02rem', marginBottom: '6px', minHeight: '54px' }}>{product.name}</div>
              <div style={{ color: '#666', fontSize: '0.95rem', marginBottom: '12px' }}>{product.price ? `${product.price}원` : ''}</div>

              <div style={{ minHeight: '132px' }}>
                <CardText label="핵심 포인트" text={buildCardCopy(product).coreReason} />
                <CardText label="추천 이유" text={buildCardCopy(product).supportReason} />
                <CardText label="사용 팁" text={buildCardCopy(product).usageTip} />
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
          ))}
        </div>

        {widgetData.promotions.length > 0 && (
          <div style={{ marginTop: '14px', borderTop: '1px solid #eee', paddingTop: '12px' }}>
            <div style={{ fontWeight: 700, color: '#B31312', marginBottom: '8px', fontSize: '0.92rem' }}>현재 행사도 함께 진행 중이에요</div>
            {widgetData.promotions.map((product, idx) => (
              <div key={`${product.buy_url || product.name}-${idx}`} style={{ fontSize: '0.84rem', marginBottom: '6px', color: '#444' }}>
                <button
                  type="button"
                  onClick={() => openBuyLink(product.buy_url)}
                  style={{
                    color: '#444',
                    textDecoration: 'underline',
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    cursor: 'pointer',
                    font: 'inherit',
                  }}
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
                  style={{
                    color: '#444',
                    textDecoration: 'underline',
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    cursor: 'pointer',
                    font: 'inherit',
                  }}
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
            <div style={{ fontSize: '0.85rem', color: '#555', marginTop: '8px', lineHeight: 1.5 }}>
              {buildGuideContextLine(widgetData)}
            </div>
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
          <div
            style={{
              marginTop: '16px',
              fontSize: '0.86rem',
              color: '#444',
              fontStyle: 'italic',
              borderTop: '1px solid #eee',
              paddingTop: '12px',
            }}
          >
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
          placeholder="피부 타입이나 원하는 제품을 말씀해 주세요."
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
