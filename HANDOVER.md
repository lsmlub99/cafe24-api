# 인수인계 가이드 (HANDOVER)

이 문서는 이 서버를 이어받아 유지보수할 개발자를 위한 실무 가이드입니다.
"무엇을 어디서 고치고, 어떻게 테스트하고 배포하는지"에 집중합니다.
개요·설계 배경은 [`README.md`](README.md)를 먼저 읽으세요.

---

## 1. 한눈에 보기

| 항목 | 내용 |
|------|------|
| 역할 | ChatGPT App(MCP)의 백엔드. 자연어 → Cafe24 상품 추천 |
| 실행 | Render (무료 플랜), `main` 브랜치 push 시 **자동 배포** |
| 런타임 | Node.js 20.x, ES Modules |
| 데이터 | MongoDB(토큰만 영속) + **인메모리 상품 캐시**(10분 동기화) |
| 외부 | Cafe24 Admin API, OpenAI Embeddings |
| MCP 도구 | **단일 도구** `search_cafe24_real_products` (⚠️ 늘리지 말 것 — 아래 4번) |
| 공개 URL | `https://cafe24-api.onrender.com` |

---

## 2. 로컬 실행

```bash
npm install
cp .env.example .env      # 값 채우기 (아래 표)
npm run dev               # node --watch server.js
```

부팅 시 MongoDB 연결 → 토큰이 있으면 전체 상품을 메모리에 싱크합니다.
토큰이 없으면 먼저 브라우저로 `GET /cafe24/start` → 콜백까지 완료해 OAuth 토큰을 DB에 저장하세요.

### 필수 환경변수

| 키 | 설명 |
|----|------|
| `MALL_ID` | Cafe24 몰 ID |
| `CLIENT_ID` / `CLIENT_SECRET` | Cafe24 앱 자격증명 |
| `REDIRECT_URI` | OAuth 콜백 (`.../cafe24/callback`) |
| `SCOPE` | Cafe24 권한 스코프 |
| `MONGO_URI` | MongoDB 접속 문자열 |
| `OPENAI_API_KEY` | 임베딩용 |

### 자주 쓰는 선택 환경변수

| 키 | 기본 | 설명 |
|----|------|------|
| `PUBLIC_BASE_URL` | (없음) | 위젯 리소스 절대 URL. 배포 환경에서 필수 |
| `SEMANTIC_RETRIEVAL_ENABLED` | `true` | 의미 유사도 보강 on/off (비용 절감 시 off) |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | |
| `ENRICH_MAX_FETCH_INGREDIENT` | `4` | 성분 질의 시 상세 API 조회 상한(순차 호출이라 지연 요인) |
| `CATEGORY_NO_OVERRIDES` | (없음) | 이름 탐지가 놓친 카테고리 시드 ID. 예 `{"선케어":[29]}` |
| `LOG_MCP_VERBOSE` | `false` | MCP 상세 로그 |

전체 목록은 [`config/env.js`](config/env.js) 참조. 필수 키가 없으면 부팅이 즉시 중단됩니다.

---

## 3. 배포

- `main`에 push → Render가 자동 빌드/배포. `npm install`의 `postinstall`이 client(React)까지 빌드합니다.
- 배포 반영에 보통 1~3분. 배포 로그는 Render 대시보드에서 확인.
- 롤백은 이전 커밋으로 되돌려 push(또는 Render의 이전 배포 재실행).

---

## 4. ⚠️ 꼭 알아야 할 제약/함정

1. **MCP 도구는 단 하나.** ChatGPT App 심사가 `search_cafe24_real_products` 단일 도구로 통과됐습니다.
   도구를 추가/이름변경/스키마 대폭 변경하면 **재심사 대상**이 됩니다.
   새로운 의도 처리는 도구를 늘리지 말고 `routes/mcp.js`의 `executeTool` 서버 로직 안에서 분기하세요.
   (기존 예: 상품명 핀, 품절 안내, 남성 의도 — 모두 단일 도구 안에서 처리)

2. **Render 무료 플랜 콜드스타트.** 15분 무요청이면 인스턴스가 잠들고, 이후 첫 요청이 30~50초 걸립니다.
   이때 ChatGPT가 타임아웃으로 "분석 중"에서 멈출 수 있습니다.
   → 해결책: 외부 업타임 모니터(UptimeRobot/cron-job.org 등)로 5~10분 간격 `GET /` 핑, 또는 유료 always-on 플랜.

3. **상품 데이터는 인메모리 + 10분 지연.** 가격/재고/신상 변경은 최대 10분 뒤 반영됩니다
   (`server.js`의 `startSyncLoop`, `setInterval 10분`). 즉시 확인이 필요하면 `GET /debug/cache?force=true`.

4. **재고 필터.** 추천 후보는 `display==='T' && selling==='T'`만 포함(`getProductsFromCache`).
   품절 상품은 `findSoldOutProductMatches`로 별도 매칭해 "품절" 안내에만 사용합니다.

