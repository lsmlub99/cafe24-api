# Recommendation MCP Spec (App in GPT / Cafe24)

## 1. 목적
이 문서는 Cafe24 API 기반 상품 추천 MCP의 추천 정책/실행 구조를 명세한다.  
핵심 목표는 다음 두 가지다.

- 고객이 요청한 카테고리를 main recommendation에서 절대 우선 보장(category lock)
- App in GPT 위젯/툴 응답에서 main/secondary를 명확히 분리

## 2. 적용 범위
- MCP tool: `search_cafe24_real_products`
- 주요 모듈:
  - `routes/mcp.js`
  - `services/recommendationService.js`
  - `services/recommendation/*` (intent parser / normalizer / ranker)
  - `config/recommendationPolicy.js`

## 3. 설계 원칙
- 카테고리 잠금 우선: requested_category가 있으면 primary 후보는 해당 카테고리로 제한
- 제형 잠금 우선: requested_form이 있거나 카테고리 기본 제형 정책이 있으면 main은 해당 form으로 제한
- fallback도 카테고리 유지: 조건 완화는 허용, 카테고리 이탈은 금지
- cross-sell 분리: secondary에서만 노출
- fast path 우선: 구조화된 retrieval/ranking을 기본으로 사용
- precise path 제한: LLM은 top-N rerank에 한정
- backward compatibility: 기존 `recommendations`, `reference_recommendations`, `summary` 유지

## 4. 데이터/정책 구성
정책/택소노미는 `config/recommendationPolicy.js`에서 관리한다.

- `RECOMMENDATION_POLICY`
  - limits: 기본 main/secondary 개수, stage1/stage2 후보 크기
  - rerank: LLM weight, default model
  - scoring: category gate, promo penalty, quality caps
  - formPolicy:
    - `strictOnExplicitForm`: 제형 명시 시 main form 강제
    - `defaultMainFormsByCategory`: 카테고리별 기본 main 제형
    - `relaxedMainFormsByCategory`: fallback 시 같은 카테고리 내 완화 제형 범위
- `RECOMMENDATION_TAXONOMY`
  - categories/forms/skinTypes/concerns/situations/preferences
  - novelty/popularity keywords
  - category별 cross-sell 정책

## 5. 추천 파이프라인
### 5.1 Intent Parsing
함수: `parse_user_request(args)`  
구조화 결과:
- `requested_category`
- `requested_category_ids`
- `requested_form`
- `explicit_form_request`
- `skin_type`
- `concern[]`
- `situation[]`
- `preference[]`
- `novelty_request`
- `sort_intent`
- `query`

### 5.2 Product Normalization
함수: `normalizeCafe24Product(raw)`  
정규화 스키마:
- 기본: id, name, category_ids, price, image
- 추천용: base_name, form, text, summary_description
- 품질 신호: review_count, rating, sales_count, created_at_ms
- 부가: attributes(concern_tags/line_tags/texture_tags), is_promo

### 5.3 Primary Candidate Retrieval
함수: `get_primary_candidates(products, parsedIntent)`  
규칙:
- `requested_category` 또는 `requested_category_ids`가 있으면 `category_locked=true`
- form policy 적용 시 `form_locked=true` 및 `allowed_main_forms` 계산
- primary 후보는 category filter를 통과한 상품만 허용
- form lock이 걸린 경우 primary 후보는 `allowed_main_forms`를 통과한 상품만 허용

### 5.4 Ranking
함수: `rank_primary_recommendations(candidates, parsedIntent, limit, categoryLocked)`
- 1차 Fast Rank:
  - category gate
  - condition score
  - request-intent score(popular/new_arrival/condition_based)
  - quality score
  - promo penalty
- 2차 Precise Rank (선택):
  - top-N에 대해 LLM rerank
  - 실패 시 fast rank 결과 사용

### 5.5 Secondary Recommendation
함수: `get_secondary_recommendations(products, parsedIntent, mainItems, limit)`
- main에 포함된 base_name 제외
- taxonomy cross-sell category 정책을 통과한 후보만
- 품질+조건 점수 기반 정렬

### 5.6 Response Build
함수: `build_recommendation_response(parsedIntent, mainRecs, secondaryRecs, categoryLocked)`  
반환 스키마:
- 신규:
  - `requested_category`
  - `main_recommendations`
  - `secondary_recommendations`
  - `reasoning_tags`
  - `applied_policy`
- 하위 호환:
  - `recommendations` (= main_recommendations)
  - `reference_recommendations` (= secondary_recommendations)
  - `summary`

## 6. Fallback 정책
1. 카테고리 잠금 상태에서 조건 완화 fallback
2. 동일 카테고리 내 form 완화 fallback
3. 동일 카테고리 인기 fallback
4. 그래도 결과 없을 때만 `secondary_only` 예외 반환

중요: fallback 과정에서 category lock을 일반적으로 해제하지 않는다.

## 7. MCP 응답 계약
`routes/mcp.js`는 `executeTool()`에서 추천 결과를 받아 다음을 보장한다.

- `structuredContent`에 신규 스키마 + 하위 호환 필드 동시 포함
- `_meta.widgetData`에도 동일 계약 반영
- empty 결과 시에도 스키마 키는 유지하여 위젯 파싱 안정성 확보

추가 운영 계약:
- 위젯은 `main_recommendations`, `secondary_recommendations`를 1순위로 사용한다.
- 레거시 파서는 `recommendations`, `reference_recommendations`를 fallback으로만 사용한다.

## 8. 성능 가이드
- Fast path가 기본이며 대부분 요청은 rule/structured ranking으로 처리
- LLM rerank는 top-N 후보에서만 수행하여 latency/cost 제한
- 권장 목표:
  - Fast path P95 < 800ms
  - Precise path P95 < 2500ms

## 9. 운영 지표
- `category_lock_violation_count`
- `form_lock_violation_count` (로그 기반 운영 지표, 현재는 warning 로그로 추적)
- `no_result_rate`
- `fallback_rate`
- `top1_click_rate`
- `secondary_click_rate`
- `recommendation_to_purchase_rate`

디버그 엔드포인트:
- `GET /debug/recommendation-metrics`
  - 반환: `total_requests`, `category_lock_violation_count`, `fallback_count`, `no_result_count`, `fallback_rate`, `no_result_rate`

## 10. 점진 개선 계획
- Phase 1: taxonomy config 분리 + category lock 계측
- Phase 2: attribute extraction 강화(offline enrichment 포함)
- Phase 3: semantic retrieval/learned rank 확장
