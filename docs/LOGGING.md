# Logging Guide

## 목적
운영 로그와 디버그 로그를 분리해 원인 파악을 빠르게 하고, 심사/제출 시 증빙 가능한 로그를 일관되게 남기는 것이 목적입니다.

## 로그 레벨

- `debug`: 상세 진단
- `info`: 운영 이벤트
- `warn`: 복구 가능한 경고
- `error`: 실패/예외
- `silent`: 로그 비활성

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
- `LOG_TOKEN_EVENTS`: OAuth 토큰 만료/갱신 이벤트 로그

## 추천 경로 핵심 로그

- `[Intent] source=... category=... form=...`
- `[Semantic] model=... candidates=... top_score=...`
- `[SemanticDiag] enabled=... nonzero=... skip_reason=...`
- `[Rank Pool] candidates=... stage1=...`
- `[Rank Debug] rank=... product=... base_score=... reason_code=...`
- `[Main Policy Gate] pre=... pass=... final=... drops={...}`
- `[MCP Tool] search_cafe24_real_products ok ... elapsed_ms=...`

## 본문-카드 정합 로그 (mcp_v2_3)

MCP 본문 템플릿 적용 여부와 카드 1위 정합성을 확인하는 로그입니다.

- `body_template_version=mcp_v2_3`
- `body_items_count=<main_recommendations.length>`
- `body_conclusion_product="<본문 결론 제품명>"`
- `main_top1_product="<카드 1위 제품명>"`
- `body_top1_match=true|false`

예시:

```txt
[Body Sync] body_template_version=mcp_v2_3 body_items_count=3 body_conclusion_product="..." main_top1_product="..." body_top1_match=true
```

해석:

- `body_template_version=mcp_v2_3`: 최신 MCP 본문 템플릿 사용
- `body_items_count`: 본문에서 설명한 추천 개수
- `body_top1_match=true`: 본문 결론과 카드 1위가 일치

## 정책 위반 감시 로그

- Category lock 위반:
  - `[Policy] category lock violation detected ...`
- Form lock 위반:
  - `[Policy] form lock violation detected ...`

## 운영 메트릭 확인

`GET /debug/recommendation-metrics`

주요 지표:

- `category_lock_violation_count`
- `form_lock_violation_count`
- `fallback_count`
- `no_result_count`
- `fallback_rate`
- `no_result_rate`

## 권장 운영 프로파일

### 운영 기본

```env
LOG_LEVEL=info
LOG_MCP_VERBOSE=false
LOG_CACHE_FILTER=false
LOG_TOKEN_EVENTS=false
```

### 상세 분석

```env
LOG_LEVEL=debug
LOG_MCP_VERBOSE=true
LOG_CACHE_FILTER=true
LOG_TOKEN_EVENTS=true
```

