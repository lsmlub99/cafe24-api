# CellFusionC AI Recommendation MCP

Cafe24 상품 데이터를 기반으로 ChatGPT(App in GPT) 안에서 실시간 추천을 제공하는 MCP 서버입니다.  
핵심 목표는 `정확한 카테고리 추천`, `안정적인 위젯 렌더링`, `운영 가능한 로그/지표`입니다.

## 핵심 특징
- Category/Form Lock 정책으로 main 추천 영역 품질 보장
- 메인 추천과 보조 추천 분리
  - `main_recommendations`
  - `secondary_recommendations`
  - `promotions`
- 하이브리드 랭킹
  - Fast path: 구조화 피처 + 정책 기반 점수
  - Precise path: LLM top-N 재랭크(선택)
  - Semantic path: 임베딩 기반 의미 점수 보강(옵션)
- 세션 컨텍스트 반영
  - `안 맞아요`, `따가워요` 같은 부정 신호를 다음 추천에 반영
- App in GPT 위젯 대응
  - MCP `tools/list`, `tools/call`, `resources/read` 계약 준수
  - `structuredContent` 중심 응답

## 아키텍처
- Backend: Node.js + Express
- Data Source: Cafe24 Admin API
- Storage: MongoDB(토큰 영구 저장), In-memory 상품 캐시
- MCP Gateway: `routes/mcp.js`
- Recommendation Core: `services/recommendationService.js`
- Recommendation Modules: `services/recommendation/*`
- Widget: React + Vite (`client/src/App.jsx`)

## 추천 파이프라인
1. 사용자 입력 파싱 (`intentParser`)
2. LLM 기반 의도 정규화 (`intentNormalizer`, 실패 시 룰 파서 fallback)
3. Cafe24 상품 정규화/피처 추출 (`productNormalizer`, `featureExtractor`)
4. 후보 검색 (카테고리/폼 정책 반영 + 임베딩 의미 점수 보강)
5. 랭킹 (`ranker`)
6. 응답 생성 (`main/secondary/promotions + summary`)
7. MCP tool 응답 + 위젯 렌더

## 주요 엔드포인트
- `GET /mcp` (SSE)
- `GET /mcp/sse` (호환 SSE)
- `POST /mcp/message` (JSON-RPC)
- `POST /mcp/messages` (호환 JSON-RPC)
- `GET /ui/recommendation` (위젯 템플릿)
- `GET /debug/cache`
- `GET /debug/recommendation-metrics`
- `GET /debug/product/:productNo`

## 환경 변수
필수:
- `PORT`
- `MONGO_URI`
- `MALL_ID`
- `CLIENT_ID`
- `CLIENT_SECRET`
- `REDIRECT_URI`
- `SCOPE`
- `OPENAI_API_KEY`

추천:
- `PUBLIC_BASE_URL`
- `RERANK_MODEL` (기본: `gpt-4o-mini`)
- `EMBEDDING_MODEL` (기본: `text-embedding-3-small`)
- `SEMANTIC_RETRIEVAL_ENABLED` (기본: `true`)
- `LOG_LEVEL`, `LOG_MCP_VERBOSE`, `LOG_CACHE_FILTER`, `LOG_TOKEN_EVENTS`

## 로컬 실행
```bash
npm install
npm install --prefix client
npm run build --prefix client
node server.js
```

## 문서
- 추천 정책/응답 계약: `docs/RECOMMENDATION_MCP_SPEC.md`
- 프로젝트 변경 이력/계획: `docs/PROJECT_PLAN.md`
- 로그 정책: `docs/LOGGING.md`
- 앱 제출 테스트 로그 템플릿: `docs/APP_SUBMISSION_TEST_LOG.md`
