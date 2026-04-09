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