5. **인코딩 주의(개발 테스트 시).** Windows Git Bash에서 curl 인자로 한글을 직접 넘기면 깨집니다.
   MCP 테스트는 반드시 **JSON 파일 + `--data-binary @file`** 또는 Node fetch로 UTF-8을 보장하세요.

6. **결정론성.** 핫패스 LLM과 랜덤 노이즈를 제거했으므로 같은 입력엔 같은 출력이 나와야 합니다.
   단, 세션 컨텍스트(부정신호/variety)로 인해 같은 대화 내 후속 요청은 의도적으로 달라질 수 있습니다.

7. **게시된 툴의 스키마/`_meta`를 라이브에서 바꾸지 말 것.** 게시본(curated)은 승인 시점의 툴 계약을
   스냅샷으로 들고 있어서, 라이브 `tools/list`가 그와 어긋나면 **일반 사용자 계정에 툴이 아예 주입되지
   않는 장애**가 납니다(실제로 겪음: `product_name` 필드를 추가했다가 발생). 라이브 = 게시 버전 계약을
   항상 일치시키고, 계약 변경은 반드시 **새 버전을 의도적으로 게시(재심사)**할 때만.

8. **클라이언트별 위젯 처리 차이 (ChatGPT 웹/앱 vs Codex).** 웹·모바일 앱은 툴의 HTTP `outputTemplate`
   으로 위젯을 잘 렌더링하지만, **Codex는 `ui://widget/...` 스킴을 기대**해 HTTP URI를 `-32002 Unknown
   resource`로 거절합니다(카드 대신 대체 텍스트만). Codex까지 지원하려면 `openai/outputTemplate`을
   `ui://`로 바꿔야 하는데 이는 `_meta` 변경 = 재심사 대상. 웹/앱이 실사용 경로면 그대로 둬도 됩니다.
   (참고: `resources/read`는 이제 URI 끝 슬래시 유무를 모두 허용하도록 이미 보정됨.)

9. **모바일 이미지 도메인.** 상품 이미지는 `img.cellfusionc.co.kr`에서 서빙해야 합니다. 맨 도메인
   `cellfusionc.co.kr`은 모바일 UA에서 `m.cellfusionc.co.kr`로 301 리다이렉트하는데 그 도메인이 위젯
   CSP 허용목록에 없어 **폰에서 이미지가 깨집니다(? 표시)**. 재작성은 `productNormalizer.js`에 있음.
   (새 이미지 도메인이 생기면 CSP 허용목록도 함께 봐야 함 — CSP는 `routes/mcp.js`의 `RESOURCE_META`.)

10. **배포 직후 캐시 재구축 창.** 재배포 시 인메모리 캐시가 비고, 그 직후 첫 요청이 전체 동기화(~20초)를
    붙잡아 ChatGPT 타임아웃을 유발할 수 있습니다. 배포 직후 1~3분은 테스트를 피하거나, 먼저 `GET /`으로
    서버를 한 번 깨운 뒤 테스트하세요.

---

## 5. 코드 지도 — "이거 고치려면 어디?"

| 하고 싶은 것 | 파일 · 지점 |
|------|------|
| 추천 흐름 전체 진입점 | `routes/mcp.js` → `executeTool()` |
| 상품명 감지/핀 로직 | `routes/mcp.js`(Stage 0) + `cafe24ApiService.findConfidentProductMatches` + `recommendationService.buildExactMatchResponse` |
| 품절/속성-없음 안내 문구 | `routes/mcp.js` (`soldOutNotice` / `unmetKeywords` 블록) |
| 남성 의도 처리 | `cafe24ApiService.findMensProducts` + `recommendationService.buildMensResponse` |
| 카테고리/제형 인식 | `services/recommendation/intentParser.js` (`parseUserIntent`) |
| 카테고리 별칭·동의어 | `routes/mcp.js`(`CATEGORY_SYNONYM_MAP`) + `config/recommendationPolicy.js`(`RECOMMENDATION_TAXONOMY`) |
| **랭킹 가중치·임계값 튜닝** | `config/recommendationPolicy.js` (단일 튜닝 지점) |
| 점수 계산식 | `services/recommendation/ranker.js` (`calculateMainScoreBreakdown`) |
| 프로모/세트 판별 | `services/recommendation/shared.js` (`isPromoName`) + `recommendationService`(`enforceMainPolicyOnRanked`) |
| 의미 유사도(임베딩) | `services/recommendation/semanticRetriever.js` |
| Cafe24 동기화/캐시 | `services/cafe24ApiService.js` (`syncAllProductsCore`, `getProductsFromCache`) |
| 위젯 응답 구조 | `routes/mcpResponseContract.js` + `client/` |
| 응답 카드 본문 텍스트 | `routes/mcp.js` (`buildCanonicalConsultTextFixed`) |

