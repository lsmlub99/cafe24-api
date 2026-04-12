# CellFusionC AI Recommendation Engine (MCP + GenUI)

Cafe24 상품 데이터를 기반으로 ChatGPT 안에서 네이티브 위젯(GenUI) 추천 경험을 제공하는 MCP 서버입니다.

## What This Project Solves
- 추천 정확도: 룰 기반 1차 선별 + LLM 2차 재랭크(STAGE1/STAGE2)
- 응답 속도: 메모리 캐시 중심 추천, 주기적 동기화
- UX 품질: MCP 리소스 템플릿(`text/html;profile=mcp-app`)으로 카드형 위젯 렌더
- 운영 안정성: 토큰 영구 저장(MongoDB), 토큰 자동 갱신, 로그 레벨 제어

## Architecture
- Backend: Node.js + Express
- Data: Cafe24 Admin API + MongoDB
- Recommendation Core: `services/recommendationService.js`
- MCP Gateway: `routes/mcp.js`
- Widget UI: React(Vite) `client/src/App.jsx`

Flow:
1. ChatGPT가 MCP `tools/call` 실행
2. 서버가 캐시/카테고리/태깅 기반 후보 추출
3. 추천 엔진이 스코어링 및 재랭크
4. `structuredContent` + `_meta` 반환
5. ChatGPT가 위젯 템플릿 로드 후 카드 UI 렌더

## Key Endpoints
- `GET /mcp` (SSE)
- `GET /mcp/sse` (호환 SSE)
- `POST /mcp/message` (JSON-RPC)
- `POST /mcp/messages` (호환 JSON-RPC)
- `GET /ui/recommendation` (위젯 HTML 엔트리)
- `POST /api/recommend` (웹 UI용 직접 추천 API)
- `GET /debug/cache` (캐시/동기화 상태 점검)
- `GET /debug/product/:productNo` (상품 상세 필드 점검)

## Local Setup
1. Install
```bash
npm install
npm install --prefix client
```

2. Configure `.env`
```env
NODE_ENV=development
PORT=10000
MONGO_URI=...
MALL_ID=...
CLIENT_ID=...
CLIENT_SECRET=...
REDIRECT_URI=...
SCOPE=mall.read_product mall.read_category
OPENAI_API_KEY=...
PUBLIC_BASE_URL=http://localhost:10000

# Optional logging controls
LOG_LEVEL=debug
LOG_MCP_VERBOSE=false
LOG_CACHE_FILTER=false
LOG_TOKEN_EVENTS=false
```

3. Build + Run
```bash
npm run build --prefix client
node server.js
```

## Logging Policy
로그는 `utils/logger.js`를 통해 레벨 기반으로 제어됩니다.

- `info`: 운영 핵심 이벤트 (sync start/success, tools/call, resources/read)
- `debug`: 상세 진단 (API 요청, 내부 분기)
- `warn/error`: 장애/예외
- `LOG_MCP_VERBOSE=true`: initialize/tools-list/resources-list 등 상세 MCP 트래픽 로그 표시
- `LOG_CACHE_FILTER=true`: category/keyword 필터 상세 로그 표시
- `LOG_TOKEN_EVENTS=true`: 토큰 저장 이벤트 로그 표시

자세한 기준은 [LOGGING.md](docs/LOGGING.md) 참고.

## Project Plan
현재/다음 단계 실행 계획은 [PROJECT_PLAN.md](docs/PROJECT_PLAN.md) 참고.

## Portfolio Highlights
- MCP Apps/ChatGPT 위젯 채택 이슈를 `resources/read + outputTemplate + resourceUri + CSP` 정합성으로 해결
- 추천 결과에 대해 “정상/빈결과” 모두 위젯 렌더가 깨지지 않도록 안전 처리
- 운영 로그를 노이즈 로그와 핵심 로그로 분리해 디버깅 효율 향상

## License
Private project for CellFusionC recommendation experience.
