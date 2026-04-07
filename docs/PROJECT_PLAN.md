# 📋 CelFusionC AI Recommendation Project Plan

## 1. 프로젝트 개요
셀퓨전씨(CellFusionC) 공식몰의 방대한 상품 데이터를 AI(ChatGPT, Claude 등)가 실시간으로 분석하여, 고객의 피부 타입과 고민에 딱 맞는 제품을 맞춤형으로 큐레이션하는 **Model Context Protocol (MCP) 서버** 구축 프로젝트입니다.

---

## 2. 핵심 기술 아키텍처 (Portfolio Highlights)

### 2-1. 하이브리드 인메모리 싱크 (Performance Optimizer)
- **Problem**: 무료 클라우드(Render.com) 환경에서의 카페24 API 호출 지연(약 50초)으로 인한 사용자 경험 저하.
- **Solution**: 10~20분 주기 백그라운드 풀-싱크 로직 도입. 전체 상품 데이터를 서버 메모리에 상주시켜 응답 속도를 **0.1초** 이내로 단축.

### 2-2. 실시간 AI 셀렉터 (Semantic Selection)
- **Problem**: "선크림=썬스크린=자외선차단제" 등 무한한 동의어와 오타 대응의 한계 (기존 하드코딩 방식의 한계).
- **Solution**: **GPT-4o-mini 실시간 추론** 기반 상품 선정 로직 도입. 하드코딩된 규칙 없이 AI가 상품명과 상세 설명을 실시간 분석하여 가장 적합한 Top 5 선정.

### 2-3. 프로액티브 토큰 관리 (Stability)
- **Problem**: OAuth 2.0 액세스 토큰 만료 시 발생하는 401 에러로 인한 서비스 중단.
- **Solution**: 만료 5분 전 자동 갱신(Auto-Refresh) 및 MongoDB Atlas 영구 저장소 연동으로 무중단 서비스 구현.

---

## 3. 구현 기능 (Features)

### 3-1. 맞춤형 상품 추천 (`search_cafe24_real_products`)
- 사용자의 피부 타입(지성, 건성 등), 고민(여드름, 민감성 등), 선호 카테고리를 입력받아 AI가 최적의 조합을 추천.
- 할인율(%), 썸네일 이미지, 직접 구매 링크가 포함된 프리미엄 가로형 테이블 자동 생성.

### 3-2. 공식 베스트 랭킹 (`get_bestseller_ranking`)
- 카페24 공식몰 관리자가 설정한 베스트 카테고리(No.47) 데이터를 실시간 반영하여 신뢰도 높은 순위 제공.

---

## 4. 기술 의사결정 기록 (ADR)

| 번호 | 결정 사항 | 핵심 이유 |
|---|---|---|
| **ADR-008** | **규칙 기반 엔진 → AI 셀렉터 전환** | 하드코딩 없는 0% 유지보수와 높은 의미 매칭 정확도 확보 |
| **ADR-009** | **해시 기반 동기화 스킵** | 데이터 변경 시에만 AI 태깅을 수행하여 API 토큰 비용 90% 이상 절감 |
| **ADR-010** | **백그라운드 싱크 레이어** | 무료 서버의 한계인 지연 시간을 구조적으로 해결하여 상용 수준 속도 확보 |

---

## 5. 마일스톤 (Progress: 100% ✅)

- [x] Phase 1: 카페24 OAuth 2.0 & MongoDB 토큰 저장소 및 자동 갱신 구현
- [x] Phase 2: 인메모리 백그라운드 풀-싱크 엔진 구축 (응답 속도 0.1초 달성)
- [x] Phase 3: GPT-4o-mini 연동 실시간 AI 셀렉터 (하드코드 제거)
- [x] Phase 4: 프리미엄 마크다운 UI 및 포트폴리오 최적화 문서화

---

## 6. 프로젝트 구조
```text
├── config/             # 환경 변수 및 설정 관리 (env.js)
├── models/             # MongoDB 스키마 (Token.js)
├── routes/             
│   ├── cafe24.js       # OAuth 인증 처리
│   └── mcp.js          # MCP 통신 및 UI 렌더링
├── services/           
│   ├── cafe24ApiService.js    # 데이터 동기화 및 API 핸들링
│   ├── recommendationService.js # 실시간 AI 셀렉터 로직 (Core)
│   └── aiTaggingService.js    # 백그라운드 AI 분석 모듈
├── stores/             # 토큰 및 상태 관리
└── server.js           # 서버 메인 및 백그라운드 스케줄러 가동
```

---
> **Result**: 본 프로젝트는 카페24 플랫폼의 레거시 데이터를 현대적인 AI 기술과 MCP 프로토콜로 재조합하여, 실제 상용 서비스 수준의 성능과 지능을 갖춘 이커머스 AI 브릿지를 완성하였습니다.
