# Recommendation MCP Spec (App in GPT / Cafe24)

## 1. 목적
Cafe24 기반 추천 MCP의 정책, 실행 흐름, 응답 계약을 정의합니다.  
핵심은 `정책 준수(category/form/promo)`와 `추천 품질(의미 기반 해석)`의 균형입니다.

## 2. 적용 범위
- MCP Tool: `search_cafe24_real_products`
- 주요 모듈:
  - `routes/mcp.js`
  - `services/recommendationService.js`
  - `services/recommendation/*`
  - `config/recommendationPolicy.js`

## 3. 정책 원칙
- 요청 카테고리가 있으면 main 추천은 category lock 유지
- form policy가 있으면 main 추천은 form lock 유지
- 프로모션/미니/기획형 상품은 main 추천에서 제외
- cross-sell은 secondary/promotion 영역에만 노출
- fallback에서도 category lock을 쉽게 해제하지 않음

## 4. Intent 구조
`parse_user_request(args)` + `normalizeIntentWithLLM(...)` 결과는 아래 필드를 가집니다.
- `requested_category`
- `requested_category_ids`
- `requested_form`
- `explicit_form_request`
- `skin_type`
- `concern[]`
- `situation[]`
- `preference[]`
- `fit_issue[]`
- `negative_scope`
- `allow_category_switch`
- `variety_intent`
- `novelty_request`
- `popularity_intent`
- `price_intent`
- `sort_intent`
- `query`

## 5. 상품 정규화
`normalizeCafe24Product(raw, taxonomy)`는 추천용 스키마로 변환합니다.
- 식별/가격/이미지: `id`, `name`, `price`, `image`
- 분류/제형: `category_ids`, `form`, `category_key`
- 설명 텍스트: `summary_description`, `search_preview`, `text`
- 구조화 속성: `attributes`, `derived_attributes`, `feature_vector`
- 품질 신호: `review_count`, `rating`, `sales_count`, `created_at_ms`
- 정책 필드: `is_promo`, `base_name`

## 6. Candidate Retrieval
Primary 후보 검색은 두 단계 개념입니다.
1. 넓은 후보 검색(relaxed form 가능)
2. 최종 main 구성 직전 정책 게이트(category/form/promo)

즉, “탐색은 유연하게, 최종 노출은 엄격하게”를 적용합니다.

## 7. Ranking
### 7.1 Fast Path
`calculateMainScoreBreakdown(...)` 기준:
- category gate
- condition score
- intent score
- quality score
- novelty score
- semantic boost(임베딩)
- price intent score
- query match score
- reactive/repeat/negative scope penalty
- promo/form mismatch penalty

### 7.2 Precise Path
- LLM top-N rerank (옵션)
- 실패 시 fast path 결과 사용

### 7.3 Semantic Retrieval
- 임베딩 모델: 기본 `text-embedding-3-small`
- 동작: primary candidates에 `_semantic_score` 추가 후 랭킹 반영
- 정책 락(category/form/promo)은 semantic 단계에서도 최종적으로 유지

ENV:
- `SEMANTIC_RETRIEVAL_ENABLED=true|false`
- `EMBEDDING_MODEL=text-embedding-3-small`

## 8. 세션 컨텍스트
세션 메모리를 통해 이전 실패 신호를 다음 추천에 반영합니다.
- `reactive_signals`
- `negative_preferences`
- `recent_main_base_names`
- `recent_main_forms`
- `recent_main_category`

예:
- “안 맞아요” 이후 동일 base/form 반복 추천에 penalty 적용
- “따가워요” 이후 soothing 우선 가중치 적용

## 9. Response Schema
신규 계약:
- `requested_category`
- `main_recommendations`
- `secondary_recommendations`
- `reasoning_tags`
- `applied_policy`

하위 호환:
- `recommendations` (= main)
- `reference_recommendations` (= secondary)
- `promotions`
- `summary`

위젯은 신규 계약 필드를 우선 사용하고, 레거시 필드는 fallback 용도입니다.

## 10. Fallback 정책
1. 같은 카테고리 내 조건 완화
2. 같은 카테고리 내 form 완화
3. 같은 카테고리 인기 fallback
4. 그래도 없으면 secondary-only 안내

주의:
- fallback을 이유로 무분별한 카테고리 이탈 금지
- main 슬롯에 프로모션 승격 금지

## 11. 운영 지표
- `category_lock_violation_count`
- `form_lock_violation_count`
- `fallback_rate`
- `no_result_rate`
- `top1_click_rate`
- `secondary_click_rate`
- `recommendation_to_purchase_rate`

Debug endpoint:
- `GET /debug/recommendation-metrics`

## 12. 성능 목표
- Fast path P95 < 800ms
- Precise path(LLM/semantic 포함) P95 < 2500ms

## 13. 현재 우선순위
1. 제출용 테스트 케이스 2회전 완료
2. 정책 위반 0 유지
3. 반복 추천률/전환률 기반 가중치 튜닝 자동화
