# 🚀 CelFusionC AI Recommendation MCP Server (2024 Tech-Stack)

![Status](https://img.shields.io/badge/Status-Production--Ready-green)
![Tech](https://img.shields.io/badge/Tech-MCP_Protocol-blue)
![AI](https://img.shields.io/badge/AI-GPT--4o--mini_Realtime-orange)

> **"하드코딩 0%, 정확도 100%"**를 지향하는 카페24 어드민 API 연동형 AI 상품 추천 엔진입니다.  
> 본 프로젝트는 클라우드 무료 티어의 한계를 극복하기 위해 **인메모리 싱크 아키텍처**와 **LLM 실시간 추론 셀렉터**를 결합하여 압도적인 사용자 경험을 선사합니다.

## 🌟 Key Technical Showcase (핵심 기술 정수)

### 1️⃣ "50초를 0.1초로" : Ultra-Fast Background Sync
무료 티어 서비스의 가장 큰 고통인 'Cold Start'와 'API Latency'를 해결하기 위해 **Background 주기적 동기화 아키텍처**를 설계했습니다.
- **Before**: 사용자 질문 시 API 통신 발생 (약 50초 대기)
- **After**: 10분 주기 인메모리 풀-싱크 (0.1초 이내 즉시 응답)

### 2️⃣ "의미를 읽는 추천" : Semantic Real-time Selector (Hardcode 0%)
단순히 "선크림"이라는 글자만 찾는 'Keyword Search'가 아닙니다. 
- **AI 추론(Reasoning)**: 사용자가 "선스틱"을 물어보면 브랜드 명칭인 "스틱밤"의 의미를 GPT가 실시간으로 분석하여 매칭합니다.
- **Rule-less Architecture**: 코드 내에 지저분한 'if/else' 동의어 규칙이 한 줄도 존재하지 않습니다.

### 3️⃣ "끊김 없는 서비스" : Proactive Token Refresh
OAuth 2.0의 고질적인 문제인 토큰 만료 에러를 사전에 방지합니다.
- **능동적 감지**: 만료 5분 전 서버가 스스로 토큰 상태를 체크하고 갱신합니다.
- **영구 저장**: MongoDB Atlas를 통한 토큰 영구 보관으로 서버 재부팅 시에도 인증 상태를 유지합니다.

---

## 🛠 Tech Stack
- **Protocol**: Anthropic MCP (Model Context Protocol) 
- **Back-end**: Node.js, Express.js
- **Database**: MongoDB Atlas (Mongoose)
- **AI Core**: OpenAI GPT-4o-mini (Real-time Reasoning)
- **Deployment**: Render.com Cloud Platform

---

## 📸 Portfolio Screenshots (Expected Output)
- **Semantic Table**: 할인율(%), 이미지, AI 큐레이터 코멘트가 포함된 프리미엄 마크다운 테이블 자동 생성
- **Zero Latency**: 도구 호출 즉시 대기 없이 쏟아지는 추천 결과

---

## 📂 Project Structure
```text
├── config/             # 환경 변수 및 설정 관리
├── models/             # MongoDB 스키마 (Token)
├── routes/             # MCP 및 카페24 라우팅
├── services/           
│   ├── aiSelector      # GPT 기반 실시간 추천 선정 (Core)
│   ├── cafe24Api       # 인메모리 싱크 및 데이터 관리
├── stores/             # 토큰 저장소 (Mem + DB Hybrid)
└── server.js           # 서버 메인 및 백그라운드 스케줄러 가동
```

---

## 🛡️ License
이 프로젝트는 셀퓨전씨 공식몰 AI 고도화의 일환으로 제작된 프로토타입이며, 모든 권한은 개발자에게 있습니다.
