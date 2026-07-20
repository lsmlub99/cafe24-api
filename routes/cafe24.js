import crypto from 'crypto';
import express from 'express';
import { config } from '../config/env.js';
import { cafe24AuthService } from '../services/cafe24AuthService.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { stateStore } from '../stores/stateStore.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

function maskToken(token) {
  if (!token) return null;
  if (token.length <= 8) return '****';
  return token.substring(0, 4) + '*'.repeat(token.length - 8) + token.substring(token.length - 4);
}

router.get('/start', (req, res) => {
  let sessionId = req.cookies?.cafe24_session_id;
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    res.cookie('cafe24_session_id', sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
    });
  }

  const state = crypto.randomBytes(16).toString('hex');
  stateStore.save(sessionId, state);

  logger.info(`[OAuth] redirect mall=${config.MALL_ID}`);
  res.redirect(cafe24AuthService.getAuthorizeUrl(state));
});

router.get('/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  const sessionId = req.cookies?.cafe24_session_id;

  if (error) return res.status(400).send(`인증 취소/오류: ${errorDescription}`);
  if (!code || !state || !sessionId) {
    return res.status(400).send('필수 값이 누락되었거나 세션이 만료되었습니다. 다시 시도해 주세요.');
  }
  if (!stateStore.verifyAndConsume(sessionId, state)) {
    return res.status(400).send('유효하지 않은 state 또는 만료된 세션입니다.');
  }

  try {
    const tokenData = await cafe24AuthService.getAccessToken(code);
    await tokenStore.saveTokens(
      config.MALL_ID,
      tokenData.access_token,
      tokenData.refresh_token,
      tokenData.expires_at
    );

    res.clearCookie('cafe24_session_id');
    res.send(`
      <h2>권한 발급 및 DB 저장 완료 (${config.MALL_ID})</h2>
      <p>토큰이 영구 저장되어 서버 재시작 후에도 유지됩니다.</p>
      <a href="/cafe24/products">상품 조회 테스트</a>
    `);
  } catch (err) {
    logger.error('[OAuth] callback error:', err);
    res.status(500).send('토큰 교환 중 오류가 발생했습니다.');
  }
});

router.get('/token', async (req, res) => {
  if (config.NODE_ENV !== 'development') {
    return res.status(403).json({ error: 'Forbidden', message: 'This endpoint is development-only.' });
  }

  const tokens = await tokenStore.getTokens(config.MALL_ID);
  if (!tokens.accessToken) {
    return res.status(404).json({ message: 'No token in DB. Re-authentication may be required.' });
  }

  res.json({
    mallId: config.MALL_ID,
    accessTokenMasked: maskToken(tokens.accessToken),
    refreshTokenMasked: maskToken(tokens.refreshToken),
    expiresAt: tokens.expiresAt,
  });
});

router.get('/refresh', async (req, res) => {
  const refreshToken = await tokenStore.getRefreshToken(config.MALL_ID);
  if (!refreshToken) return res.status(400).json({ message: 'Refresh token not found.' });

  try {
    const tokenData = await cafe24AuthService.refreshAccessToken(refreshToken);
    await tokenStore.saveTokens(
      config.MALL_ID,
      tokenData.access_token,
      tokenData.refresh_token || refreshToken,
      tokenData.expires_at
    );
    res.json({ message: 'Token refreshed successfully.', expiresAt: tokenData.expires_at });
  } catch (err) {
    logger.error('[OAuth] refresh error:', err);
    res.status(500).send('Token refresh failed.');
  }
});

router.get('/products', async (req, res) => {
  const accessToken = await tokenStore.getAccessToken(config.MALL_ID);
  if (!accessToken) return res.status(401).send(`토큰이 없습니다. <a href="/cafe24/start">인증 시작</a>`);

  try {
    const products = cafe24ApiService.getProductsFromCache({ limit: 5 });
    res.json({ source: 'Memory Cache', count: products.length, products });
  } catch (err) {
    logger.error('[OAuth] products API error:', err);
    res.status(500).send('Products API failed.');
  }
});

// Merchandising buckets that are NOT product types — excluded from category_names/summary so an
// external analysis grounds on real lines (선케어/토너/…), not "best/new/event" noise.
const MERCH_CATEGORY_NAMES = new Set(['베스트', '신상품', '행사', 'best', 'new', 'event']);

function buildCategoryIdToNames() {
  const catMap = cafe24ApiService.categoryMapping || {};
  const idToNames = {};
  for (const [name, ids] of Object.entries(catMap)) {
    if (MERCH_CATEGORY_NAMES.has(String(name).toLowerCase()) || MERCH_CATEGORY_NAMES.has(name)) continue;
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      if (!id) continue;
      (idToNames[Number(id)] ||= []).push(name);
    }
  }
  return idToNames;
}

