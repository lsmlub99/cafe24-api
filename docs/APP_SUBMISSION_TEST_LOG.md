# App Directory Submission Test Log

이 문서는 App in GPT 제출 전 기능/정책/위젯 안정성 검증 기록입니다.

## 1) Test Run Info
- App Name:
- Version/Commit:
- Test Date:
- Tester:
- Environment: `Render / Production` 또는 `Local`
- MCP URL:

## 2) Pass/Fail 기준
- `requested_category`가 있는 케이스에서 main 추천에 타 카테고리 포함 시 FAIL
- form lock 대상 케이스에서 main 추천에 타 form 포함 시 FAIL
- main 추천에 프로모션/미니/기획형 포함 시 FAIL
- 위젯 렌더 실패(빈 박스/무한 로딩/깜빡임 지속) 시 FAIL
- 사용자 응답에 내부 변수명/디버그 문자열 노출 시 FAIL

## 3) 필수 테스트 케이스
| Case ID | User Input | Expected |
|---|---|---|
| TC-01 | 선크림 추천 | sunscreen main 3건, widget 정상 |
| TC-02 | 건성 선크림 추천 | dry 반영 + sunscreen lock 유지 |
| TC-03 | 지성인데 선크림이 안 맞아요 | negative signal 반영, 반복 완화 |
| TC-04 | 선크림 바르면 따가워요 | soothing/민감 우선 |
| TC-05 | 선크림 다른 거 없나요 | variety 반영, 동일 결과 반복 완화 |
| TC-06 | 민감성 토너 추천 | toner lock 유지 |
| TC-07 | 신상 쿠션 추천해줘 | cushion + new_arrival 반영 |
| TC-08 | 여름에 가벼운 로션 추천 | 상황/선호 반영 |
| TC-09 | 건성 선세럼 추천 | serum 계열 의도 반영 |
| TC-10 | 선스틱 추천 | stick 중심 main 구성 |
| TC-11 | 선크림 예산 2만원 | price intent 반영 |
| TC-12 | 무의미 입력/모호 입력 | 안전 fallback + UI 안정 |

## 4) 실행 로그 표
최소 2회전 권장(재현성 확인).

| Run | Case ID | Input | requested_category | requested_form | Main #1/#2/#3 | Secondary | Promotions | Category Lock | Form Lock | Widget | Latency(ms) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---:|---|
| 1 | TC-01 |  |  |  |  |  |  | PASS/FAIL | PASS/FAIL | PASS/FAIL |  |  |
| 1 | TC-02 |  |  |  |  |  |  | PASS/FAIL | PASS/FAIL | PASS/FAIL |  |  |
| 1 | TC-03 |  |  |  |  |  |  | PASS/FAIL | PASS/FAIL | PASS/FAIL |  |  |
| 2 | TC-01 |  |  |  |  |  |  | PASS/FAIL | PASS/FAIL | PASS/FAIL |  |  |
| 2 | TC-02 |  |  |  |  |  |  | PASS/FAIL | PASS/FAIL | PASS/FAIL |  |  |
| 2 | TC-03 |  |  |  |  |  |  | PASS/FAIL | PASS/FAIL | PASS/FAIL |  |  |

## 5) 정책 체크리스트
- [ ] category lock 위반 0건
- [ ] form lock 위반 0건
- [ ] main 슬롯 프로모션/미니 0건
- [ ] main/secondary/promotions 분리 노출 확인
- [ ] 빈 결과/에러 상황에서도 위젯 정상 종료

## 6) 증빙 자료
- ChatGPT 결과 캡처:
  - 
- 서버 로그 캡처:
  - 
- 메트릭 캡처:
  - 

## 7) Metrics Snapshot (`/debug/recommendation-metrics`)
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

## 8) 제출 결론
- Total Runs:
- Pass:
- Fail:
- 평균 응답 시간:
- 최대 응답 시간:
- 잔여 이슈:
- Go / No-Go:
