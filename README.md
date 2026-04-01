# 🧴 CellFusionC AI Shopping Assistant — MCP Server

> **카페24 Admin API × AI MCP 통합 서버**  
> 셀퓨전씨 공식 쇼핑몰의 실시간 상품 데이터를 AI에게 연결하여,  
> 고객 맞춤형 스킨케어 추천과 공식 베스트셀러 랭킹을 제공하는 지능형 커머스 백엔드입니다.

---

## 📌 프로젝트 개요

| 항목 | 내용 |
|---|---|
| **목적** | AI 에이전트가 카페24 공식몰의 실시간 상품 데이터를 활용하여 최적의 상품 추천을 제공 |
| **기술 스택** | Node.js, Express, MongoDB(Mongoose), Cafe24 Admin API, MCP(Model Context Protocol) |
| **배포** | Render (자동 배포, GitHub 연동) |
| **아키텍처** | Service Layer Pattern + In-Memory Cache + Auto Token Refresh |

---

## 🏗️ 시스템 아키텍처

```
┌─────────────┐     MCP JSON-RPC      ┌──────────────────────┐
│  AI Agent   │ ◄─────────────────►  │   MCP Express Server  │
│  (Claude등) │     SSE + POST        │   (routes/mcp.js)     │
└─────────────┘                       └──────────┬───────────┘
                                                  │
                              ┌────────────────────┼────────────────────┐
                              ▼                    ▼                    ▼
                   ┌──────────────────┐  ┌─────────────────┐  ┌────────────────┐
                   │ Recommendation   │  │ Cafe24 API      │  │ Token Store    │
                   │ Service          │  │ Service          │  │ (MongoDB)      │
                   │ - 채점 알고리즘   │  │ - 상품 조회      │  │ - 토큰 영구저장 │
                   │ - 중복 필터링     │  │ - 카테고리 조회   │  │ - 자동 갱신     │
                   │ - 업셀링 매핑     │  │ - 5분 캐싱       │  │                │
                   └──────────────────┘  └────────┬────────┘  └────────────────┘
                                                  │
                                                  ▼
                                        ┌─────────────────┐
                                        │  Cafe24 Admin   │
                                        │  REST API       │
                                        │  (공식 쇼핑몰)   │
                                        └─────────────────┘
```

---

## 🔥 핵심 기능

### 1. 🎯 AI 맞춤형 상품 추천 (`search_cafe24_real_products`)
- 고객의 피부 타입(건성/지성/민감성)과 고민(트러블/수분/진정)을 분석
- 카페24 API에서 실시간 상품 100개를 조회하여 **AI 채점 알고리즘**으로 최적 매칭
- **키워드 가중치 채점**: 피부 타입(+3점), 고민 키워드(+2점), 카테고리(+2점)
- **1+1 중복 방지**: 정규식으로 `[1+1]`, `(증정)` 등 수식어를 제거한 '핵심 본명' 기반 필터링
- **업셀링(Up-sell)**: 기획 세트 상품을 대표 상품의 연관 상품(`upsell_options`)으로 묶어 하단 제안
- **랜덤 가산점(Jitter)**: 맞춤 추천 시에만 동점자 순위를 뒤섞어 생동감 제공

### 2. 🏆 공식 베스트셀러 랭킹 (`get_bestseller_ranking`)
- 카페24 공식몰 **베스트 카테고리(Category No.47)**의 실제 진열 순서를 그대로 가져옴
- 쇼핑몰 관리자가 설정한 공식 랭킹 → **매번 동일한 순위 = 신뢰도 100%**
- 기본 5개, 최대 10개까지 동적 확장 가능

### 3. 🔄 무중단 토큰 자동 갱신 (Auto-Refresh)
- 카페24 Access Token 만료(2시간) 시 **자동으로 Refresh Token을 사용하여 재발급**
- 사용자 개입 없이 백그라운드에서 토큰을 교체하고 원래 요청을 즉시 재시도
- MongoDB에 토큰을 영구 저장하여 서버 재시작 시에도 데이터 유실 방지

### 4. ⚡ 인메모리 캐싱 (5분 TTL)
- 동일한 API 요청을 5분 내에 반복할 경우 카페24 서버에 재요청하지 않고 즉시 응답
- API 호출 부하 방지 및 응답 속도 100배 이상 단축

### 5. 🎨 상황별 적응형 UI/UX 렌더링
- **맞춤 추천**: 세로 카드형 불릿 레이아웃 (이미지 + 상품명 + 가격 + 추천이유 + 구매링크)
- **랭킹 조회**: 순위 뱃지 카드형 레이아웃 (메달 이모지 + 공식 순서 보장)
- 백엔드 서버에서 마크다운을 사전 렌더링(Pre-render)하여 AI의 자의적 레이아웃 파괴를 원천 차단

---

## 📂 프로젝트 구조

```
cafe24-api/
├── server.js                          # 메인 엔트리포인트 (Express + MongoDB 연결)
├── config/
│   └── env.js                         # 환경변수 로드 및 필수값 검증
├── routes/
│   ├── cafe24.js                      # OAuth 2.0 인증 라우터 (카페24 로그인)
│   └── mcp.js                         # MCP 통신 라우터 (AI 연동 핵심)
├── services/
│   ├── cafe24ApiService.js            # 카페24 API 호출 + 캐싱 서비스
│   ├── cafe24AuthService.js           # OAuth 토큰 발급/갱신 서비스
│   └── recommendationService.js       # 상품 추천 채점 알고리즘
├── stores/
│   ├── tokenStore.js                  # MongoDB 기반 토큰 영구 저장소
│   └── stateStore.js                  # OAuth State 검증용 임시 저장소
├── models/
│   └── Token.js                       # Mongoose 토큰 스키마
├── .env.example                       # 환경변수 템플릿
└── package.json
```

---

## ⚙️ 환경변수 설정

```env
PORT=3000
MALL_ID=your_cafe24_mall_id
CLIENT_ID=your_cafe24_client_id
CLIENT_SECRET=your_cafe24_client_secret
REDIRECT_URI=https://your-server.com/cafe24/callback
SCOPE=mall.read_product,mall.read_category
MONGO_URI=mongodb+srv://your_mongodb_connection_string
```

---

## 🚀 실행 방법

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정
cp .env.example .env
# .env 파일에 실제 값 입력

# 3. 서버 실행
npm start

# 4. 카페24 OAuth 인증 (최초 1회)
# 브라우저에서 접속: https://your-server.com/cafe24/start
```

---

## 🛠️ 기술적 의사결정 기록

| 결정 사항 | 선택한 방식 | 이유 |
|---|---|---|
| 토큰 저장 | MongoDB (Mongoose) | 서버 재시작/재배포 시에도 토큰 유실 방지 |
| 캐싱 전략 | In-Memory (Map) | 외부 Redis 없이도 충분한 단일 서버 환경 |
| AI 레이아웃 제어 | 백엔드 Pre-render | LLM이 지시를 무시하고 레이아웃을 변경하는 문제 해결 |
| 추천 vs 랭킹 분리 | 별도 MCP Tool | 맞춤 추천은 AI 채점, 랭킹은 공식 데이터 직조회로 역할 분리 |
| Rate Limit | 미적용 (철거) | AI 백엔드 통신과 간섭하여 오작동 유발, 추후 화이트리스트 기반 재도입 예정 |
| 중복 상품 처리 | 정규식 Base Name 추출 | `[1+1]`, `(증정)` 등 수식어를 제거한 본명 기반 매핑으로 대표+연관 구조화 |

---

## 📊 MCP Tool 명세

### `search_cafe24_real_products`
| 파라미터 | 타입 | 설명 |
|---|---|---|
| `skin_type` | string | 피부 타입 (건성, 지성, 민감성 등) |
| `concerns` | array | 피부 고민 (수분, 진정, 트러블 등) |
| `category` | string | 원하는 카테고리 (크림, 앰플, 비비 등) |
| `count` | number | 추천 개수 (기본 3, 최대 5) |

### `get_bestseller_ranking`
| 파라미터 | 타입 | 설명 |
|---|---|---|
| `count` | number | 랭킹 개수 (기본 5, 최대 10) |

---

## 🔒 보안

- OAuth 2.0 Authorization Code Flow (카페24 공식 스펙)
- Authorization: Basic 헤더 인증 (client_id:client_secret Base64)
- 모든 API 통신 HTTPS 강제
- MongoDB Atlas 클라우드 저장 (토큰 암호화 전송)
- `.env` 파일 `.gitignore` 처리

---

## 📝 라이선스

이 프로젝트는 카페24 앱스토어 입점을 위한 비공개 프로젝트입니다.

---

> **Built with ❤️ for CellFusionC Official Store**  
> *AI-Powered Beauty Commerce Backend*