---

## 6. 추천 파이프라인 상세

`executeTool(args)` 순서:

1. 캐시 비어있으면 온디맨드 싱크
2. **Stage 0 — 상품명 감지**: `product_name`/`q`/`category`/`concerns`를 합친 원문을 전체 카탈로그와 퍼지 대조
   - 판매중 매칭 있으면 → `__exact_match_product_nos` 전달 → `buildExactMatchResponse`가 1순위 고정
   - 판매중 매칭 없고 품절만 있으면 → `soldOutMatchName` 세팅 → 응답에 품절 안내
3. **남성 의도**: 원문에 남성 마커 있으면 `findMensProducts()` 결과를 풀에 보강 + `__mens_intent` 전달
4. 카테고리 정규화(`normalizeCategory`) → 카테고리 ID 해석 → 캐시에서 후보 검색(+보완 키워드)
5. `recommendationService.scoreAndFilterProducts(rawProducts, args, 3)`
   - 상품명 핀 / 남성 의도면 전용 short-circuit
   - 아니면: 규칙 의도 파싱 → 후보 스코어링 → 의미 보강 → 정책 게이트 → 계층 응답
6. 위젯 body 텍스트 생성(품절/속성-없음 안내 prepend) → MCP 결과 반환

`scoreAndFilterProducts` 내부의 점수 = 조건 적합 + 품질/인기 + 의미유사도 − (프로모·번들·다양성·반복 페널티).
`config/recommendationPolicy.js`의 `RECOMMENDATION_POLICY.scoring`에서 전부 조정 가능.

---

## 7. 테스트 방법

### 유닛/계약 테스트
```bash
npm test
node scripts/validate-recommendation-policy.mjs
```

### 실서버 MCP 툴콜 (SSE + POST)
```bash
# 1) 페이로드를 파일로 (한글 인코딩 안전)
cat > q.json <<'JSON'
{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"search_cafe24_real_products",
 "arguments":{"category":"선크림","q":"아쿠아티카 있어요?"}}}
JSON

# 2) SSE 채널 열고 POST
curl -N -s https://cafe24-api.onrender.com/mcp/sse &   # 응답이 여기로 스트리밍됨
curl -s -X POST https://cafe24-api.onrender.com/mcp/message \
  -H "Content-Type: application/json" --data-binary @q.json
```
응답은 SSE로 오며 `result._meta.widgetData.main_recommendations`에 추천 배열, `reasoning_tags`에 의도 태그가 담깁니다.

### 진단 엔드포인트 (server.js, 운영 편의용)
| 엔드포인트 | 용도 |
|-----------|------|
| `GET /cafe24/products` | 캐시 상위 5개 상품 |
| `GET /debug/cache?force=true` | 캐시 상태 + 강제 재싱크 |
| `GET /debug/recommendation-metrics` | fallback률·정책 위반·no-result률 |
| `GET /debug/product/:productNo` | 특정 상품 상세 필드 검사 |
| `GET /api/dashboard` | 인증/토큰/캐시 링크 모음 |

> 진단용 임시 라우트를 추가했다면 검증 후 반드시 제거하세요 (`routes/cafe24.js`의 `/debug/*`는 정리 완료 상태).

---

## 8. 알려진 한계 / TODO 후보

- **콜드스타트**(4-2): 업타임 핑 또는 유료 플랜으로 해소 권장 — 사용자 체감 1순위 이슈.
- **작은 카탈로그**: 남성 라인이 현재 1개 세트뿐이라 남성 질의 결과가 1건. 상품이 늘면 자동으로 다건 랭킹됨.
- **카테고리 태깅 의존**: 검색은 Cafe24 카테고리 소속을 게이트로 씀. 신규 상품이 카테고리 미태깅이면 특정 카테고리 질의에서 누락될 수 있음 → `CATEGORY_NO_OVERRIDES`로 보완.
- **성분/행사/가격 의도**는 이번 범위에서 다루지 않음(현재는 상품명/조건/인기/남성 4갈래). 확장 시 `executeTool` 분기 + 태그 신호로 처리.
- 죽은 코드: `stage2Rerank`, `normalizeIntentWithLLM`, `generate_consult_narrative`는 핫패스에서 제거됐으나 함수 정의는 남아있음(재활성화 가능). 필요 없으면 정리 가능.

---

## 9. 참고 문서

- [`README.md`](README.md) — 개요·아키텍처·설계 배경
- [`docs/RECOMMENDATION_MCP_SPEC.md`](docs/RECOMMENDATION_MCP_SPEC.md) — 추천/MCP 스펙
- [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) — 날짜별 변경 이력
- [`docs/LOGGING.md`](docs/LOGGING.md) — 로깅 레벨/플래그
- [`chatgpt-app-submission.json`](chatgpt-app-submission.json) — App 제출 설정 · 승인 테스트 케이스
