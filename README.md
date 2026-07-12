# Cafe24 MCP Server — 실시간 AI 상품 추천 엔진

> Cafe24 커머스 데이터를 **ChatGPT App(MCP)** 안으로 끌어와, 사용자의 자연어 요청을
> 실시간 맞춤 추천으로 응답하는 **Model Context Protocol** 서버.
> **OpenAI 심사를 통과해 정식 등록된 ChatGPT App**의 백엔드로 프로덕션 운영 중입니다.

[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat&logo=express)](https://expressjs.com)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.x-47A248?style=flat&logo=mongodb&logoColor=white)](https://mongodb.com)
[![OpenAI](https://img.shields.io/badge/OpenAI-Embeddings-412991?style=flat&logo=openai&logoColor=white)](https://openai.com)
[![ChatGPT App](https://img.shields.io/badge/ChatGPT%20App-심사%20통과%20%26%20등록-10a37f?style=flat&logo=openai&logoColor=white)]()

---

## 📌 Overview

CellFusionC 브랜드의 Cafe24 스토어를 ChatGPT와 연결하는 추천 서버입니다.
사용자가 ChatGPT에서 *"지성인데 번들거리지 않는 가벼운 선크림 추천해줘"* 처럼 대화하면,
실시간 상품 카탈로그를 근거로 맞춤 추천 카드를 즉시 반환합니다.

```
 ChatGPT App  ──(자연어)──▶  MCP Server
                               │
        ┌──────────────────────┼───────────────────────┐
        ▼                      ▼                       ▼
  Cafe24 Admin API      In-Memory Catalog        OpenAI Embeddings
  (상품·카테고리)         (10분 주기 동기화)         (의미 유사도 보강)
        │
        ▼
  결정론적 의도 라우팅  →  스코어링  →  계층형 추천 카드
  (상품명·조건·인기)                    (main / secondary / promotion)
```

핵심 설계 원칙은 **"판단을 통째로 LLM에 맡기지 않는다"** 입니다.
의도 분류·검색·랭킹은 결정론적 규칙으로 처리하고, LLM(임베딩)은 *뉘앙스 보강* 역할만 맡깁니다.
그 결과 **동일 입력 → 동일 결과**의 예측 가능성과 **1~2초대 응답 속도**를 확보했습니다.

---

## ✨ 핵심 기능

### 1. 결정론적 3-way 의도 라우팅
호출하는 모델이 인자를 어떤 필드에 담아 보내든, 서버가 **원문 텍스트를 실제 카탈로그와 직접 대조**해
의도를 스스로 판별합니다.

| 우선순위 | 의도 | 처리 |
|:---:|------|------|
| ① | **상품명 지정** — "아쿠아티카 있어요?" | 해당 상품을 1순위 고정, 나머지는 유사 대안 (오타 허용 매칭) |
| ② | **피부타입·고민 기반** — "민감성이라 순한 거" | 조건 적합도 랭킹 (카테고리/제형 잠금) |
| ③ | **일반 인기** — "선크림 추천해줘" | 품질·인기 신호 기반 랭킹 |

### 2. 재고·상황 정직성 (Availability Honesty)
- 사용자가 지정한 상품이 **품절이면 대안으로 슬쩍 바꾸지 않고** "그 제품은 현재 품절이라…" 라고 먼저 안내
- 요청한 속성("쿨링")에 맞는 재고가 없으면 그 사실을 밝힌 뒤 사용 가능한 대안을 제시

### 3. 도메인 모델링 — 태그 기반 의도 인식
Cafe24에는 성별 카테고리가 없어, "남성용 제품"은 태그로만 존재합니다.
서버가 **남성 의도를 인식**해 `#남성용` 태그 상품을 우선 노출하고, 이 경우에 한해 기획세트도 메인 추천으로 허용합니다.

### 4. 계층형 추천 응답
| 레이어 | 역할 |
|--------|------|
| **Main** | 의도에 가장 부합하는 핵심 추천 (최대 3) |
| **Secondary** | 다른 제형·대안 상품 |
| **Promotion** | 진행 중인 행사/세트 (메인과 분리) |

프로모션 판별은 **상품명의 실제 정크 마커**(샘플/증정/1+1/기획세트/마켓)로만 하고,
행사 카테고리에 걸린 **정상 단품은 메인에서 배제하지 않습니다.**

### 5. 세션 컨텍스트 인식
- 부정 신호("자극적이에요", "안 맞아요") 추적 → 세션 내 거절 상품 반복 방지
- "다른 거 없어?" 흐름에서 이전 추천을 회피하는 멀티턴 변화

### 6. MCP 표준 완전 준수 + GEN-UI 위젯
| 메서드 / 엔드포인트 | 설명 |
|-----------|------|
| `tools/list`, `tools/call` | JSON-RPC 도구 인터페이스 |
| `resources/read` | GEN-UI React 위젯 리소스 제공 |
| `GET /mcp` · `GET /mcp/sse` | SSE 스트리밍 채널 |
| `POST /mcp/message` | JSON-RPC 요청 수신 |
| `GET /.well-known/openai-apps-challenge` | App 제출용 소유권 확인 |

---

## 🧠 설계 하이라이트

> 이 프로젝트에서 가장 신경 쓴 엔지니어링 판단들.

### 핫패스에서 LLM 제거 → 지연·비결정성 동시 해결
초기 파이프라인은 요청 1건당 **LLM을 2번 순차 호출**(의도 정규화 + 리랭킹)했습니다.
- 문제: 응답이 느려 ChatGPT 툴 타임아웃으로 **간헐적 크래시**, 그리고 같은 질문에 **매번 다른 결과**
- 해결: 의도 파싱을 결정론적 규칙 엔진으로 대체하고 LLM 리랭커를 제거. 뉘앙스는 임베딩 유사도가 담당
- 결과: **응답 30초+ 타임아웃 → 1~2초**, 그리고 **동일 입력 → 동일 출력**

### 의미 검색의 비용·지연 경계화
전체 카탈로그를 매 요청마다 임베딩하면 수십 번의 순차 API 호출이 발생합니다.
임베딩 대상을 **인기 신호로 사전 선별한 상위 N개로 제한**하고 콘텐츠 해시 기반 1시간 캐시를 둬,
품질을 유지하면서 비용과 지연을 상수로 묶었습니다.

### 서브초(sub-second) 응답을 위한 인메모리 카탈로그
Cafe24 Admin API를 요청 경로에서 직접 호출하지 않습니다.
부팅 시 + **10분 주기**로 전체 상품을 메모리에 동기화하고, 추천은 이 캐시 위에서 수행합니다.

### 오타·띄어쓰기에 강한 상품명 매칭
Levenshtein 편집거리 기반 퍼지 매칭으로 "아쿠아티까"(오타) 같은 입력도 정확히 해당 상품에 연결합니다.
단, 카테고리 보완용(관대)과 상품명 확정용(엄격)에 **서로 다른 임계값**을 적용해 오탐을 억제합니다.

### 재심사 리스크 없는 단일 툴 설계
심사는 단일 도구(`search_cafe24_real_products`)로 통과했습니다.
이후의 모든 의도 분기(상품명/품절/남성용/조건/인기)는 **툴을 늘리지 않고 서버 로직 안에서** 해결해,
스키마 변경으로 인한 재심사 리스크를 제거했습니다.

### 토큰 영속화
Cafe24 OAuth 토큰을 MongoDB에 저장 → 서버 재시작·재배포 후에도 인증 상태 유지.

---

## 🛠️ 기술 스택

| 분류 | 기술 |
|------|------|
| Runtime | Node.js 20.x (ES Modules) |
| Framework | Express 4.x |
| Database | MongoDB 7.x (Mongoose) — OAuth 토큰 영속화 |
| Cache | In-memory 상품 카탈로그 (10분 동기화) |
| External API | Cafe24 Admin API (OAuth 2.0) |
| AI | OpenAI Embeddings (`text-embedding-3-small`) + 규칙 기반 태깅 |
| Protocol | Model Context Protocol (JSON-RPC over SSE) |
| Frontend | React + Vite (GEN-UI 추천 위젯) |
| Deploy | Render (auto-deploy from `main`) |

---

## 🗺️ 추천 파이프라인

```
tools/call
   │
   ├─ Stage 0  상품명 감지 (퍼지, 전체 카탈로그 대조)
   │             ├─ 판매중 매칭 → 1순위 고정 (buildExactMatchResponse)
   │             └─ 품절만 매칭 → "품절" 안내 + 대안
   │
   ├─ 남성 의도 감지 → #남성용 태그 상품 우선 (buildMensResponse, 세트 허용)
   │
   ├─ 카테고리/제형 해석 (규칙 기반, "스킨케어" 같은 umbrella 용어 제외)
   │
   ├─ 인메모리 캐시에서 후보 검색 (카테고리 잠금 + 보완 키워드)
   │
   ├─ 스코어링
   │     조건 적합 + 품질/인기 + 의미유사도 보강
   │     − 프로모/번들/다양성/반복 페널티
   │
   ├─ 정책 게이트 (카테고리/제형 잠금, 프로모 분리, base_name 중복 제거)
   │
   └─ 계층형 응답 + 위젯 body 텍스트 + 세션 컨텍스트 갱신
```

주요 모듈:

| 파일 | 역할 |
|------|------|
| `routes/mcp.js` | MCP 게이트웨이 · `executeTool` (의도 라우팅 진입점) |
| `services/recommendationService.js` | 추천 파이프라인 오케스트레이션 |
| `services/recommendation/intentParser.js` | 결정론적 의도 파싱 (카테고리·제형·피부·고민) |
| `services/recommendation/ranker.js` | 스코어링·다양성·중복 제거 |
| `services/recommendation/semanticRetriever.js` | 임베딩 유사도 보강 (경계화·캐시) |
| `services/cafe24ApiService.js` | Cafe24 동기화 · 인메모리 캐시 · 매칭 헬퍼 |
| `config/recommendationPolicy.js` | 가중치·임계값·택소노미 (튜닝 단일 지점) |

---

## ⚙️ 시작하기

### 요구 사항
- Node.js 20.x
- MongoDB 인스턴스
- Cafe24 개발자 앱 (Admin API 권한)
- OpenAI API 키

### 설치 & 실행

```bash
npm install            # 의존성 설치 (client 빌드 포함, postinstall)
cp .env.example .env   # 환경변수 작성

npm run dev            # 개발 (파일 변경 감지)
npm start              # 프로덕션
npm test               # 테스트 (node --test)
```

### 환경변수

```env
# ── 필수 ──
MALL_ID=your_mall_id
CLIENT_ID=your_cafe24_client_id
CLIENT_SECRET=your_cafe24_client_secret
REDIRECT_URI=https://your-domain.com/cafe24/callback
SCOPE=mall.read_product,mall.read_category
MONGO_URI=mongodb+srv://...
OPENAI_API_KEY=sk-...

# ── 선택 ──
PORT=3000
PUBLIC_BASE_URL=https://your-domain.com     # 위젯 리소스 절대 URL
SEMANTIC_RETRIEVAL_ENABLED=true             # 의미 유사도 보강 on/off
EMBEDDING_MODEL=text-embedding-3-small
ENRICH_MAX_FETCH_INGREDIENT=4               # 성분 질의 시 상세 조회 상한
CATEGORY_NO_OVERRIDES={"선케어":[29]}        # 이름 탐지가 놓친 카테고리 시드 (하위 포함)
LOG_LEVEL=info
```

### Cafe24 OAuth 연동

```
1. GET /cafe24/start      → Cafe24 인증 페이지로 리다이렉트 (state 발급)
2. GET /cafe24/callback   → 토큰 수신 후 MongoDB 저장
3. 이후 요청              → DB에서 토큰 자동 로드 (재시작 무관, 만료 시 자동 리프레시)
```

관리용 대시보드: `GET /api/dashboard` (인증/토큰/캐시 상태 링크)

---

## 🧪 테스트 & 검증

- 계약 테스트: `tests/mcp.minimal-structured.contract.test.js` (응답 구조 고정 검증)
- 정책 테스트: 선크림 제형 가드, 상품 키워드 제약 등
- 정책 유효성: `node scripts/validate-recommendation-policy.mjs`
- 운영 계측: `GET /debug/recommendation-metrics` (fallback률·정책 위반·no-result률 등)

로컬에서 MCP 툴을 직접 호출하려면 SSE 채널을 연 뒤 `POST /mcp/message`로 JSON-RPC를 보냅니다.
(자세한 방법은 [`HANDOVER.md`](HANDOVER.md) 참고)

---

## 📁 프로젝트 구조

```
cafe24-api/
├── server.js                     # 엔트리포인트 · 라우팅 · 백그라운드 싱크
├── routes/
│   ├── mcp.js                    # MCP 게이트웨이 (executeTool)
│   ├── mcpResponseContract.js    # 위젯 응답 계약
│   └── cafe24.js                 # OAuth · 진단 라우트
├── services/
│   ├── recommendationService.js  # 추천 파이프라인 오케스트레이션
│   ├── cafe24ApiService.js       # Cafe24 동기화 · 인메모리 캐시
│   ├── cafe24AuthService.js      # OAuth 토큰 교환/리프레시
│   ├── aiTaggingService.js       # 상품 태깅
│   └── recommendation/           # intentParser · ranker · semanticRetriever …
├── config/                       # env · recommendationPolicy (택소노미·가중치)
├── models/ · stores/             # Mongoose 스키마 · 토큰/상태 스토어
├── client/                       # React + Vite 추천 위젯
├── docs/                         # 스펙 · 테스트 로그 · 로깅 가이드
└── tests/                        # 계약·정책 테스트
```

---

## 🕘 History

| 시기 | 주요 변화 |
|------|-----------|
| 2026-04 | Cafe24 OAuth 연동, MCP 통신 구조 · 룰 기반 스코어링 · App-in-GPT 위젯 계약 정비 |
| 2026-05 | 카드 UX 개편, 베스트셀러/다양성 로직, 위젯 body 템플릿 고정 |
| 2026-06 | 카테고리 오탐 방지(strict form pool, sample-size 필터), App 제출 자산 추가 |
| 2026-07 | 🎉 **ChatGPT App 심사 통과 · 정식 등록** |
| 2026-07 | ⚡ **추천 엔진 리팩터링** — 핫패스 LLM 제거(지연 30s→1~2s, 결정론화), 상품명 퍼지 매칭·품절 정직성·남성 의도 라우팅·프로모 필터 정교화 |

전체 이력은 [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md), 유지보수 가이드는 [`HANDOVER.md`](HANDOVER.md)를 참고하세요.
