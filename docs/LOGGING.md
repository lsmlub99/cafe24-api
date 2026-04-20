# Logging Guide

## 목적
운영 로그와 디버그 로그를 분리해, 장애 분석은 빠르게 하고 평시 로그 노이즈는 줄이는 것이 목적입니다.

## 로그 레벨
- `debug`: 상세 진단 로그
- `info`: 운영 이벤트 로그
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
- `LOG_LEVEL`
  - 전체 로그 출력 기준
- `LOG_MCP_VERBOSE`
  - initialize/resources/list/tools/list 같은 고빈도 MCP 로그 출력
- `LOG_CACHE_FILTER`
  - cache category/keyword 필터 상세 로그 출력
- `LOG_TOKEN_EVENTS`
  - 토큰 갱신/저장 관련 로그 출력

## 추천 로그 핵심 라인
- `[Sync] Product sync start...`
- `[Sync SUCCESS] Cached products: ...`
- `[Intent] source=... category=... form=...`
- `[Semantic] model=... candidates=... pool=... top_score=...`
- `[Rank Pool] candidates=... stage1=...`
- `[Rank Debug] rank=... product=... base_score=...`
- `[MCP Tool] search_cafe24_real_products ok ... elapsed_ms=...`

## 정책 위반 감시 로그
- Category lock 위반:
  - `[Policy] category lock violation detected ...`
- Form lock 위반:
  - `[Policy] form lock violation detected ...`

위반 로그가 1건이라도 발생하면 추천 정책 회귀 가능성이 있으므로 즉시 재검증합니다.

## 운영 기본 프로필
```env
LOG_LEVEL=info
LOG_MCP_VERBOSE=false
LOG_CACHE_FILTER=false
LOG_TOKEN_EVENTS=false
```

## 장애 분석 프로필
```env
LOG_LEVEL=debug
LOG_MCP_VERBOSE=true
LOG_CACHE_FILTER=true
LOG_TOKEN_EVENTS=true
```
