# App Directory Submission Test Log

이 문서는 App in GPT 심사 제출 전 기능/정책 안정성을 증빙하기 위한 테스트 로그입니다.

## 1) Test Run Info

- App Name: CellFusion C
- Version/Commit:
- Test Date:
- Tester:
- Environment: Render / Production
- MCP URL: https://cafe24-api.onrender.com/mcp

## 2) Pass/Fail Rules

- `requested_category`가 있는 케이스에서 main 추천에 타 카테고리 포함 시 **FAIL**
- main 추천에 프로모션/미니/기획 상품 포함 시 **FAIL**
- 위젯 카드 렌더 실패(빈 박스/무한 로딩/깜빡임 지속) 시 **FAIL**
- 사용자 응답에 내부 변수명/디버그 문자열 노출 시 **FAIL**
- 본문 결론 제품명과 카드 1위 제품명이 다르면 **FAIL**

## 3) Core Test Cases (Submission Set)

| Case ID | User Input | Expected Behavior |
|---|---|---|
| TC-01 | 민감성인데 선크림 바르면 눈시림이 있어요. 순한 걸로 추천해줘 | 민감/자극 신호 반영, 순한 후보 우선 |
| TC-02 | 수부지인데 여름에 쓸 가벼운 선크림 추천해줘 | 조합피부 + 여름 + 가벼움 반영 |
| TC-03 | 메이크업 전에 밀림 적은 선크림으로 골라줘 | 메이크업 전 사용 맥락 반영 |
| TC-04 | 톤업 없는 선크림으로만 추천해줘 | 톤업 제외 조건 반영 |
| TC-05 | 야외활동 많아서 덧바르기 편한 선케어 추천해줘 | 재도포/휴대성 맥락 반영 |
| TC-06 | 선세럼 추천해줘, 너무 무거운 제형은 싫어 | serum 제형 우선 + 가벼움 반영 |
| TC-07 | 선스틱 중에서 데일리로 쓰기 무난한 거 추천해줘 | stick 제형 우선 + 데일리 맥락 반영 |
| TC-08 | 건성인데 오후에 당김 적은 선케어 추천해줘 | 건성 + 보습 맥락 반영 |
| TC-09 | 예산 2만원대로 선케어 2개 조합 추천해줘 | 가격 의도 반영 + 조합 안내 |
| TC-10 | 지금 추천 말고 다른 타입도 같이 비교해서 보여줘 | 다양성 의도 반영 + 비교 안내 |

## 4) Required Regression Check (3 Cases)

| Case ID | User Input | Required Checkpoint |
|---|---|---|
| RG-01 | 크림 추천해주세요 | `body_template_version=mcp_v2_3`, `body_top1_match=true` |
| RG-02 | 비비크림 추천해주세요 | `body_template_version=mcp_v2_3`, `body_top1_match=true` |
| RG-03 | 민감성인데 따가워요 | `body_template_version=mcp_v2_3`, `body_top1_match=true` |

## 5) Execution Log Table

각 케이스는 최소 2회 실행을 권장합니다(재현성 확인).

| Run ID | Case ID | User Input | requested_category | requested_form | Main #1/#2/#3 | Secondary | Promotions | Category Lock Violation | Form Lock Violation | Response Time (ms) | Widget Render (OK/FAIL) | body_template_version | body_items_count | body_top1_match | Notes |
|---|---|---|---|---|---|---|---|---|---|---:|---|---|---:|---|---|
| 1 | RG-01 | 크림 추천해주세요 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 2 | RG-02 | 비비크림 추천해주세요 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 3 | RG-03 | 민감성인데 따가워요 |  |  |  |  |  |  |  |  |  |  |  |  |  |

## 6) Policy Validation Checklist

- [ ] main_recommendations 카테고리 위반 0건
- [ ] main_recommendations form 정책 위반 0건
- [ ] main_recommendations 프로모션/미니 0건
- [ ] secondary/promotion 분리 노출 확인
- [ ] no_result/fallback 시 위젯 정상 동작
- [ ] 텍스트 응답에 내부 변수명 노출 0건
- [ ] 본문 결론 제품명 = 카드 1위 제품명

## 7) Evidence Links / Attachments

- ChatGPT result screenshots:
  - ``
- Server log snippets:
  - ``
- Demo video URL (public/unlisted, no login required):
  - ``
- Optional screen recording:
  - ``

## 8) Metrics Snapshot

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

## 9) Submission Checklist (OpenAI Guidelines)

- [ ] 도구 이름/설명/annotations가 실제 동작과 일치
- [ ] 앱 설명/스크린샷이 실제 기능과 일치
- [ ] 웹사이트 URL, 지원 URL(또는 이메일), Privacy URL, Terms URL 유효
- [ ] 데모 영상 URL 공개 접근 가능(로그인 불필요)
- [ ] 커머스 진술(실물 상품 판매)과 실제 동작 일치
- [ ] 금지 상품/서비스 결제 미제공 확인

## 10) Final Summary (for Submission)

- Total Runs:
- Pass Runs:
- Fail Runs:
- Mean Response Time:
- Max Response Time:
- Residual Issues:
- Go / No-Go:

