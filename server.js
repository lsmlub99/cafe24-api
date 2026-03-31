import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config/env.js';
import cafe24Router from './routes/cafe24.js';

const app = express();

// 미들웨어 등록 (바디로 들어오는 JSON 파싱, 세션을 위한 쿠키 파싱)
app.use(express.json());
app.use(cookieParser()); // state 검증 세션 쿠키 통신에 필수적입니다.

// 카페24 전용 라우터 등록
app.use('/cafe24', cafe24Router);

// 기본 메인 페이지 랜딩
app.get('/', (req, res) => {
  res.send(`
    <h1>Cell Fusion C - Cafe24 통합 모듈(운영 준비 버전)</h1>
    <ul>
      <li><a href="/cafe24/start">1. 카페24 인증 플로우 시작 (OAuth 연동)</a></li>
      <li><a href="/cafe24/token">2. 현재 발급된 토큰/MemoryStore 상태 확인</a></li>
      <li><a href="/cafe24/products">3. 상품 리스트 조회 테스트 (API 연동 예시)</a></li>
      <li><a href="/cafe24/refresh">4. 리프레시 토큰으로 권한 수동 갱신</a></li>
    </ul>
    <p style="color:red; font-size:12px;">* 주의: 현재 도메인이 api.cellfusionc.co.kr 이며 앱 설정과 일치하는지 확인하십시오.</p>
  `);
});

// 글로벌 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
  console.error(`[FATAL ERROR] 감지되지 않은 예외 처리:`, err.stack);
  res.status(500).send('서버 내부에서 치명적인 오류가 발생했습니다.');
});

// 서버 바인딩 및 구동
app.listen(config.PORT, () => {
  console.log(`========================================================`);
  console.log(`🚀 Cafe24 API Server Started (운영 전환 대비 구조 적용 완료)`);
  console.log(`▶ PORT : ${config.PORT}`);
  console.log(`▶ TARGET MALL : ${config.MALL_ID}`);
  console.log(`▶ CONFIGURED REDIRECT_URI : ${config.REDIRECT_URI}`);
  console.log(`▶ SCOPE : ${config.SCOPE}`);
  console.log(`========================================================`);
});