# Cafe24 Admin API 연동 서버 (운영/스케일 대비 구조)

요청해주신 보안 강화, 구조 분리, 자원 자동 해제 로직이 탑재된 운영 서버 호환 버전입니다.

## 1. 주요 개선사항 및 구조 안내

- **mall_id 기반 확장 가능 토큰 저장소**: 단일 상점 기준이 아닌, 향후 시스템 확장을 고려해 `tokenStore`가 상점 ID(`mall_id`)를 식별키로 사용해 토큰을 저장 및 조회하도록 변경했습니다. 추후 DB 연동 시 이 키 구조를 그대로 활용하시면 매우 편리합니다.
- **개발 환경 전용 상태/토큰 확인**: 권한 탈취를 막고자 `/cafe24/token` API는 안전하게 마스킹 처리됨을 넘어, NODE_ENV 환경 변수가 `development`일 때만 접근되도록 원천 차단했습니다.
- **State 만료(TTL) 가비지 컬렉터 고도화**: CSRF 방어용 메모리 점유가 지속되지 않도록 10분 수명 제한과 타이머 ID 기반의 체계적인 메모리 클리너 로직을 구성했습니다 (`clearInterval` 제어 인터페이스 포함).
- **권한 변수(SCOPE) 표기 통일**: 각 파일과 리드미마다 다르게 적혀 있던 `SCOPE` 변수의 값을 `mall.read_product mall.read_order` 형태의 "띄어쓰기 한 칸 공백" 룰로 완전히 통일했습니다.

## 2. 실행 방법 및 중요한 제약 사항

> 🚨 **중요 안내 (오직 HTTPS 환경에서만 테스트 가능)**
> **이 프로젝트는 쿠키 탈취 이슈를 차단하기 위해 `secure: true`가 걸려있어 일반 로컬호스트(`http://localhost:3000`) 환경에서는 진행되지 않습니다.** 
> 테스트 시에는 반드시 아래 두 가지 HTTPS 경로 중 하나로 구동(배포)하여 인증을 연동해 보십시오.
> 
> **방법 A**: **Render 기본 도메인 배포 주소로 접속 (예: https://api-[무작위].onrender.com)**
> **방법 B**: **Cell Fusion C 운영 도메인 배포 주소로 접속 (예: https://api.cellfusionc.co.kr)**
> (* 카페24 개발자 센터 `Redirect URI` 항목에도 이 접속한 HTTPS 주소를 100% 동일하게 입력해야 오류가 나지 않습니다.)

1. 터미널 설치
   ```bash
   npm install
   ```
2. `.env` 환경 변수 설정
   - `.env.example`을 복사해 `.env`를 만듭니다.
   - 발급받은 `CLIENT_ID`, `CLIENT_SECRET`을 기입합니다.
   - (로컬 통신 테스트나 토큰 확인 시) `NODE_ENV=development` 설정을 기입해주면 개발 모드가 발동하여 마스킹된 토큰 상태 확인 엔드포인트가 동작합니다.
3. 구동 시작
   ```bash
   npm start
   ```

## 3. Render 배포 가이드라인 및 도메인 연동 흐름

**Render.com 배포 순서**
1. 변경 사항을 모두 커밋한 뒤 GitHub 저장소에 배포(Push) 합니다. (`.env`는 자동으로 무시되어 보안이 유지됩니다.)
2. `https://dashboard.render.com` 접속 후 `New > Web Service` 항목으로 진입해 GitHub 저장소와 연동시킵니다.
3. 환경 설정 입력 (Build Command: `npm install` / Start Command: `npm start`)
4. **Environment Variables**: 로컬에서 작성했던 `.env` 설정(`MALL_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `SCOPE`, `REDIRECT_URI`)들을 클라우드 환경변수 입력기에 복사해 넣습니다.

**Cell Fusion C 커스텀 도메인(api.cellfusionc.co.kr) 연결 방식**
1. 앱 배포가 끝난 뒤 Render 대시보드의 `Settings > Custom Domains` 섹션으로 이동합니다.
2. 매핑할 타겟 주소인 `api.cellfusionc.co.kr`을 적고 하단에 표시되는 CNAME 목적지를 클립보드에 복사합니다.
3. 귀사가 도메인을 구매한 호스팅 업체 관리자 페이지("DNS 레코드 설정")로 이동합니다.
4. CNAME 레코드 추가 / 호스트에는 `api` 입력 / 타겟(목적지)에는 방금 복사한 2번 값을 등록하고 세이브 하십시오.
5. 네임서버가 전파되면 무료 SSL 기반의 HTTPS 접속이 열립니다.

## 4. 최종 운영 환경 전환을 위한 완결 체크리스트

- [ ] **상태(State) & 토큰 영구 저장소 구축 (가장 중요)**
   - 본 코드는 다중 매장 확장을 대비해 구조화 되어 있으나, 현재 토큰들은 임시 시스템 메모리(`Map`)에 보관됩니다.
   - ಈ 상태로 실제 서비스가 구동되면, Render 앱이 `Sleep` 모드에 빠지거나 새 코드가 배포되어 서버가 재시작될 때마다 모든 쇼핑몰 API 권한이 함께 사라집니다. (즉, 셀러가 매번 관리자 페이지 리다이렉트 동의를 수동으로 해야 함)
   - 반드시 상용 전 `stores/tokenStore.js` 및 `stores/stateStore.js` 소스를 MySQL, PostgreSQL 또는 Redis와 같은 영구 디스크(DB) 연결 코드로 직접 교체하신 후 배포하십시오.
- [ ] **운영 환경 보안(`NODE_ENV`) 구동 확인**
   - 배포된 Render나 상용 서버 환경 변수에서 `NODE_ENV=production` 처리가 되어 토큰 출력 API(`/cafe24/token`)가 `403 Forbidden` 으로 정확히 닫혀 있는지 확인하십시오.
- [ ] **API 권한(SCOPE) 지속적 확장 대처 사항 확인**
   - 시스템 고도화로 인해 `SCOPE` 변수에 `mall.read_order` 등을 추가하였다고 하더라도, 기존 토큰이 뒷단에서 자동으로 권한을 부여받지 않습니다.
   - 스코프 설정 갱신 후에는 무조건 쇼핑몰 관리자가 다시 최초 로그인 단계(`/cafe24/start`)를 진행하여 "이 앱이 새로운 권한(주문)에 접근하려 합니다"라는 동의 화면을 거쳐야 최종적으로 통신 권한 리스트가 갱신됨을 잊지 마십시오.
