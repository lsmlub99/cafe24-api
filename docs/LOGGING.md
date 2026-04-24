# Logging Guide

## 목적
운영 로그와 디버그 로그를 분리해서, 장애 원인 파악은 빠르게 하고 평시 로그 노이즈는 낮추는 것이 목표입니다.

---

## 서버 로그 레벨

- `debug`: 상세 진단
- `info`: 운영 이벤트
- `warn`: 복구 가능한 경고
- `error`: 실패/예외
- `silent`: 로그 비활성

---

## 환경 변수

```env
LOG_LEVEL=info
LOG_MCP_VERBOSE=false
LOG_CACHE_FILTER=false
LOG_TOKEN_EVENTS=false
```

### 옵션 설명

- `LOG_LEVEL`: 전체 로그 출력 기준
- `LOG_MCP_VERBOSE`: initialize/resources/list/tools/list 상세 로그
- `LOG_CACHE_FILTER`: 캐시 필터링 상세 로그
- `LOG_TOKEN_EVENTS`: OAuth 토큰 갱신/만료 관련 로그

---

## 추천 엔진 핵심 로그 라인

- `[Intent] source=... category=... form=...`
- `[Semantic] model=... candidates=... top_score=...`
- `[SemanticDiag] enabled=... nonzero=... skip_reason=...`
- `[Rank Pool] candidates=... stage1=...`
- `[Rank Debug] rank=... product=... base_score=... reason_code=...`
- `[Main Policy Gate] pre=... pass=... final=... drops={...}`
- `[MCP Tool] search_cafe24_real_products ok ... elapsed_ms=...`

---

## 정책 위반 감시 로그

- Category lock 위반:
  - `[Policy] category lock violation detected ...`
- Form lock 위반:
  - `[Policy] form lock violation detected ...`

위반 로그가 1건이라도 발생하면 회귀 가능성으로 즉시 재검증합니다.

---

## 프론트(위젯) CTA 디버그

`App.jsx` follow-up 체인 원인 확정용 계측입니다.

### 활성화

- URL 쿼리: `?debugCta=1`
- 또는 세션: `sessionStorage.debug_cta=1`

### 주요 이벤트

- `cta_pointer_down`
- `cta_clicked`
- `followup_enter`
- `followup_skip_empty_query`
- `followup_skip_loading_guard`
- `followup_fetch_start`
- `followup_fetch_response`
- `followup_request_aborted`
- `followup_request_failed`

### URL/Origin 진단 필드

- `api_base_url_injected` (`window.__API_BASE_URL__`)
- `resolved_request_url`

---

## 운영 메트릭 확인

`GET /debug/recommendation-metrics`

주요 확인값:

- `category_lock_violation_count`
- `form_lock_violation_count`
- `fallback_count`
- `no_result_count`
- `fallback_rate`
- `no_result_rate`

---

## 권장 운영 프로파일

### 운영 기본

```env
LOG_LEVEL=info
LOG_MCP_VERBOSE=false
LOG_CACHE_FILTER=false
LOG_TOKEN_EVENTS=false
```

### 장애 분석

```env
LOG_LEVEL=debug
LOG_MCP_VERBOSE=true
LOG_CACHE_FILTER=true
LOG_TOKEN_EVENTS=true
```
