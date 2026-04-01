import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { config } from './config/env.js';
import cafe24Router from './routes/cafe24.js';
import mcpRouter from './routes/mcp.js';

const app = express();

// Render나 AWS 클라우드처럼 프록시(Load Balancer) 뒤에 있을 경우 사용자의 진짜 IP를 식별하기 위해 필수
app.set('trust proxy', 1);

app.use(express.json());
app.use(cookieParser());

// ---------------------------------------------------------
// [무료 DB 연동] MongoDB(몽구스) Atlas 연결 로직 추가
// Render 무료 티어에서도 데이터 증발 현상이 방지됩니다.
// ---------------------------------------------------------
mongoose.connect(config.MONGO_URI)
  .then(() => {
    console.log(`✅ MongoDB 연결 성공! (토큰 영구 저장 시스템 가동)`);
  })
  .catch((err) => {
    console.error(`❌ MongoDB 연결 실패. .env 의 MONGO_URI 를 다시 확인하십시오:`, err.message);
    process.exit(1); // DB 통신 실패 시 백엔드도 즉시 셧다운
  });

app.use('/cafe24', cafe24Router);
app.use('/mcp', mcpRouter); // AI 모델 컨텍스트 프로토콜 라우팅 추가

app.get('/', (req, res) => {
  res.send(`
    <h1>Cell Fusion C - Cafe24 통합 모듈(DB 영구 저장 버전)</h1>
    <ul>
      <li><a href="/cafe24/start">1. 카페24 인증(OAuth) 및 MongoDB 연동</a></li>
      <li><a href="/cafe24/token">2. 현재 DB에 발급된 토큰 상태 확인</a></li>
      <li><a href="/cafe24/products">3. 상품 리스트 조회 테스트 (API 연동)</a></li>
      <li><a href="/cafe24/refresh">4. 만료된 토큰을 리프레시하고 DB에 재기록</a></li>
      <li><a href="/mcp">5. MCP (Model Context Protocol) 통신 인터페이스 대기중</a></li>
    </ul>
    <p style="color:red; font-size:12px;">* 주의: Render 등에서 호스팅 시 재부팅되더라도 더이상 정보가 소실되지 않습니다.</p>
  `);
});

app.use((err, req, res, next) => {
  console.error(`[FATAL ERROR] 감지되지 않은 예외 발생:`, err.stack);
  res.status(500).send('서버 내부 치명적인 오류 발생');
});

app.listen(config.PORT, () => {
  console.log(`========================================================`);
  console.log(`🚀 Cafe24 API Server Started (MongoDB Sync On)`);
  console.log(`▶ PORT : ${config.PORT}`);
  console.log(`▶ TARGET MALL : ${config.MALL_ID}`);
  console.log(`▶ SCOPE : ${config.SCOPE}`);
  console.log(`========================================================`);
});