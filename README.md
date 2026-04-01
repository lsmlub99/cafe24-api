# Cafe24 Admin API 연동 서버 (Mongoose 영구 데이터베이스 연동 버전)

Render의 무료 클라우드 환경에서도 서버가 재부팅될 때마다 카페24 상점 연동 토큰이 삭제되는 현상을 완벽히 방어하고자, **Mongoose 기반의 원격 MongoDB 저장소 연동이 100% 통합된 최종판**입니다. 

이제 토큰과 만료 시간 정보가 클라우드 DB에 분산 보관되므로 서버가 멈추거나 슬립, 업데이트되더라도 기존 연동이 영구적으로 보존됩니다.

## 1. MongoDB 연동 환경 구성의 주요 이점
- **무중단 운영 보장**: Node.js 서버 메모리나 로컬 파일(`tokens.json`)이 유실되더라도 백엔드가 시작될 때마다 클라우드 데이터베이스에서 토큰 정보를 찾아 읽어 오므로 추가적인 `/cafe24/start` 수동 조작이 불필요해집니다.
- **다중 매장 스케일링**: 작성된 `models/Token.js` 스키마 안에는 고유값인 `mall_id`가 지정되어 있습니다. 하나의 서버에 다수 매장의 토큰 레코드들이 꼬이지 않고 질서있게 영구 기록 및 업데이트됩니다.

## 2. 무료 MongoDB Atlas 클러스터 생성 및 연동 가이드 (필수)

> **데이터를 살려두려면 이 과정이 필요합니다.** 무료 요금을 지원하는 MongoDB 클라우드를 이용합니다.

1. **MongoDB Atlas** [https://www.mongodb.com/ko-kr/cloud/atlas](https://www.mongodb.com/ko-kr/cloud/atlas) 에 회원가입 후 로그인합니다.
2. 클러스터(Cluster) 생성 단계에서 요금이 발생하지 않는 **M0 Free 티어**를 선택하여 생성합니다.
3. 생성된 클러스터 패널의 **[Connect] -> [Drivers]** 메뉴로 이동하면, 애플리케이션 연결 문자열 코드가 팝업에 나타납니다.
   *(예: `mongodb+srv://adminID:<password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority`)*
4. 복사한 문자열에서 `<password>` 부분만 설정하신 비밀번호 텍스트로 치환해 줍니다.
5. 로컬에서는 이 프로젝트의 `.env` 파일을 열고, 해당 문자열을 `MONGO_URI` 에 붙여넣고 세이브합니다.

## 3. Render 배포 가이드라인 및 도메인 연동 흐름

**Render.com 배포 순서 (보안을 위한 수동 입력 과정 포함)**
1. 이 프로젝트 코드를 GitHub 저장소에 업로드(Push) 합니다. `.env`는 올라가지 않으니 안심하십시오.
2. `https://dashboard.render.com` 접속 후 `New > Web Service` 항목으로 진입, GitHub 저장소와 연결합니다.
3. 설정 입력란 기입 (Build Command: `npm install` / Start Command: `npm start`)
4. **Environment Variables (핵심 단계)**: 로컬 `.env` 에 있던 아래 설정값 6가지를 Render 내 환경변수 입력기에 넣습니다.
   - `MALL_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `SCOPE`, `REDIRECT_URI`
   - **(신규) `MONGO_URI`** : 방금 발급 받은 몽고DB 주소를 이곳에 기입합니다. 
5. 앱 배포를 실행시킵니다. (데이터베이스 통신 오류 시 자동으로 서버를 정지하도록 코딩되어 있습니다.)

## 4. 커스텀 도메인 (api.cellfusionc.co.kr) 연결 처리 

1. 앱이 정상 구동된 후 Render 대시보드의 `Settings > Custom Domains` 섹션으로 진입합니다.
2. 타겟 도메인인 `api.cellfusionc.co.kr`을 적고 하단에 표시되는 무료 CNAME 목적지 주소를 클립보드에 복사합니다.
3. 귀사가 도메인을 구매 유지 중인 호스팅 업체 관리자 페이지("DNS 레코드 수정")로 진입합니다.
4. CNAME 레코드 신설 / 호스트에는 `api` 영역 입력 / 타겟(값)에는 방금 복사한 2번 항목을 등록하고 저장합니다.
5. 네임서버가 안정화되면 외부망으로 SSL 기반의 접속 환경이 자동 준비 완료됩니다.

## 5. 최종 운영 유지보수 권고사항

- **Refresh 토큰 수동 갱신 가동 로직**:
  만약 2시간 기간을 넘겨 `Access Token`의 수명이 다했다면, `/cafe24/products` 를 호출했을 때 내부 코드 단에서 자동으로 `401 Error`를 뱉어내게 프로그래밍 되어있습니다. 프론트엔드 또는 담당자는 즉각 `/cafe24/refresh` 주소를 한번 찔러주기만 하면, 2주 기간이 남은 리프레시 토큰이 몽고DB를 거쳐가서 알아서 교환된 후 양쪽을 리필하고 종료됩니다.
- **신규 SCOPE 확장 권한 재부여 방법**:
  추후 본 파일에 `mall.read_order` 등의 주문 권한 스코프를 추가하고 싶으시다면, `.env`를 업데이트한 뒤 쇼핑몰 권한 주체가 귀찮으시더라도 다시 한번 `/cafe24/start` 화면을 들어가서 권한 확장 동의창 확인버튼을 눌러주셔야 최종 DB에 기록이 갱신 반영됩니다.
