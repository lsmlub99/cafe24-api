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
import { logger } from './utils/logger.js';

const startSyncLoop = async () => {
    try {
        const accessToken = await tokenStore.getAccessToken(config.MALL_ID);
        if (accessToken) {
            await cafe24ApiService.syncAllProducts(accessToken);
        }
    } catch (e) {
        logger.warn('[Sync Init] waiting for initial token');
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
    logger.info('✅ MongoDB connected');
    startSyncLoop(); // 백그라운드 싱크 가동
  })
  .catch((err) => {
    logger.error('❌ MongoDB connection failed:', err.message);
    process.exit(1); // DB 통신 실패 시 백엔드도 즉시 셧다운
  });

import { recommendationService } from './services/recommendationService.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use('/cafe24', cafe24Router);
app.use('/mcp', mcpRouter);

// ── 🎁 [Web UI 추천 API] ──
// 리액트 프론트엔드와 실시간 연결되는 추천 엔드포인트
app.post('/api/recommend', async (req, res) => {
    try {
        const { query } = req.body;
        logger.debug(`[API-Request] query="${query}"`);

        const args = { skin_type: '', q: query, query };
        const intent = recommendationService.normalizeUserIntent(args);
        const categoryNos = cafe24ApiService.getDynamicCategoryNos(intent.target_categories || []);

        let candidates = [];
        if (Array.isArray(categoryNos) && categoryNos.length > 0) {
            candidates = cafe24ApiService.getProductsFromCache({ categoryNos });
        } else {
            candidates = cafe24ApiService.getProductsFromCache({ keyword: query });
        }
        if (!Array.isArray(candidates) || candidates.length === 0) {
            candidates = cafe24ApiService.getProductsFromCache({});
        }

        const result = await recommendationService.scoreAndFilterProducts(candidates, args, 5);

        res.json(result);
    } catch (e) {
        logger.error('[API-Error]', e.message);
        res.status(500).json({ error: '추천 처리 중 오류가 발생했습니다.' });
    }
});

// ── 🌐 [Frontend 서빙] ──
// 프론트엔드 빌드 결과물(dist)이 있다면 이를 기본으로 서비스함
app.use(
  express.static(path.join(__dirname, 'client/dist'), {
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  })
);

import fs from 'fs';

// [MCP UI RESOURCE] 지피티 앱이 리액트 위젯을 불러오는 경로
app.get('/ui/recommendation', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.sendFile(path.join(__dirname, 'client/dist', 'index.html'));
});

// 모든 기타 경로는 리액트 index.html로 (SPA 지원)
app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/cafe24') ||
      req.path.startsWith('/mcp') ||
      req.path.startsWith('/debug')
    ) return next();
    
    const indexPath = path.join(__dirname, 'client/dist', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(200).send(`
            <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;}</style>
            <h1>🏗️ AI 쇼핑 UI 빌드 중...</h1>
            <p>서버가 처음 시작되거나 리액트 화면을 굽는 중입니다. 30초 후 새로고침 해주세요.</p>
        `);
    }
});

// [기존 메인페이지는 API 전용 대시보드로 이동]
app.get('/api/dashboard', (req, res) => {
  res.send(`
    <h1>Cell Fusion C - Admin Dashboard</h1>
    <ul>
      <li><a href="/cafe24/start">1. 카페24 인증(OAuth) 및 MongoDB 연동</a></li>
      <li><a href="/cafe24/token">2. 현재 DB에 발급된 토큰 상태 확인</a></li>
      <li><a href="/cafe24/products">3. 상품 리스트 조회 테스트 (Memory Sync)</a></li>
      <li><a href="/cafe24/refresh">4. 만료된 토큰을 리프레시하고 DB에 재기록</a></li>
      <li><a href="/mcp">5. MCP 통신 인터페이스</a></li>
    </ul>
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
  
  const rawCache = cafe24ApiService.allProductsCache || [];
  const cache = cafe24ApiService.getProductsFromCache({});
  const displayTrueCount = rawCache.filter(p => p.display === 'T').length;
  const sellingTrueCount = rawCache.filter(p => p.selling === 'T').length;
  const activeCount = rawCache.filter(p => p.display === 'T' && p.selling === 'T').length;
  const sample = cache.slice(0, 3).map(p => ({
    product_no: p.product_no,
    product_name: p.product_name,
    // 핵심: categories 필드가 실제로 존재하는지, 어떤 형태인지
    categories: p.categories,
    category: p.category,
    // 태그 데이터
    keywords: p.keywords,
    attributes: p.attributes,
    search_preview: p.search_preview || '',
    search_features_length: String(p.search_features || '').length,
    ingredient_text_preview: String(p.ingredient_text || '').slice(0, 180),
  }));

  const ingredientFilledCount = cache.filter(
    p => typeof p.ingredient_text === 'string' && p.ingredient_text.trim().length > 0
  ).length;

  const ingredientSample = cache
    .filter(p => typeof p.ingredient_text === 'string' && p.ingredient_text.trim().length > 0)
    .slice(0, 3)
    .map(p => ({
      product_no: p.product_no,
      product_name: p.product_name,
      ingredient_text_preview: String(p.ingredient_text || '').slice(0, 250),
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
    "raw_cache_count": rawCache.length,
    "active_cache_count": activeCount,
    "display_true_count": displayTrueCount,
    "selling_true_count": sellingTrueCount,
    "cache_count": cache.length,
    "ingredient_path_detected": cafe24ApiService.ingredientPath || null,
    "ingredient_filled_count": ingredientFilledCount,
    "ingredient_filled_ratio": `${ingredientFilledCount}/${cache.length}`,
    "ingredient_samples": ingredientSample,
    "총_캐시_수": cache.length,
    "detect_mapping": cafe24ApiService.categoryMapping || {}, 
    "category_sun_매칭수": cache.filter(p => {
        const cNos = Array.isArray(p.categories) ? p.categories.map(c => c.category_no) : [];
        const sunCareId = (cafe24ApiService.categoryMapping || {})['선케어'];
        return sunCareId && cNos.includes(sunCareId);
    }).length,
    "categories_필드_존재율": `${cache.filter(p => p.categories !== undefined).length}/${cache.length}`,
    "sync_report": cafe24ApiService.syncLogs || [],
    "samples": sample
  });
});

app.get('/debug/product/:productNo', async (req, res) => {
  try {
    const productNo = String(req.params.productNo || '').trim();
    if (!productNo) {
      return res.status(400).json({ error: 'productNo is required' });
    }
    const result = await cafe24ApiService.inspectProductDetailFields(productNo);
    res.json(result);
  } catch (e) {
    logger.error('[DEBUG product Error]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.use((err, req, res, next) => {
  logger.error('[FATAL ERROR] unhandled exception:', err.stack);
  res.status(500).send('서버 내부 치명적인 오류 발생');
});

app.listen(config.PORT, () => {
  logger.info('========================================================');
  logger.info('🚀 Cafe24 API Server Started (MongoDB Sync On)');
  logger.info(`▶ PORT : ${config.PORT}`);
  logger.info(`▶ TARGET MALL : ${config.MALL_ID}`);
  logger.info(`▶ SCOPE : ${config.SCOPE}`);
  logger.info('========================================================');
});
