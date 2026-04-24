# App Directory Submission Test Log

이 문서는 App in GPT 심사 제출 전 기능/정책 안정성을 증빙하기 위한 테스트 로그입니다.

## 1) Test Run Info

- App Name: `CellFusion C`
- Version/Commit:
- Test Date:
- Tester:
- Environment: `Render / Production` 또는 `Local`
- MCP URL: `https://cafe24-api.onrender.com/mcp`

## 2) Pass/Fail Rules

- `requested_category`가 있는 케이스에서 main 추천에 타 카테고리 포함 시 **FAIL**
- form lock 대상 케이스에서 main 추천에 타 form 포함 시 **FAIL**
- main 추천에 프로모션/미니/기획 상품 포함 시 **FAIL**
- 위젯 카드 렌더 실패(빈 박스/무한 로딩/깜빡임 지속) 시 **FAIL**
- 사용자 응답에 내부 변수명/디버그 문자열 노출 시 **FAIL**

## 3) Core Test Cases (Required)

| Case ID | User Input | Expected Behavior |
|---|---|---|
| TC-01 | 선크림 추천 | sunscreen 카테고리 main 3건 노출, 위젯 정상 렌더 |
| TC-02 | 건성 선크림 추천 | sunscreen + dry 반영, main 3건 노출 |
| TC-03 | 지성인데 선크림이 안 맞아요 | reactive/fit issue 반영, 반복 top 완화 |
| TC-04 | 따가움이 심해요 | irritation 반영, soothing 성향 우선 |
| TC-05 | 선크림 다른 거 없나요 | variety intent 반영, 동일 top 반복 완화 |
| TC-06 | 민감성 토너 추천 | toner 카테고리 lock 유지 |
| TC-07 | 신상 쿠션 추천해줘 | cushion 카테고리 + new_arrival 우선 |
| TC-08 | 여름에 가벼운 로션 추천 | situation/preference 반영 |
| TC-09 | 건성 선세럼 추천 | serum 요청 form 해석 및 main 정합성 확인 |
| TC-10 | 선스틱 추천 | stick 중심 main 노출 |
| TC-11 | 선크림인데 예산 2만원 | price intent 반영 |
| TC-12 | 결과 없는 모호 입력(예: 라이터) | 안전 fallback + 위젯 깨짐 없음 |

## 4) Execution Log Table

각 케이스는 **최소 2회 실행** 권장(재현성 확인).

| Run ID | Case ID | User Input | requested_category | requested_form | Main #1 / #2 / #3 | Secondary | Promotions | Category Lock Violation | Form Lock Violation | Response Time (ms) | Widget Render (OK/FAIL) | Notes |
|---|---|---|---|---|---|---|---|---|---|---:|---|---|
| 1 | TC-01 | 선크림 추천 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 2 | TC-01 | 선크림 추천 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 1 | TC-02 | 건성 선크림 추천 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 2 | TC-02 | 건성 선크림 추천 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 1 | TC-03 | 지성인데 선크림이 안 맞아요 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 2 | TC-03 | 지성인데 선크림이 안 맞아요 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 1 | TC-04 | 따가움이 심해요 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 2 | TC-04 | 따가움이 심해요 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 1 | TC-05 | 선크림 다른 거 없나요 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 2 | TC-05 | 선크림 다른 거 없나요 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 1 | TC-06 | 민감성 토너 추천 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 2 | TC-06 | 민감성 토너 추천 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 1 | TC-07 | 신상 쿠션 추천해줘 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 2 | TC-07 | 신상 쿠션 추천해줘 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 1 | TC-08 | 여름에 가벼운 로션 추천 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 2 | TC-08 | 여름에 가벼운 로션 추천 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 1 | TC-09 | 건성 선세럼 추천 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 2 | TC-09 | 건성 선세럼 추천 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 1 | TC-10 | 선스틱 추천 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 2 | TC-10 | 선스틱 추천 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 1 | TC-11 | 선크림인데 예산 2만원 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 2 | TC-11 | 선크림인데 예산 2만원 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 1 | TC-12 | 라이터 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |
| 2 | TC-12 | 라이터 |  |  |  |  |  | 0/1 | 0/1 |  |  |  |

## 5) Policy Validation Checklist

- [ ] main_recommendations 카테고리 위반 0건
- [ ] main_recommendations form 정책 위반 0건
- [ ] main_recommendations 프로모션/미니 0건
- [ ] secondary / promotions 분리 노출 확인
- [ ] no_result / fallback 시 위젯 정상 동작
- [ ] 텍스트 응답에 내부 변수명 노출 0건
- [ ] 카드/본문 추천 불일치 0건

## 6) Evidence Links / Attachments

- ChatGPT result screenshots:
  - `docs/evidence/1차_선크림추천.png`
  - `docs/evidence/...`
- Server log screenshots:
  - `docs/evidence/1차_선크림추천_로그.png`
  - `docs/evidence/...`
- Optional: screen recording
  - `docs/evidence/...`

## 7) Metrics Snapshot (`/debug/recommendation-metrics`)

테스트 종료 시점 JSON을 그대로 붙여넣으세요.

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
