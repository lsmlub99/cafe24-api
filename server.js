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
// [무료 서버 최적화] 백그라운드 상품 싱크 & Keep-alive 가동
// 서버 기동 시 및 10분마다 전체 상품을 메모리에 로드하여 응답 속도를 0.1초대로 단축합니다.
// ---------------------------------------------------------
import { tokenStore } from './stores/tokenStore.js';
import { cafe24ApiService } from './services/cafe24ApiService.js';

const startSyncLoop = async () => {
    try {
        const accessToken = await tokenStore.getAccessToken(config.MALL_ID);
        if (accessToken) {
            await cafe24ApiService.syncAllProducts(accessToken);
        }
    } catch (e) {
        console.warn(`[Sync Init] 초기 싱크 대기 중... (토큰 미발급 상태)`);
    }

    // 10분(600,000ms)마다 백그라운드 동기화 수행
    setInterval(async () => {
        const accessToken = await tokenStore.getAccessToken(config.MALL_ID);
        if (accessToken) {
            await cafe24ApiService.syncAllProducts(accessToken);
        }
    }, 10 * 60 * 1000);
};

mongoose.connect(config.MONGO_URI)
  .then(() => {
    console.log(`✅ MongoDB 연결 성공! (토큰 영구 저장 시스템 가동)`);
    startSyncLoop(); // 백그라운드 싱크 가동
  })
  .catch((err) => {
    console.error(`❌ MongoDB 연결 실패. .env 의 MONGO_URI 를 다시 확인하십시오:`, err.message);
    process.exit(1); // DB 통신 실패 시 백엔드도 즉시 셧다운
  });

app.use('/cafe24', cafe24Router);
app.use('/mcp', mcpRouter); // AI 모델 컨텍스트 프로토콜 라우팅 추가

app.get('/', (req, res) => {
  res.send(`
    <h1>Cell Fusion C - Cafe24 통합 모듈 (Ultra-Fast Sync On)</h1>
    <ul>
      <li><a href="/cafe24/start">1. 카페24 인증(OAuth) 및 MongoDB 연동</a></li>
      <li><a href="/cafe24/token">2. 현재 DB에 발급된 토큰 상태 확인</a></li>
      <li><a href="/cafe24/products">3. 상품 리스트 조회 테스트 (Memory Sync)</a></li>
      <li><a href="/cafe24/refresh">4. 만료된 토큰을 리프레시하고 DB에 재기록</a></li>
      <li><a href="/mcp">5. MCP (Model Context Protocol) 통신 인터페이스 대기중</a></li>
      <li><a href="/debug/cache">6. 🔍 캐시 진단 (임시)</a></li>
    </ul>
    <p style="color:green; font-weight:bold;">* 초고속 로컬 캐싱 시스템이 가동 중입니다. 응답 속도가 0.1초 이내로 단축됩니다.</p>
  `);
});

// ── 🔍 임시 진단 엔드포인트 (검증 후 삭제) ──
app.get('/debug/cache', async (req, res) => {
  // ?force=true 가 붙으면 즉시 전체 싱크 돌림
  if (req.query.force === 'true') {
    const accessToken = await tokenStore.getAccessToken(config.MALL_ID);
    if (accessToken) {
      await cafe24ApiService.syncAllProducts(accessToken);
    }
  }
  
  const cache = cafe24ApiService.getProductsFromCache({});
  const sample = cache.slice(0, 3).map(p => ({
    product_no: p.product_no,
    product_name: p.product_name,
    // 핵심: categories 필드가 실제로 존재하는지, 어떤 형태인지
    categories: p.categories,
    category: p.category,
    // 태그 데이터
    keywords: p.keywords,
    attributes: p.attributes,
  }));

  // category_no 29 테스트
  const cat29 = cache.filter(p => {
    const cats = Array.isArray(p.categories) ? p.categories.map(c => c.category_no) : [];
    return cats.includes(29);
  });

  // 선세럼 키워드 매칭 테스트
  const sunSerum = cache.filter(p =>
    (p.product_name || '').includes('선세럼') ||
    (p.keywords || []).some(t => t.includes('선세럼'))
  );

  res.json({
    총_캐시_수: cache.length,
    샘플_3개_raw: sample,
    category_no_29_매칭수: cat29.length,
    category_no_29_상품명: cat29.map(p => p.product_name),
    선세럼_키워드_매칭수: sunSerum.length,
    선세럼_매칭_상품: sunSerum.map(p => ({
      product_no: p.product_no,
      product_name: p.product_name,
      keywords: p.keywords,
      categories: p.categories,
    })),
    // 전체 상품에서 categories 필드 존재 비율
    categories_필드_존재율: `${cache.filter(p => p.categories !== undefined).length}/${cache.length}`,
    category_필드_존재율: `${cache.filter(p => p.category !== undefined).length}/${cache.length}`,
  });
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