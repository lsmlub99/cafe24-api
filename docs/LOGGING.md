# Logging Guide

## Overview
이 프로젝트는 `utils/logger.js`를 통해 로그를 통합 관리합니다.

목표:
- 운영 시 필요한 핵심 로그는 유지
- 디버그성 노이즈 로그는 플래그로 분리
- 장애 분석 시 필요한 맥락은 남기되 과도한 출력은 방지

## Log Levels
- `debug`: 상세 진단 로그
- `info`: 정상 운영의 핵심 이벤트
- `warn`: 복구 가능한 이상 상황
- `error`: 실패/예외
- `silent`: 로그 비활성화

## Environment Variables
```env
LOG_LEVEL=info
LOG_MCP_VERBOSE=false
LOG_CACHE_FILTER=false
LOG_TOKEN_EVENTS=false
```

### Meaning
- `LOG_LEVEL`
  - 전체 기본 로그 레벨
- `LOG_MCP_VERBOSE`
  - MCP initialize/tools-list/resources-list 같은 고빈도 이벤트 출력
- `LOG_CACHE_FILTER`
  - `getProductsFromCache` 내부 필터 매칭 로그 출력
- `LOG_TOKEN_EVENTS`
  - 토큰 저장/동기화 로그 출력

## Recommended Profiles
### Production
```env
LOG_LEVEL=info
LOG_MCP_VERBOSE=false
LOG_CACHE_FILTER=false
LOG_TOKEN_EVENTS=false
```

### Incident Debugging
```env
LOG_LEVEL=debug
LOG_MCP_VERBOSE=true
LOG_CACHE_FILTER=true
LOG_TOKEN_EVENTS=true
```

## Key Logs to Watch
- `[Sync] Product sync start...`
- `[Sync SUCCESS] Cached products: ...`
- `[MCP Inbound] method=tools/call id=...`
- `[MCP Protocol] resources/read requested: ...`
- `[MCP Tool] search_cafe24_real_products ok id=... recs=... elapsed_ms=...`
- `[MCP Error] ...`

## Notes
- ChatGPT 위젯 이슈 진단 시에는 `LOG_MCP_VERBOSE=true`를 먼저 켜고,
  `resources/list -> resources/read -> tools/call` 순서를 확인하세요.
- 디버그가 끝나면 반드시 verbose 플래그를 `false`로 되돌리는 것을 권장합니다.
- 기본(프로덕션)에서는 `Connected/Disconnected` 같은 SSE 연결 로그를 숨깁니다.
  이 로그는 `LOG_MCP_VERBOSE=true`일 때만 출력됩니다.