const cleanProductName = (name = '') => String(name).replace(/^(\[[^\]]*\]\s*)+/, '').replace(/☆/g, '').trim();

// Full product-catalog export for external systems (pipelines / other AIs).
// Read-only, always fresh (served from the 10-min in-memory sync of Cafe24 Admin data).
// Optional guard: if CATALOG_API_KEY env is set, require ?key=... or "Authorization: Bearer ...".
//   - GET /cafe24/catalog             → sellable products (display=T & selling=T) + category_names
//   - GET /cafe24/catalog?all=true     → every synced product incl. hidden/sold-out
//   - GET /cafe24/catalog?summary=true → compact "what this brand sells": category → count + examples
router.get('/catalog', async (req, res) => {
  try {
    const requiredKey = process.env.CATALOG_API_KEY;
    if (requiredKey) {
      const provided = req.query.key || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (provided !== requiredKey) return res.status(401).json({ error: 'invalid or missing API key' });
    }

    if ((cafe24ApiService.cacheSize || 0) === 0) {
      const token = await tokenStore.getAccessToken(config.MALL_ID);
      if (token) await cafe24ApiService.syncAllProducts(token);
    }

    const includeAll = String(req.query.all || '') === 'true';
    const source = includeAll ? cafe24ApiService.allProductsCache || [] : cafe24ApiService.getProductsFromCache({});
    const idToNames = buildCategoryIdToNames();
    const namesForIds = (ids) => [...new Set((ids || []).flatMap((id) => idToNames[Number(id)] || []))];
    const syncedAt = cafe24ApiService.lastSyncTime ? new Date(cafe24ApiService.lastSyncTime).toISOString() : null;

    const withMeta = source.map((p) => {
      const category_ids = Array.isArray(p.category_ids)
        ? p.category_ids
        : Array.isArray(p.categories)
        ? p.categories.map((c) => c.category_no)
        : [];
      return { p, category_ids, category_names: namesForIds(category_ids) };
    });

    // Compact brand-profile mode: ideal for grounding "what does CellFusionC actually sell".
    if (String(req.query.summary || '') === 'true') {
      const byCategory = {};
      for (const { p, category_names } of withMeta) {
        for (const cat of category_names.length ? category_names : ['(미분류)']) {
          (byCategory[cat] ||= new Set()).add(cleanProductName(p.product_name));
        }
      }
      const categories = Object.entries(byCategory)
        .map(([category, names]) => ({ category, product_count: names.size, examples: [...names].slice(0, 8) }))
        .sort((a, b) => b.product_count - a.product_count);
      return res.json({
        mall_id: config.MALL_ID,
        brand: 'CellFusion C',
        synced_at: syncedAt,
        sells: categories.map((c) => c.category).filter((c) => c !== '(미분류)'),
        categories,
      });
    }

    const products = withMeta.map(({ p, category_ids, category_names }) => ({
      product_no: p.product_no,
      product_name: p.product_name,
      price: p.price,
      retail_price: p.retail_price,
      display: p.display,
      selling: p.selling,
      sold_out: p.sold_out,
      category_ids,
      category_names,
      image: p.list_image || p.detail_image || p.tiny_image || '',
      tags: Array.isArray(p.keywords) ? p.keywords : [],
      summary_description: p.summary_description || '',
      product_url: `https://cellfusionc.co.kr/product/detail.html?product_no=${p.product_no}`,
    }));

    res.json({
      mall_id: config.MALL_ID,
      brand: 'CellFusion C',
      synced_at: syncedAt,
      count: products.length,
      products,
    });
  } catch (err) {
    logger.error('[Catalog] export error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/categories', async (req, res) => {
  const accessToken = await tokenStore.getAccessToken(config.MALL_ID);
  if (!accessToken) return res.status(401).send(`토큰이 없습니다. <a href="/cafe24/start">인증 시작</a>`);

  try {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/categories`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await response.json();

    if (!Array.isArray(data.categories)) {
      return res.json({ message: '카테고리 응답 형식이 예상과 다릅니다.', data });
    }

    const categories = data.categories.map((c) => ({
      category_no: c.category_no,
      category_name: c.category_name,
      display_type: c.display_type,
    }));

    res.json({
      notice: '이 값을 category mapping 확인용으로 사용하세요.',
      total: categories.length,
      categories,
    });
  } catch (err) {
    logger.error('[OAuth] categories API error:', err);
    res.status(500).send('Categories API failed.');
  }
});

export default router;
