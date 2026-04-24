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
- 카드/본문 추천 불일치(같은 요청인데 서로 다른 main 결과) 시 **FAIL**

## 3) Core Test Cases (Required: TC-01 ~ TC-12)

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

## 4) Extended Test Cases (Submission Quality: TC-13 ~ TC-22)

| Case ID | User Input | Expected Behavior |
|---|---|---|
| TC-13 | 민감성인데 선크림 바르면 눈시림이 있어요. 순한 걸로 추천해줘 | irritation/민감 시그널 반영, 안전한 대안 제시 |
| TC-14 | 수부지인데 여름에 쓸 가벼운 선크림 추천해줘 | combination + lightweight + summer 상황 반영 |
| TC-15 | 메이크업 전에 밀림 적은 선크림으로 골라줘 | makeup_before/밀림 조건 반영 |
| TC-16 | 톤업 없는 선크림으로만 추천해줘 | tone_up 제외 의도 반영 |
| TC-17 | 야외활동 많아서 덧바르기 편한 선케어 추천해줘 | outdoor/reapply 성향 반영 |
| TC-18 | 선세럼 추천해줘, 너무 무거운 제형은 싫어 | serum form 우선 + lightweight 반영 |
| TC-19 | 선스틱 중에서 데일리로 쓰기 무난한 거 추천해줘 | stick form 우선 + daily 반영 |
| TC-20 | 건성인데 오후에 당김 적은 선케어 추천해줘 | dry + hydration 반영 |
| TC-21 | 예산 2만원대로 선케어 2개 조합 추천해줘 | price intent + 조합형 안내 |
| TC-22 | 지금 추천 말고 다른 타입도 같이 비교해서 보여줘 | variety intent 반영 + 비교형 안내 |

## 5) Quick Input Script (복붙용)

아래 문장을 ChatGPT에 순서대로 넣고 실행하세요.

```text
[TC-01] 선크림 추천
[TC-02] 건성 선크림 추천
[TC-03] 지성인데 선크림이 안 맞아요
[TC-04] 따가움이 심해요
[TC-05] 선크림 다른 거 없나요
[TC-06] 민감성 토너 추천
[TC-07] 신상 쿠션 추천해줘
[TC-08] 여름에 가벼운 로션 추천
[TC-09] 건성 선세럼 추천
[TC-10] 선스틱 추천
[TC-11] 선크림인데 예산 2만원
[TC-12] 라이터
[TC-13] 민감성인데 선크림 바르면 눈시림이 있어요. 순한 걸로 추천해줘
[TC-14] 수부지인데 여름에 쓸 가벼운 선크림 추천해줘
[TC-15] 메이크업 전에 밀림 적은 선크림으로 골라줘
[TC-16] 톤업 없는 선크림으로만 추천해줘
[TC-17] 야외활동 많아서 덧바르기 편한 선케어 추천해줘
[TC-18] 선세럼 추천해줘, 너무 무거운 제형은 싫어
[TC-19] 선스틱 중에서 데일리로 쓰기 무난한 거 추천해줘
[TC-20] 건성인데 오후에 당김 적은 선케어 추천해줘
[TC-21] 예산 2만원대로 선케어 2개 조합 추천해줘
[TC-22] 지금 추천 말고 다른 타입도 같이 비교해서 보여줘
```

## 6) Execution Log Table

각 케이스는 **최소 2회 실행** 권장(재현성 확인).

| Run ID | Case ID | User Input | requested_category | requested_form | Main #1 / #2 / #3 | Secondary | Promotions | Category Lock Violation (0/1) | Form Lock Violation (0/1) | Response Time (ms) | Widget Render (OK/FAIL) | Body/Widget Match (OK/FAIL) | Notes |
|---|---|---|---|---|---|---|---|---:|---:|---:|---|---|---|
| 1 | TC-01 | 선크림 추천 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-01 | 선크림 추천 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-02 | 건성 선크림 추천 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-02 | 건성 선크림 추천 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-03 | 지성인데 선크림이 안 맞아요 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-03 | 지성인데 선크림이 안 맞아요 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-04 | 따가움이 심해요 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-04 | 따가움이 심해요 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-05 | 선크림 다른 거 없나요 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-05 | 선크림 다른 거 없나요 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-06 | 민감성 토너 추천 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-06 | 민감성 토너 추천 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-07 | 신상 쿠션 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-07 | 신상 쿠션 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-08 | 여름에 가벼운 로션 추천 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-08 | 여름에 가벼운 로션 추천 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-09 | 건성 선세럼 추천 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-09 | 건성 선세럼 추천 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-10 | 선스틱 추천 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-10 | 선스틱 추천 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-11 | 선크림인데 예산 2만원 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-11 | 선크림인데 예산 2만원 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-12 | 라이터 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-12 | 라이터 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-13 | 민감성인데 선크림 바르면 눈시림이 있어요. 순한 걸로 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-13 | 민감성인데 선크림 바르면 눈시림이 있어요. 순한 걸로 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-14 | 수부지인데 여름에 쓸 가벼운 선크림 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-14 | 수부지인데 여름에 쓸 가벼운 선크림 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-15 | 메이크업 전에 밀림 적은 선크림으로 골라줘 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-15 | 메이크업 전에 밀림 적은 선크림으로 골라줘 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-16 | 톤업 없는 선크림으로만 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-16 | 톤업 없는 선크림으로만 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-17 | 야외활동 많아서 덧바르기 편한 선케어 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-17 | 야외활동 많아서 덧바르기 편한 선케어 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-18 | 선세럼 추천해줘, 너무 무거운 제형은 싫어 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-18 | 선세럼 추천해줘, 너무 무거운 제형은 싫어 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-19 | 선스틱 중에서 데일리로 쓰기 무난한 거 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-19 | 선스틱 중에서 데일리로 쓰기 무난한 거 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-20 | 건성인데 오후에 당김 적은 선케어 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-20 | 건성인데 오후에 당김 적은 선케어 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-21 | 예산 2만원대로 선케어 2개 조합 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-21 | 예산 2만원대로 선케어 2개 조합 추천해줘 |  |  |  |  |  |  |  |  |  |  |  |
| 1 | TC-22 | 지금 추천 말고 다른 타입도 같이 비교해서 보여줘 |  |  |  |  |  |  |  |  |  |  |  |
| 2 | TC-22 | 지금 추천 말고 다른 타입도 같이 비교해서 보여줘 |  |  |  |  |  |  |  |  |  |  |  |

