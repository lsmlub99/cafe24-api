import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Send, Sparkles } from 'lucide-react';

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const applyWidgetData = (payload) => {
      if (!payload) return;

      const structured = payload.structuredContent || payload.output || payload.data || payload;
      const recommendations = structured?.recommendations || structured?.items || [];
      const hasSummaryMessage = Boolean(structured?.summary?.message);
      if (!Array.isArray(recommendations) && !hasSummaryMessage) return;

      const nextData = {
        recommendations: Array.isArray(recommendations) ? recommendations : [],
        promotions: structured.promotions || [],
        summary: structured.summary || {},
        strategy: '',
        conclusion: structured.conclusion || structured.summary?.conclusion || '',
      };

      const signature = JSON.stringify({
        names: nextData.recommendations.map((r) => r?.name || ''),
        promotions: nextData.promotions.map((p) => p?.name || ''),
        message: nextData.summary?.message || '',
        strategy: nextData.strategy,
        conclusion: nextData.conclusion,
      });
      if (signature === lastWidgetSignatureRef.current) return;
      lastWidgetSignatureRef.current = signature;

      setWidgetData(nextData);

      if (fallbackPollRef.current) {
        window.clearInterval(fallbackPollRef.current);
        fallbackPollRef.current = null;
      }
    };

    const unwrap = (message) => {
      if (!message) return null;
      if (message.params?.structuredContent || message.params?.data || message.params?.output) {
        return message.params;
      }
      if (message.params?.result) return message.params.result;
      if (message.params?.payload) return message.params.payload;
      if (message.params?.toolOutput) return message.params.toolOutput;
      if (message.result?.toolOutput) return message.result.toolOutput;
      if (message.result?.payload) return message.result.payload;
      if (message.result?.structuredContent || message.result?.data || message.result?.output) {
        return message.result;
      }
      if (message.result) return message.result;
      return message;
    };

    const handleMessage = (event) => {
      const message = event.data;
      if (!message) return;

      if (message.jsonrpc === '2.0' && typeof message.method === 'string') {
        applyWidgetData(unwrap(message));
        return;
      }
      if (message.jsonrpc === '2.0') {
        applyWidgetData(unwrap(message));
        return;
      }

      if (message.type === 'ui/notifications/tool-result') {
        applyWidgetData(message.payload);
        return;
      }

      if (message.structuredContent || message.recommendations || message.items) {
        applyWidgetData(message);
      }
    };

    window.addEventListener('message', handleMessage);

    if (window.mcpData) applyWidgetData(window.mcpData);
    if (window.__INITIAL_DATA__) applyWidgetData(window.__INITIAL_DATA__);
    if (window.__MCP_DATA__) applyWidgetData(window.__MCP_DATA__);
    if (window.openai?.appData) applyWidgetData(window.openai.appData);
    if (window.openai?.toolOutput) applyWidgetData(window.openai.toolOutput);

    fallbackPollRef.current = window.setInterval(() => {
      if (window.openai?.toolOutput) applyWidgetData(window.openai.toolOutput);
      if (window.openai?.appData) applyWidgetData(window.openai.appData);
    }, 500);

    const inIframe = window.parent && window.parent !== window;
    if (inIframe) {
      const initId = `init-${Date.now()}`;
      window.parent.postMessage(
        {
          jsonrpc: '2.0',
          id: initId,
          method: 'ui/initialize',
          params: { version: '1.0.0' },
        },
        '*'
      );
      window.parent.postMessage(
        {
          jsonrpc: '2.0',
          method: 'ui/notifications/initialized',
          params: { version: '1.0.0' },
        },
        '*'
      );
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
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, type: 'bot', text: '서버 통신 중 오류가 발생했습니다.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const isWidgetMode = Boolean(window.__WIDGET_MODE__ || widgetData);

  if (isWidgetMode && widgetData?.recommendations?.length) {
    return (
      <div
        className="widget-container"
        style={{ padding: '16px', background: '#fff', borderRadius: '12px', fontFamily: 'inherit' }}
      >
        <h3
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '1.1rem',
            marginBottom: '16px',
            color: '#B31312',
          }}
        >
          <Sparkles size={18} fill="#B31312" />
          셀퓨전씨 AI 맞춤 추천
        </h3>

        <div
          className="product-carousel"
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
              className="product-card"
              style={{
                minWidth: '220px',
                border: '1px solid #eee',
                borderRadius: '12px',
                padding: '12px',
                background: '#fff',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              }}
            >
              <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#B31312', marginBottom: '8px' }}>
                {idx === 0 ? '🏅 BEST' : `${idx + 1}위`}
              </div>

              <img
                src={product.image}
                alt={product.name}
                style={{ width: '100%', height: '140px', objectFit: 'contain', marginBottom: '12px' }}
              />

              <div
                style={{
                  fontWeight: 'bold',
                  fontSize: '0.9rem',
                  marginBottom: '4px',
                  minHeight: '2.4em',
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {product.name}
              </div>

              <div style={{ color: '#666', fontSize: '0.85rem', marginBottom: '12px' }}>
                {product.price ? `${product.price}원` : ''}
              </div>

              {product.why_pick && (
                <div style={{ fontSize: '0.78rem', color: '#444', marginBottom: '6px', lineHeight: '1.45' }}>
                  <strong>추천 이유:</strong> {product.why_pick}
                </div>
              )}

              {product.usage_tip && (
                <div style={{ fontSize: '0.78rem', color: '#555', marginBottom: '10px', lineHeight: '1.45' }}>
                  <strong>사용 팁:</strong> {product.usage_tip}
                </div>
              )}

              <a
                href={product.buy_url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'block',
                  textAlign: 'center',
                  background: '#B31312',
                  color: '#fff',
                  padding: '10px',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  textDecoration: 'none',
                  fontWeight: 'bold',
                }}
              >
                지금 구매하기
              </a>
            </div>
          ))}
        </div>

        {Array.isArray(widgetData.promotions) && widgetData.promotions.length > 0 && (
          <div style={{ marginTop: '14px', borderTop: '1px solid #eee', paddingTop: '12px' }}>
            <div style={{ fontWeight: 700, color: '#B31312', marginBottom: '8px', fontSize: '0.92rem' }}>
              현재 행사 상품도 진행 중이에요
            </div>
            {widgetData.promotions.map((product, idx) => (
              <div
                key={`${product.buy_url || product.name}-${idx}`}
                style={{ fontSize: '0.82rem', marginBottom: '6px', color: '#444' }}
              >
                <a href={product.buy_url} target="_blank" rel="noreferrer" style={{ color: '#444' }}>
                  {product.name}
                </a>
                {product.price ? ` · ${product.price}원` : ''}
              </div>
            ))}
          </div>
        )}

        {widgetData.conclusion && (
          <div
            style={{
              marginTop: '16px',
              fontSize: '0.85rem',
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

  if (isWidgetMode && widgetData && (!widgetData.recommendations || widgetData.recommendations.length === 0)) {
    return (
      <div style={{ padding: '16px', color: '#555', background: '#fff', borderRadius: '12px' }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#B31312', marginBottom: '8px' }}>
          추천 결과
        </div>
        <div>{widgetData.summary?.message || '조건에 맞는 결과를 찾지 못했어요.'}</div>
      </div>
    );
  }

  if (isWidgetMode && !widgetData) {
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
                  <div
                    key={`${product.buy_url || product.name}-${idx}`}
                    className="product-card"
                    onClick={() => product.buy_url && window.open(product.buy_url, '_blank')}
                  >
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
