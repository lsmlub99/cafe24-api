# Cafe24 MCP Server — AI 기반 실시간 상품 추천 엔진

> Cafe24 쇼핑몰 데이터를 활용해 **ChatGPT(GPT App)** 환경에서 실시간 상품 추천을 제공하는  
> **MCP(Model Context Protocol)** 서버입니다.

[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat&logo=express)](https://expressjs.com)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.x-47A248?style=flat&logo=mongodb&logoColor=white)](https://mongodb.com)
[![OpenAI](https://img.shields.io/badge/OpenAI-API-412991?style=flat&logo=openai&logoColor=white)](https://openai.com)

---

## 📌 Overview

CellFusionC 브랜드의 Cafe24 스토어와 ChatGPT를 연결하는 AI 추천 서버입니다.  
사용자가 ChatGPT에서 "지성 피부에 맞는 세럼 추천해줘"처럼 자연어로 요청하면,  
Cafe24 상품 데이터를 기반으로 맞춤 추천을 실시간으로 제공합니다.

```
ChatGPT GPT App
      │  자연어 요청
      ▼
  MCP Server  ──→  인텐트 파싱 & 피처 추출
      │
      ├──→  Cafe24 Admin API  (상품 데이터)
      ├──→  MongoDB           (OAuth 토큰 영속화)
      └──→  OpenAI API        (리랭킹 / 임베딩)
      │
      ▼
  계층형 추천 결과 반환
  (메인 / 서브 / 프로모션)
```

---

## ✨ Key Features

### 🎯 계층형 추천 시스템
사용자 맥락에 따라 세 가지 레이어로 추천을 분리합니다.

| 레이어 | 설명 |
|--------|------|
| **Main** | 의도에 가장 부합하는 핵심 추천 |
| **Secondary** | 대안 또는 보완 상품 |
| **Promotional** | 현재 진행 중인 프로모션 상품 |

### 🏆 하이브리드 랭킹 파이프라인
```
자연어 입력
   → 입력 정규화
   → 인텐트 인식 (피부 타입, 효능, 제형 등)
   → 피처 기반 후보 검색
   → 정책 스코어링 (판매량, 리뷰, 재고)
   → LLM 리랭킹 (옵션)
   → 시맨틱 임베딩 보강 (옵션)
   → 위젯 포맷으로 응답
```

### 💬 세션 컨텍스트 인식
- 사용자의 **네거티브 시그널** 추적 ("자극적이에요", "안 맞아요")
- 거절된 상품을 세션 내에서 제외해 반복 추천 방지
- 대화 흐름을 유지하는 **멀티턴 추천** 지원

### 🔌 MCP 표준 완전 준수
| 엔드포인트 | 설명 |
|-----------|------|
| `tools/list` | 사용 가능한 추천 도구 목록 |
| `tools/call` | 추천 실행 (JSON-RPC) |
| `resources/read` | 상품 데이터 직접 조회 |
| SSE Stream | 실시간 스트리밍 응답 |
| `GET /.well-known/openai-apps-challenge` | ChatGPT App 제출용 소유권 확인 토큰 |

---

## 🛠️ Tech Stack

| 분류 | 기술 |
|------|------|
| Runtime | Node.js 20.x (ES Modules) |
| Framework | Express 4.x |
| Database | MongoDB 7.x (Mongoose) |
| Cache | In-memory (상품 데이터) |
| API | Cafe24 Admin API (OAuth 2.0) |
| Frontend | React + Vite |
| AI | OpenAI API (리랭킹, 임베딩) |

---

## 📁 Project Structure

```
cafe24-api/
├── server.js                  # 엔트리포인트
├── routes/
│   └── mcp.js                 # MCP 게이트웨이
├── services/
│   └── recommendationService.js  # 추천 파이프라인 핵심 로직
├── models/                    # Mongoose 스키마
├── config/                    # 환경 설정
├── stores/                    # 인메모리 캐시
├── utils/                     # 공통 유틸리티
├── tests/                     # 테스트 스위트
├── client/                    # React + Vite 프론트엔드
└── MCPAPPinChatGPT/           # ChatGPT GPT App 설정
```

---

## ⚙️ Getting Started

### Prerequisites
- Node.js 20.x
- MongoDB 인스턴스
- Cafe24 개발자 계정 및 앱 등록
- OpenAI API 키

### Installation

```bash
# 의존성 설치 (클라이언트 빌드 포함)
npm install

# 환경변수 설정
cp .env.example .env
```

### 환경변수 설정 (`.env`)

```env
# 필수
PORT=3000
MONGO_URI=mongodb://...
MALL_ID=your_mall_id
CLIENT_ID=your_cafe24_client_id
CLIENT_SECRET=your_cafe24_client_secret
REDIRECT_URI=https://your-domain.com/auth/callback
OPENAI_API_KEY=sk-...

# 선택 (AI 기능 강화)
ENABLE_LLM_RERANKING=true
ENABLE_SEMANTIC_RETRIEVAL=true
LOG_LEVEL=info

# 선택 (카테고리 자동탐지 보정, JSON)
# 이름 기반 카테고리 탐지가 놓친 경우 시드 카테고리 ID를 추가 (하위 카테고리도 자동 포함)
CATEGORY_NO_OVERRIDES={"선케어":[29]}
```

### Run

```bash
# 개발 서버 (파일 변경 감지)
npm run dev

# 프로덕션
npm start

# 테스트
npm test
```

---

## 🔐 Cafe24 OAuth Flow

```
1. GET /auth/login        → Cafe24 인증 페이지 리다이렉트
2. GET /auth/callback     → 토큰 수신 및 MongoDB 저장
3. 이후 API 호출          → DB에서 토큰 자동 로드 (서버 재시작 무관)
```

---

## 📊 Architecture Highlights

- **토큰 영속화**: Cafe24 OAuth 토큰을 MongoDB에 저장해 서버 재시작 후에도 인증 유지
- **비용 조절**: LLM 리랭킹과 시맨틱 임베딩을 독립 옵션으로 분리해 API 비용 제어 가능
- **ChatGPT App 통합**: `chatgpt-app-submission.json`으로 GPT Store 제출 설정 포함
