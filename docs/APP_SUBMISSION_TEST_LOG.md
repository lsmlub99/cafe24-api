# App Directory Submission Test Log

이 문서는 App in GPT 심사 제출 전 기능/정책 안정성을 증빙하기 위한 테스트 로그입니다.

## 1) Test Run Info

- App Name: CellFusion C
- Version/Commit: 0baacf2
- Test Date: 2026-04-16
- Tester: loki/Lim SeungMin
- Environment: Render / Production
- MCP URL: https://cafe24-api.onrender.com/mcp

## 2) Pass/Fail Rules

- `requested_category`가 있는 케이스에서 main 추천에 타 카테고리 포함 시 **FAIL**
- main 추천에 프로모션/미니/기획 상품 포함 시 **FAIL**
- 위젯 카드 렌더 실패(빈 박스/무한 로딩/깜빡임 지속) 시 **FAIL**
- 사용자 응답에 내부 변수명/디버그 문자열 노출 시 **FAIL**

## 3) Core Test Cases (Required)

| Case ID | User Input | Expected Behavior |
|---|---|---|
| TC-01 | 민감성인데 선크림 바르면 눈시림이 있어요. 순한 걸로 추천해줘 | 민감/자극 시그널 반영, 순한 후보 우선 |
| TC-02 | 수부지인데 여름에 쓸 가벼운 선크림 추천해줘 | combination + summer + lightweight 반영 |
| TC-03 | 메이크업 전에 밀림 적은 선크림으로 골라줘 | makeup_before/밀림 조건 반영 |
| TC-04 | 톤업 없는 선크림으로만 추천해줘 | tone_up 제외 의도 반영 |
| TC-05 | 야외활동 많아서 덧바르기 편한 선케어 추천해줘 | outdoor/reapply 조건 반영 |
| TC-06 | 선세럼 추천해줘, 너무 무거운 제형은 싫어 | serum form 우선 + lightweight 반영 |
| TC-07 | 선스틱 중에서 데일리로 쓰기 무난한 거 추천해줘 | stick form 우선 + daily 반영 |
| TC-08 | 건성인데 오후에 당김 적은 선케어 추천해줘 | dry + hydration 반영 |
| TC-09 | 예산 2만원대로 선케어 2개 조합 추천해줘 | price_intent 반영 + 조합 안내 |
| TC-10 | 지금 추천 말고 다른 타입도 같이 비교해서 보여줘 | variety_intent 반영 + 비교형 안내 |

## 4) Execution Log Table

각 케이스는 최소 2회 실행 권장(재현성 확인).

| Run ID | Case ID | User Input | requested_category | requested_form | Main #1/#2/#3 | Secondary | Promotions | Category Lock Violation | Form Lock Violation | Response Time (ms) | Widget Render (OK/FAIL) | Notes |
|---|---|---|---|---|---|---|---|---|---|---:|---|---|
| 1 | TC-01 | 민감성인데 선크림 바르면 눈시림이 있어요. 순한 걸로 추천해줘 |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-01 | 민감성인데 선크림 바르면 눈시림이 있어요. 순한 걸로 추천해줘 |  |  |  |  |  |  |  |  |  |  |

## 5) Policy Validation Checklist

- [ ] main_recommendations 카테고리 위반 0건
- [ ] main_recommendations form 정책 위반 0건
- [ ] main_recommendations 프로모션/미니 0건
- [ ] secondary/promotion 분리 노출 확인
- [ ] no_result/fallback 시 위젯 정상 동작
- [ ] 텍스트 응답에 내부 변수명 노출 0건

## 6) Evidence Links / Attachments

- ChatGPT result screenshots:
  - ``
- Server log snippets:
  - ``
- Optional: screen recording
  - ``

## 7) Metrics Snapshot

테스트 종료 시점 `/debug/recommendation-metrics` 결과를 붙여넣으세요.

```json
{
  "total_requests": 0,
  "category_lock_violation_count": 0,
  "form_lock_violation_count": 0,
  "fallback_count": 0,
  "no_result_count": 0,
  "fallback_rate": 0,
  "no_result_rate": 0
}
```

## 8) Final Summary (for Submission)

- Total Runs:
- Pass Runs:
- Fail Runs:
- Mean Response Time:
- Max Response Time:
- Residual Issues:
- Go / No-Go:

