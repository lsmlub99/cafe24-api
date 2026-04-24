# Project Plan & Change History

## 문서 목적
이 문서는 CellFusion C 추천 MCP의 실행 계획과 실제 변경 이력을 함께 관리하기 위한 운영 문서입니다.  
초기 기획 문서라기보다, 실서비스에서 무엇을 언제 왜 바꿨는지 추적하는 데 목적이 있습니다.

---

## 프로젝트 목표

- Cafe24 상품 데이터를 App in GPT 환경에서 안정적으로 추천
- 카테고리/제형 정합성을 유지하면서 추천 다양성 개선
- 위젯/본문/로깅/메트릭까지 일관된 운영 품질 확보
- 제출 심사 기준(정책 위반 0, 위젯 안정성, 증빙 가능성) 충족

---

## 아키텍처 범위

- Backend
  - `routes/mcp.js`
  - `services/recommendationService.js`
  - `services/recommendation/*` (intent parser, ranker 등)
  - `config/recommendationPolicy.js`
- Frontend Widget
  - `client/src/App.jsx`
- 운영 문서
  - `docs/RECOMMENDATION_MCP_SPEC.md`
  - `docs/LOGGING.md`
  - `docs/APP_SUBMISSION_TEST_LOG.md`

---

## 기존 변경 이력 (요약)

### 2026-04-01 ~ 2026-04-05
- Cafe24 연동, OAuth/토큰 처리, MCP 기본 통신 구조 정비
- `tools/call -> 추천 응답` 기본 경로 안정화

### 2026-04-06 ~ 2026-04-08
- 룰 기반 점수 체계 고도화
- 텍스트 includes 중심에서 속성/점수 결합 구조로 확장

### 2026-04-09 ~ 2026-04-10
- App in GPT 위젯 계약 정비
- `/mcp`, `/mcp/sse`, `/mcp/message` 및 리소스 응답 안정화

### 2026-04-11 ~ 2026-04-13
- 캐시 초기화/동기화 race condition 보완
- 빈 결과/초기 요청 처리 안정화

### 2026-04-14 ~ 2026-04-17
- Category/Form/Promo 정책 강제 분리
- `main_recommendations`, `secondary_recommendations`, `promotions` 역할 고정

### 2026-04-17 ~ 2026-04-20
- intent normalization + reactive/session 신호 반영
- semantic 보강 경로 도입, 정책 게이트와 설명 정합성 강화

---

## 최근 업데이트 (기존 이력 뒤 추가)

### 2026-04-21 ~ 2026-04-24

#### 1) Phase 1 안정화 완료
- 설명-로직 불일치 제거(`reason_code` 기준 설명)
- policy 위반 계측 고정
  - `category_lock_violation_count`
  - `form_lock_violation_count`
  - `explanation_mismatch_count`
- fallback/metrics 진단 경로 정비

#### 2) Phase 2 진행 (semantic 활성화 보강)
- `empty_query` 진단 개선
- composed query 기반 semantic 경로 활성화
- cold-start와 조건 입력 케이스를 분리해 품질 점검

#### 3) 위젯 UX 레이어 개선 (엔진 불변)
- 카드/선택가이드/CTA 역할 분리
- 슬롯 기반 카드 카피(핵심 포인트/보조 설명/사용 팁) 정리
- follow-up 실패 UX 개선
  - abort vs 일반 실패 분리
  - 실패 시 기존 추천 유지 + 짧은 힌트 + 재시도 버튼

#### 4) CTA follow-up 원인 확정 계측 추가
- `App.jsx` 인터랙션 레이어 디버그 이벤트 체인 확장
  - `cta_pointer_down`, `cta_clicked`, `followup_enter`, `followup_fetch_start` 등
- URL/origin 분리 진단값 로그 포함
  - `window.__API_BASE_URL__`
  - resolved request URL
- 디버그 배지/콘솔 병행 계측으로 임베드 환경 추적성 보강

#### 5) 제출 준비 문서 정리
- `APP_SUBMISSION_TEST_LOG.md`를 12케이스 x 2회 실행 템플릿으로 표준화
- 증빙 스크린샷/로그 링크 규칙 정리

---

## 현재 상태 (2026-04-24 기준)

- 추천 엔진: 운영 가능(정책 게이트/설명 정합성 확보)
- 위젯 UX: 기능 안정화 + follow-up 디버그 계측 강화 중
- 심사 준비: 테스트 로그 템플릿/증빙 체계 정비 완료

---

## 다음 실행 계획

1. 12개 코어 케이스 2회씩 실행 및 표 채우기
2. `/debug/recommendation-metrics` 최종 스냅샷 확정
3. CTA follow-up 체인 실제 동작 원인 확정 후 최소 패치 반영
4. 제출 패키지(스크린샷/로그/요약) 최종 묶음

---

## 운영 기준

- `category_lock_violation_count == 0`
- `form_lock_violation_count == 0`
- `explanation_mismatch_count == 0`
- 위젯 렌더 안정성 유지(빈 카드/무한 로딩 없음)
- 본문/카드 추천 불일치 0건
