import React, { useState, useEffect, useRef } from 'react'
import { Send, Sparkles, ChevronRight } from 'lucide-react'

function App() {
  const [messages, setMessages] = useState([
    { id: 1, type: 'bot', text: '안녕하세요! 셀퓨전씨 AI 뷰티 가이드입니다. 무엇을 도와드릴까요?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [widgetData, setWidgetData] = useState(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 🛰️ [ULTIMATE DATA BRIDGE] 지피티의 모든 데이터 주입 방식을 감지
  useEffect(() => {
    const applyWidgetData = (payload) => {
      if (!payload) return;

      // 지피티 버전에 따라 다를 수 있는 구조적 유연성 확보
      const structured =
        payload.structuredContent ||
        payload.output ||
        payload.data ||
        payload;

      if (structured && (Array.isArray(structured.recommendations) || structured.items)) {
        setWidgetData({
          recommendations: structured.recommendations || structured.items || [],
          promotions: structured.promotions || [],
          summary: structured.summary || {},
          strategy: structured.strategy || structured.summary?.strategy || '',
          conclusion: structured.conclusion || structured.summary?.conclusion || ''
        });
      }
    };

    const unwrapRpcPayload = (data) => {
      if (!data) return null;
      if (data.params?.payload) return data.params.payload;
      if (data.params?.toolOutput) return data.params.toolOutput;
      if (data.result) return data.result;
      return data;
    };

    const handleMessage = (event) => {
      const data = event.data;
      if (!data) return;

      // JSON-RPC style bridge: ui/initialize, ui/notifications/tool-result, etc.
      if (data.jsonrpc && data.method && String(data.method).startsWith('ui/')) {
        applyWidgetData(unwrapRpcPayload(data));
        return;
      }

      // 1. 공식 GenUI 알림 감지
      if (data.type === 'ui/notifications/tool-result' && data.payload) {
        applyWidgetData(data.payload);
      } 
      // 2. 다이렉트 데이터 전송 감지
      else if (data.structuredContent || data.recommendations || data.items) {
        applyWidgetData(data);
      }
    };

    window.addEventListener('message', handleMessage);

    // 3. 글로벌 변수 3중 체크 (가장 확실한 수단)
    if (window.mcpData) applyWidgetData(window.mcpData);
    if (window.__INITIAL_DATA__) applyWidgetData(window.__INITIAL_DATA__);
    if (window.__MCP_DATA__) applyWidgetData(window.__MCP_DATA__);
    if (window.openai?.appData) applyWidgetData(window.openai.appData);
    if (window.openai?.toolOutput) applyWidgetData(window.openai.toolOutput);

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg = { id: Date.now(), type: 'user', text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: input })
      });
      
      const data = await response.json();
      
      const botMsg = { 
        id: Date.now() + 1, 
        type: 'bot', 
        text: data.summary?.message || '고객님께 가장 잘 맞는 제품들을 찾아보았습니다.',
        products: data.recommendations || []
      };
      
      setMessages(prev => [...prev, botMsg]);
    } catch (err) {
      setMessages(prev => [...prev, { 
        id: Date.now() + 1, 
        type: 'bot', 
        text: '서버와 통신하는 중에 오류가 발생했습니다.' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // 🎨 [👑WIDGET MODE] 지피티 내부 위젯 확정 렌더링
  const isWidgetMode = window.__WIDGET_MODE__ || !!widgetData;

  if (isWidgetMode && widgetData && Array.isArray(widgetData.recommendations) && widgetData.recommendations.length > 0) {
    return (
      <div className="widget-container" style={{ padding: '16px', background: '#fff', borderRadius: '12px', fontFamily: 'inherit' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem', marginBottom: '16px', color: '#B31312' }}>
          <Sparkles size={18} fill="#B31312" /> 셀퓨전씨 AI 맞춤 솔루션
        </h3>

        {!!widgetData.strategy && (
          <div style={{ background: '#f9f9f9', padding: '12px', borderRadius: '8px', marginBottom: '16px', borderLeft: '4px solid #B31312', fontSize: '0.9rem', lineHeight: '1.5' }}>
            {widgetData.strategy}
          </div>
        )}

        <div className="product-carousel" style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '12px', WebkitOverflowScrolling: 'touch' }}>
          {widgetData.recommendations.map((p, idx) => (
            <div key={p.id || idx} className="product-card" style={{ minWidth: '220px', border: '1px solid #eee', borderRadius: '12px', padding: '12px', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#B31312', marginBottom: '8px' }}>
                {idx === 0 ? '🏆 1위(BEST)' : `${idx + 1}위`}
              </div>
              <img
                src={p.image}
                alt={p.name}
                style={{ width: '100%', height: '140px', objectFit: 'contain', marginBottom: '12px' }}
              />
              <div style={{ fontWeight: 'bold', fontSize: '0.9rem', marginBottom: '4px', minHeight: '2.4em', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical' }}>
                {p.name}
              </div>
              <div style={{ color: '#666', fontSize: '0.85rem', marginBottom: '12px' }}>
                {p.price}원
              </div>
              {!!p.why_pick && (
                <div style={{ fontSize: '0.78rem', color: '#444', marginBottom: '6px', lineHeight: '1.45' }}>
                  <strong>추천 이유:</strong> {p.why_pick}
                </div>
              )}
              {!!p.usage_tip && (
                <div style={{ fontSize: '0.78rem', color: '#555', marginBottom: '10px', lineHeight: '1.45' }}>
                  <strong>사용 팁:</strong> {p.usage_tip}
                </div>
              )}
              <a
                href={p.buy_url}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'block', textAlign: 'center', background: '#B31312', color: '#fff', padding: '10px', borderRadius: '8px', fontSize: '0.85rem', textDecoration: 'none', fontWeight: 'bold' }}
              >
                지금 구매하기
              </a>
            </div>
          ))}
        </div>

        {Array.isArray(widgetData.promotions) && widgetData.promotions.length > 0 && (
          <div style={{ marginTop: '14px', borderTop: '1px solid #eee', paddingTop: '12px' }}>
            <div style={{ fontWeight: 700, color: '#B31312', marginBottom: '8px', fontSize: '0.92rem' }}>
              행사 상품도 진행 중이에요
            </div>
            {widgetData.promotions.map((p, idx) => (
              <div key={`${p.buy_url}-${idx}`} style={{ fontSize: '0.82rem', marginBottom: '6px', color: '#444' }}>
                <a href={p.buy_url} target="_blank" rel="noreferrer" style={{ color: '#444', textDecoration: 'underline' }}>
                  {p.name}
                </a>
                {p.price ? ` · ${p.price}원` : ''}
              </div>
            ))}
          </div>
        )}

        {!!widgetData.conclusion && (
          <div style={{ marginTop: '16px', fontSize: '0.85rem', color: '#444', fontStyle: 'italic', borderTop: '1px solid #eee', paddingTop: '12px' }}>
            {widgetData.conclusion}
          </div>
        )}
      </div>
    );
  }

  // 위젯 모드인데 데이터가 아직 없는 경우
  if (isWidgetMode && !widgetData) {
      return (
          <div style={{padding: '20px', textAlign: 'center', color: '#666'}}>
              <Sparkles size={24} style={{marginBottom: '10px', opacity: 0.5}} />
              <div>맞춤 솔루션을 분석 중입니다...</div>
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
            <div className={`message-bubble message-${msg.type}`}>
              {msg.text}
            </div>
            
            {msg.products && msg.products.length > 0 && (
              <div className="carousel-container">
                {msg.products.map((p, idx) => (
                  <div key={p.id} className="product-card" onClick={() => p.buy_url && window.open(p.buy_url, '_blank')}>
                    <div className="rank-badge">{idx === 0 ? '🥇 BEST' : `${idx + 1}위`}</div>
                    <img src={p.image} alt={p.name} className="product-img" />
                    <div className="product-name">{p.name}</div>
                    <div className="product-price">{p.price}원</div>
                    <button className="buy-button">지금 구매 <ChevronRight size={14} style={{display:'inline', verticalAlign:'middle'}} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="message-bubble message-bot" style={{opacity: 0.6}}>
            분석 중...
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      <footer className="input-area">
        <input 
          type="text" 
          className="chat-input" 
          placeholder="피부 타입이나 제품명을 말씀해 주세요."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
        />
        <button className="send-button" onClick={handleSend} disabled={isLoading}>
          <Send size={20} />
        </button>
      </footer>
    </div>
  )
}

export default App