## 7) Policy Validation Checklist

- [ ] main_recommendations 카테고리 위반 0건
- [ ] main_recommendations form 정책 위반 0건
- [ ] main_recommendations 프로모션/미니 0건
- [ ] secondary / promotions 분리 노출 확인
- [ ] no_result / fallback 시 위젯 정상 동작
- [ ] 텍스트 응답에 내부 변수명 노출 0건
- [ ] 카드/본문 추천 불일치 0건

## 8) Evidence Links / Attachments

- ChatGPT result screenshots:
  - `docs/evidence/TC-01_result.png`
  - `docs/evidence/...`
- Server log screenshots:
  - `docs/evidence/TC-01_log.png`
  - `docs/evidence/...`
- Optional: screen recording
  - `docs/evidence/...`

## 9) Metrics Snapshot (`/debug/recommendation-metrics`)

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

## 10) Final Summary (for Submission)

- Total Runs:
- Pass Runs:
- Fail Runs:
- Mean Response Time:
- Max Response Time:
- Residual Issues:
- Go / No-Go:

---

## 11) Fast Log Sheet (TC-13 ~ TC-22 전용)

추가 10개 케이스만 빠르게 기록할 때 이 섹션만 사용하세요.

### 11-1. 입력 목록 (복붙용)

```text
[TC-13] 민감성인데 선크림 바르면 눈시림이 있어요. 순한 걸로 추천해줘
[TC-14] 수부지인데 여름에 쓸 가벼운 선크림 추천해줘
[TC-15] 메이크업 전에 밀림 적은 선크림으로 골라줘
[TC-16] 톤업 없는 선크림으로만 추천해줘
[TC-17] 야외활동 많아서 덧바르기 편한 선케어 추천해줘
[TC-18] 선세럼 추천해줘, 너무 무거운 제형은 싫어
[TC-19] 선스틱 중에서 데일리로 쓰기 무난한 거 추천해줘
[TC-20] 건성인데 오후에 당김 적은 선케어 추천해줘
[TC-21] 예산 2만원대로 선케어 2개 조합 추천해줘
[TC-22] 지금 추천 말고 다른 타입도 같이 비교해서 보여줘
```

### 11-2. 빠른 기록 표 (Run 1 기준)

| Case ID | Main #1/#2/#3 | Category/Form 위반 (Y/N) | 본문-카드 일치 (Y/N) | Render (OK/FAIL) | 응답시간(ms) | Notes |
|---|---|---|---|---|---:|---|
| TC-13 |  |  |  |  |  |  |
| TC-14 |  |  |  |  |  |  |
| TC-15 |  |  |  |  |  |  |
| TC-16 |  |  |  |  |  |  |
| TC-17 |  |  |  |  |  |  |
| TC-18 |  |  |  |  |  |  |
| TC-19 |  |  |  |  |  |  |
| TC-20 |  |  |  |  |  |  |
| TC-21 |  |  |  |  |  |  |
| TC-22 |  |  |  |  |  |  |

### 11-3. 빠른 기록 표 (Run 2 기준)

| Case ID | Main #1/#2/#3 | Category/Form 위반 (Y/N) | 본문-카드 일치 (Y/N) | Render (OK/FAIL) | 응답시간(ms) | Notes |
|---|---|---|---|---|---:|---|
| TC-13 |  |  |  |  |  |  |
| TC-14 |  |  |  |  |  |  |
| TC-15 |  |  |  |  |  |  |
| TC-16 |  |  |  |  |  |  |
| TC-17 |  |  |  |  |  |  |
| TC-18 |  |  |  |  |  |  |
| TC-19 |  |  |  |  |  |  |
| TC-20 |  |  |  |  |  |  |
| TC-21 |  |  |  |  |  |  |
| TC-22 |  |  |  |  |  |  |

### 11-4. 추가 10개 요약 결과

- Total Runs (TC-13~22):
- Pass:
- Fail:
- Avg Response Time:
- Residual Issues:
