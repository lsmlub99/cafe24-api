import React, { useState, useEffect, useRef } from 'react'
import { Send, Sparkles, ShoppingBag, ChevronRight } from 'lucide-react'

function App() {
  const [messages, setMessages] = useState([
    { id: 1, type: 'bot', text: '안녕하세요! 셀퓨전씨 AI 뷰티 가이드입니다. 무엇을 도와드릴까요?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const [widgetData, setWidgetData] = useState(null);

  // 🛰️ [MCP Apps Bridge] 지피티로부터 전송된 데이터 수신
  useEffect(() => {
    const handleMessage = (event) => {
      const data = event.data;
      if (data && data.type === 'ui/notifications/tool-result' && data.payload) {
        const payload = data.payload;
        if (payload.structuredContent) {
          setWidgetData(payload.structuredContent);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // [Fallback] 초기 데이터 체크
    if (window.mcpData) {
        setWidgetData(window.mcpData.structuredContent);
    }
    
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

  // 🎨 [Widget Mode] 지피티 내부 위젯으로 로드되었을 때 전용 UI
  if (widgetData) {
    return (
      <div className="widget-container" style={{padding: '16px', background: '#fff', borderRadius: '12px'}}>
         <h3 style={{display:'flex', alignItems:'center', gap: '8px', fontSize: '1.1rem', marginBottom: '16px', color: '#B31312'}}>
           <Sparkles size={18} fill="#B31312" /> 셀퓨전씨 AI 맞춤 솔루션
         </h3>
         <div className="strategy-box" style={{background: '#f9f9f9', padding: '12px', borderRadius: '8px', marginBottom: '16px', borderLeft: '4px solid #B31312', fontSize: '0.9rem'}}>
           {widgetData.strategy}
         </div>
         <div className="product-carousel" style={{display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '12px'}}>
           {widgetData.recommendations.map((p, idx) => (
             <div key={idx} className="product-card" style={{minWidth: '220px', border: '1px solid #eee', borderRadius: '12px', padding: '12px', background: '#fff'}}>
               <div style={{fontSize: '0.75rem', fontWeight: 'bold', color: '#B31312', marginBottom: '8px'}}>{idx === 0 ? '🏆 1위' : `${idx+1}위`}</div>
               <img src={p.image} alt={p.name} style={{width: '100%', height: '140px', objectFit: 'contain', marginBottom: '12px'}} />
               <div style={{fontWeight: 'bold', fontSize: '0.9rem', marginBottom: '4px', height: '2.4em', overflow: 'hidden'}}>{p.name}</div>
               <div style={{color: '#666', fontSize: '0.85rem', marginBottom: '12px'}}>{p.price}원</div>
               <a href={p.buy_url} target="_blank" rel="noreferrer" className="buy-button" style={{display: 'block', textAlign: 'center', background: '#B31312', color: '#fff', padding: '8px', borderRadius: '6px', fontSize: '0.85rem', textDecoration: 'none'}}>지금 구매하기</a>
             </div>
           ))}
         </div>
         <div className="conclusion-box" style={{marginTop: '16px', fontSize: '0.85rem', color: '#444', fontStyle: 'italic'}}>
           {widgetData.conclusion}
         </div>
      </div>
    )
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
