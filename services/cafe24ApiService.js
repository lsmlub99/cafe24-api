import { config } from '../config/env.js';
import { aiTaggingService } from './aiTaggingService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { cafe24AuthService } from './cafe24AuthService.js';
import { logger } from '../utils/logger.js';
import { fuzzyIncludes, toBaseName } from './recommendation/shared.js';
import { RECOMMENDATION_TAXONOMY } from '../config/recommendationPolicy.js';

let lastSyncLogs = [];
let allProductsCache = [];
let lastSyncTime = 0;
let categoryMap = {};
let ingredientDetectedPath = null;
let syncInFlight = null;
const ingredientDetailCache = new Map();

// Known category IDs that name-based lookup misses (store-specific, checked via cate_no= in URL)
// 29=유형별>선케어, 93=쇼핑>선케어 — products may be split across both
const CATEGORY_ID_SEEDS = {
  선케어: [29, 93],
  베스트: [47, 147, 148, 149, 150, 151, 152, 153],
};

// Bestseller category IDs (confirmed in Cafe24 admin)
// 47=베스트 (parent), sub: 147=선크림/BB크림, 148=크림, 149=앰플/세럼, 150=클렌징, 151=패드/팩, 152=토너, 153=세트
const BESTSELLER_CATEGORY_IDS = new Set([47, 147, 148, 149, 150, 151, 152, 153]);

const CATEGORY_TARGETS = {
  선케어: ['선케어', '선크림'],
  비비크림: ['bb크림', '비비크림'],
  크림: ['크림'],
  앰플: ['앰플', '세럼'],
  마스크팩: ['팩', '마스크', '패드'],
  클렌징: ['클렌징'],
  토너: ['토너'],
  치트: ['치트'],
  이너뷰티: ['이너뷰티'],
  선스틱: ['스틱', 'stick'],
  신상품: ['신상품'],
  베스트: ['베스트'],
  고민별_수분: ['수분/보습'],
  고민별_진정: ['민감/진정'],
  고민별_톤업: ['미백/톤업'],
  고민별_트러블: ['지성/트러블', '자성/트러블'],
  고민별_영양: ['영양/탄력'],
  고민별_잡티: ['기미/잡티'],
  행사: ['히든특가', '첫구매혜택', '특가', '세일', '앰버십'],
};

// Keyword supplements: when category filter returns few products, also search by these name keywords
// to catch products in event/promo categories not tracked by CATEGORY_TARGETS
const CATEGORY_KEYWORD_SUPPLEMENT = {
  선케어: ['선크림', '썬크림', '썬스크린', '선스크린', '선케어'],
};

// Maps CATEGORY_TARGETS key → intent concern key
const CATEGORY_CONCERN_MAP = {
  고민별_수분: 'hydration',
  고민별_진정: 'soothing',
  고민별_톤업: 'tone_up',
  고민별_트러블: 'sebum_control',
};

const INGREDIENT_HINT_PATHS = [
  'ingredient',
  'ingredients',
  'ingredient_info',
  'product_ingredient',
  'additional_information',
  'description',
  'summary_description',
  'simple_description',
];

const INGREDIENT_TEXT_MARKERS = [
  'ingredient',
  'ingredients',
  'inci',
  'niacinamide',
  'zinc oxide',
  'titanium dioxide',
  '전성분',
  'ingredients:',
  'all ingredients',
];

function looksLikeIngredientText(value) {
  const raw = String(value || '');
  const text = raw.toLowerCase().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < 50) return false;

  const markerHits = INGREDIENT_TEXT_MARKERS.filter((marker) => text.includes(marker.toLowerCase())).length;
  const separatorCount =
    (text.match(/,/g) || []).length +
    (text.match(/;/g) || []).length +
    (text.match(/\//g) || []).length +
    (text.match(/\n/g) || []).length;

  // Ingredient text is usually a long list with multiple separators.
  return markerHits >= 1 && separatorCount >= 3;
}

function getNestedValue(obj, path) {
  if (!obj || !path) return '';
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function collectStringPaths(obj, prefix = '', out = []) {
  if (!obj || typeof obj !== 'object') return out;
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.push({ path, value });
      continue;
    }
    if (value && typeof value === 'object') {
      collectStringPaths(value, path, out);
    }
  }
  return out;
}

function pickIngredientTextFromProduct(product) {
  if (!product) return '';

  if (ingredientDetectedPath) {
    const detected = getNestedValue(product, ingredientDetectedPath);
    if (looksLikeIngredientText(detected)) return String(detected);
  }

  for (const hint of INGREDIENT_HINT_PATHS) {
    const direct = product[hint];
    if (looksLikeIngredientText(direct)) return String(direct);
  }

  const entries = collectStringPaths(product);
  const preferred = entries.find(
    ({ path, value }) =>
      (path.toLowerCase().includes('ingredient') || path.toLowerCase().includes('description')) &&
      looksLikeIngredientText(value)
  );
  if (preferred) return String(preferred.value);

  const fallback = entries.find(({ value }) => looksLikeIngredientText(value));
  return fallback ? String(fallback.value) : '';
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchText(value) {
  return stripHtml(value)
    .replace(/\(\s*\d{1,2}\/\d{1,2}[^)]*\)/g, ' ')
    .replace(/\d{1,2}\/\d{1,2}~\d{1,2}\/\d{1,2}/g, ' ')
    .replace(/[^\p{L}\p{N}\s:+/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeMarketingNoise(value) {
  if (!value) return '';
  return String(value)
    .replace(/\b(기획세트|콜라보|퍼프|증정|사은품|한정|이벤트|프로모션|타임딜)\b/gi, ' ')
    .replace(/\b(1\+1|2\+1|3\+1)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchPreview(product, tags = {}) {
  const parts = [
    product.product_name,
    product.summary_description,
    product.simple_description,
    Array.isArray(tags.all_tags) ? tags.all_tags.join(' ') : '',
  ];

  const text = removeMarketingNoise(normalizeSearchText(parts.filter(Boolean).join(' ')));
  return text.slice(0, 260);
}

function buildSearchFeatures(product, tags = {}, ingredientText = '') {
  const parts = [
    product.product_name,
    product.summary_description,
    product.simple_description,
    product.description,
    product.mobile_description,
    Array.isArray(tags.all_tags) ? tags.all_tags.join(' ') : '',
    Array.isArray(tags.concern_tags) ? tags.concern_tags.join(' ') : '',
    Array.isArray(tags.texture_tags) ? tags.texture_tags.join(' ') : '',
    ingredientText,
  ];

  // Keep this compact for fast in-memory scoring and LLM payloads.
  return removeMarketingNoise(normalizeSearchText(parts.filter(Boolean).join(' '))).slice(0, 1600);
}

async function refreshTokenIfNeeded() {
  const accessToken = await tokenStore.getAccessToken(config.MALL_ID);
  if (accessToken) return accessToken;

  const tokens = await tokenStore.getTokens(config.MALL_ID);
  if (!tokens?.refreshToken) return null;

  const refreshData = await cafe24AuthService.refreshAccessToken(tokens.refreshToken);
  await tokenStore.saveTokens(
    config.MALL_ID,
    refreshData.access_token,
    refreshData.refresh_token,
    refreshData.expires_at
  );
  return refreshData.access_token;
}

async function requestWithToken(url, accessToken) {
  let targetToken = accessToken;
  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${targetToken}`, 'Content-Type': 'application/json' },
  });

  if (res.status === 401) {
    const tokens = await tokenStore.getTokens(config.MALL_ID);
    const refreshData = await cafe24AuthService.refreshAccessToken(tokens.refreshToken);
    await tokenStore.saveTokens(
      config.MALL_ID,
      refreshData.access_token,
      refreshData.refresh_token,
      refreshData.expires_at
    );
    targetToken = refreshData.access_token;
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${targetToken}`, 'Content-Type': 'application/json' },
    });
  }

  const data = await res.json();
  return { data, accessToken: targetToken, status: res.status };
}

function collectChildCategoryNos(rootNo, allCats) {
  const result = [Number(rootNo)];
  const queue = [Number(rootNo)];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const c of allCats) {
      const childId = Number(c.category_no);
      if (Number(c.parent_category_no) === current && !result.includes(childId)) {
        result.push(childId);
        queue.push(childId);
      }
    }
  }
  return result;
}

function parseCategoryNoOverrides() {
  const raw = (config.CATEGORY_NO_OVERRIDES || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const result = {};
    for (const [key, val] of Object.entries(parsed)) {
      result[key] = Array.isArray(val) ? val.map(Number).filter(Boolean) : [Number(val)].filter(Boolean);
    }
    return result;
  } catch {
    logger.warn('[Category] CATEGORY_NO_OVERRIDES is not valid JSON, ignoring');
    return {};
  }
}

async function fetchCategoryMap(accessToken) {
  try {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/categories`;
    const { data } = await requestWithToken(url, accessToken);
    const cats = data.categories || [];

    const hasParentField = cats.length > 0 && 'parent_category_no' in cats[0];
    const overrides = parseCategoryNoOverrides();

    const newMap = {};
    for (const [key, keywords] of Object.entries(CATEGORY_TARGETS)) {
      let found = cats.find((c) => keywords.some((k) => c.category_name === k));
      if (!found) {
        found = cats.find((c) =>
          keywords.some((k) => String(c.category_name || '').toLowerCase().includes(k.toLowerCase()))
        );
      }

      const allSeeds = [...(CATEGORY_ID_SEEDS[key] || []), ...(overrides[key] || [])];

      let ids;
      if (allSeeds.length > 0) {
        // Seeds defined: skip name-based lookup entirely, use seeds + their descendants
        ids = [];
        for (const seedId of allSeeds) {
          const seedIds = hasParentField ? collectChildCategoryNos(seedId, cats) : [seedId];
          for (const id of seedIds) {
            if (!ids.includes(id)) ids.push(id);
          }
        }
      } else if (found && hasParentField) {
        ids = collectChildCategoryNos(found.category_no, cats);
      } else {
        const matched = cats.filter((c) =>
          keywords.some((k) => String(c.category_name || '').toLowerCase().includes(k.toLowerCase()))
        );
        ids = [...new Set(matched.map((c) => Number(c.category_no)))];
      }

      if (ids.length > 0) newMap[key] = ids;
    }

    categoryMap = newMap;
    logger.info(`[Sync] Category map loaded (mode=${hasParentField ? 'hierarchical' : 'keyword'}):`, categoryMap);
    return categoryMap;
  } catch (e) {
    logger.error('[Category Map Error]', e.message);
    return categoryMap;
  }
}

async function fetchProductDetailWithToken(productNo, accessToken) {
  const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products/${productNo}`;
  const { data, accessToken: nextToken } = await requestWithToken(url, accessToken);
  const product = data.product || (Array.isArray(data.products) ? data.products[0] : null) || null;
  return { product, accessToken: nextToken };
}

async function detectIngredientPath(accessToken, sampleProductNos = []) {
  let targetToken = accessToken;
  let bestCandidates = [];
  for (const productNo of sampleProductNos.slice(0, 8)) {
    try {
      const detail = await fetchProductDetailWithToken(productNo, targetToken);
      targetToken = detail.accessToken;
      const product = detail.product;
      if (!product) continue;

      const entries = collectStringPaths(product);
      const scored = entries
        .map(({ path, value }) => {
          let score = 0;
          const lowerPath = path.toLowerCase();
          if (lowerPath.includes('ingredient')) score += 5;
          if (lowerPath.includes('description')) score += 1;
          if (looksLikeIngredientText(value)) score += 3;
          return { path, score, preview: String(value || '').replace(/\s+/g, ' ').slice(0, 120) };
        })
        .filter((item) => item.score >= 4)
        .sort((a, b) => b.score - a.score);

      bestCandidates = scored.slice(0, 5);

      if (scored.length > 0) {
        ingredientDetectedPath = scored[0].path;
        return {
          path: ingredientDetectedPath,
          accessToken: targetToken,
          sample: productNo,
          candidates: bestCandidates,
        };
      }
    } catch {
      // ignore sample failures
    }
  }
  return { path: null, accessToken: targetToken, sample: null, candidates: bestCandidates };
}

async function syncAllProductsCore(accessToken) {
  try {
    let targetToken = accessToken || (await refreshTokenIfNeeded());
    if (!targetToken) return { products: allProductsCache || [] };

    logger.info('[Sync] Product sync start...');
    const currentMap = await fetchCategoryMap(targetToken);
    const targetIds = [...new Set(Object.values(currentMap).flat())];

    const fields =
      'product_no,product_name,price,retail_price,list_image,detail_image,tiny_image,summary_description,simple_description,description,product_tag,sold_out,selling,display,categories';
    let allFetched = [];
    let offset = 0;
    const pageSize = 100;

    while (true) {
      const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${pageSize}&offset=${offset}&fields=${fields}`;
      const result = await requestWithToken(url, targetToken);
      targetToken = result.accessToken;
      const page = result.data.products || [];
      if (page.length === 0) break;
      allFetched.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    logger.info(`[Sync] Product list fetched: ${allFetched.length}`);
    const logs = [`Total: ${allFetched.length}`];

    const sampleProductNos = allFetched.slice(0, 12).map((p) => p.product_no).filter(Boolean);
    const detectedIngredient = await detectIngredientPath(targetToken, sampleProductNos);
    targetToken = detectedIngredient.accessToken;
    if (detectedIngredient.path) {
      logs.push(`Ingredient path detected: ${detectedIngredient.path} (sample: ${detectedIngredient.sample})`);
    } else {
      logs.push('Ingredient path not detected from samples');
    }
    if (Array.isArray(detectedIngredient.candidates) && detectedIngredient.candidates.length > 0) {
      logs.push(`Ingredient path candidates: ${JSON.stringify(detectedIngredient.candidates)}`);
    }

    // Diagnose: check if categories field is returned by product list API
    const sampleCats = allFetched[0]?.categories;
    logger.info(`[Sync] Sample product[0] categories field: ${JSON.stringify(sampleCats)}`);

    // Build productToCategories from the categories field returned per-product (includes all categories, not just representative)
    const productToCategories = {};
    for (const p of allFetched) {
      const pNo = String(p.product_no);
      if (Array.isArray(p.categories)) {
        for (const cat of p.categories) {
          const catId = Number(cat.category_no);
          if (Number.isFinite(catId) && targetIds.includes(catId)) {
            if (!productToCategories[pNo]) productToCategories[pNo] = [];
            if (!productToCategories[pNo].includes(catId)) productToCategories[pNo].push(catId);
          }
        }
      }
    }

    // Log per-category counts
    const catCounts = {};
    for (const ids of Object.values(productToCategories)) {
      for (const id of ids) {
        catCounts[id] = (catCounts[id] || 0) + 1;
      }
    }
    const catCountStr = targetIds.map((id) => `cat${id}=${catCounts[id] || 0}`).join(' ');
    logger.info(`[Sync] Category counts from product.categories field: ${catCountStr}`);
    for (const catId of targetIds) {
      logs.push(`Cat ${catId} found ${catCounts[catId] || 0} items`);
    }

    // Fallback: for any targetId that got 0 products, try the old products?category= endpoint
    const zeroCats = targetIds.filter((id) => !catCounts[id]);
    if (zeroCats.length > 0) logger.info(`[Sync] Fallback to products?category= for: ${zeroCats.join(',')}`);
    for (const catId of zeroCats) {
      try {
        const catUrl = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?category=${catId}&limit=100&fields=product_no`;
        const result = await requestWithToken(catUrl, targetToken);
        targetToken = result.accessToken;
        const items = result.data.products || [];
        items.forEach((cp) => {
          const pNo = String(cp.product_no);
          if (!productToCategories[pNo]) productToCategories[pNo] = [];
          if (!productToCategories[pNo].includes(Number(catId))) productToCategories[pNo].push(Number(catId));
        });
        logger.info(`[Sync] Fallback cat${catId}: ${items.length} products found`);
        logs.push(`Cat ${catId} fallback found ${items.length} items`);
      } catch (err) {
        logs.push(`Cat ${catId} fallback ERR: ${err.message}`);
      }
    }

    // Diagnose active product counts by keyword
    const activeProducts = allFetched.filter((p) => p.display === 'T' && p.selling === 'T');
    logger.info(`[Sync] Active (display=T selling=T) products: ${activeProducts.length} / ${allFetched.length}`);
    const sunKeywords = ['썬스크린', '선크림', '썬크림', '선스크린'];
    for (const kw of sunKeywords) {
      const matched = activeProducts.filter((p) => String(p.product_name || '').toLowerCase().includes(kw));
      if (matched.length > 0) logger.info(`[Sync] Active products with name containing '${kw}': ${matched.length} (e.g. ${matched[0].product_name})`);
    }

    lastSyncLogs = logs;

    const allFetchedWithCats = allFetched.map((p) => ({
      ...p,
      categories: (productToCategories[String(p.product_no)] || []).map((id) => ({ category_no: id })),
    }));

    const tagResults = aiTaggingService.tagAllProducts(allFetchedWithCats);
    const tagMap = new Map(tagResults.map((t) => [t.product_no, t]));

    const newCatIds = new Set((categoryMap['신상품'] || []).map(Number));
    const bestCatIds = new Set([...(categoryMap['베스트'] || []).map(Number), ...BESTSELLER_CATEGORY_IDS]);
    const eventCatIds = new Set((categoryMap['행사'] || []).map(Number));
    const concernCatSets = Object.fromEntries(
      Object.entries(CATEGORY_CONCERN_MAP).map(([catKey, concern]) => [
        concern,
        new Set((categoryMap[catKey] || []).map(Number)),
      ])
    );

    allProductsCache = allFetchedWithCats.map((p) => {
      const tags = tagMap.get(p.product_no) || {};
      const ingredientText = pickIngredientTextFromProduct(p);
      const searchPreview = buildSearchPreview(p, tags);
      const searchFeatures = buildSearchFeatures(p, tags, ingredientText);
      ingredientDetailCache.set(String(p.product_no), ingredientText || '');

      const catIds = (productToCategories[String(p.product_no)] || []).map(Number);
      const is_new = catIds.some((id) => newCatIds.has(id));
      const is_best = catIds.some((id) => bestCatIds.has(id));
      const is_event = catIds.some((id) => eventCatIds.has(id));
      const category_concern_tags = Object.entries(concernCatSets)
        .filter(([, ids]) => catIds.some((id) => ids.has(id)))
        .map(([concern]) => concern);

      return {
        ...p,
        product_id: p.product_no,
        category_ids: catIds,
        ingredient_text: ingredientText || '',
        search_preview: searchPreview,
        search_features: searchFeatures,
        keywords: tags.all_tags || [],
        is_new,
        is_best,
        is_event,
        category_concern_tags,
        attributes: {
          category_tags: tags.category_tags || [],
          line_tags: tags.line_tags || [],
          concern_tags: [...new Set([...(tags.concern_tags || []), ...category_concern_tags])],
          texture_tags: tags.texture_tags || [],
          role_tags: tags.role_tags || [],
        },
      };
    });

    lastSyncTime = Date.now();
    const bestCount = allProductsCache.filter((p) => p.is_best).length;
    const bestNames = allProductsCache.filter((p) => p.is_best).map((p) => p.product_name).slice(0, 5).join(', ');
    logger.info(`[Sync SUCCESS] Cached products: ${allProductsCache.length} | is_best=${bestCount} (e.g. ${bestNames || 'none'})`);

    return { products: allProductsCache };
  } catch (e) {
    logger.error('[Sync Error]:', e.message);
    return { products: allProductsCache || [] };
  }
}

async function syncAllProducts(accessToken) {
  if (syncInFlight) {
    logger.info('[Sync] Join in-flight sync...');
    return syncInFlight;
  }

  syncInFlight = (async () => {
    try {
      return await syncAllProductsCore(accessToken);
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

function getDynamicCategoryNos(keywords = []) {
  const results = [];
  const lowerKeys = keywords.map((k) => String(k || '').toLowerCase());

  for (const [mapName, ids] of Object.entries(categoryMap)) {
    if (
      lowerKeys.some(
        (k) =>
          mapName.toLowerCase().includes(k) ||
          (k.includes(mapName.toLowerCase()) && !(k.includes('비비') && !mapName.toLowerCase().includes('비비'))) ||
          (k === '선크림' && mapName === '선케어')
      )
    ) {
      const idList = Array.isArray(ids) ? ids : [ids];
      for (const id of idList) {
        if (id && !results.includes(id)) results.push(id);
      }
    }
  }
  return results;
}

function getProductsFromCache(filters = {}) {
  const { categoryNos, keyword, limit } = filters;

  let results = allProductsCache.filter((p) => p.display === 'T' && p.selling === 'T');

  if (categoryNos && categoryNos.length > 0) {
    results = results.filter((p) => {
      const productCategories = Array.isArray(p.categories)
        ? p.categories.map((c) => Number(c.category_no))
        : [];
      return categoryNos.some((cNo) => productCategories.includes(Number(cNo)));
    });
    logger.cacheVerbose(`[Cache Filter] Active Products ${results.length} matched for cats: ${categoryNos}`);
  }

  if (keyword) {
    const lower = String(keyword).toLowerCase();
    const beforeKeywordPool = results;
    results = beforeKeywordPool.filter(
      (p) =>
        String(p.product_name || '').toLowerCase().includes(lower) ||
        (p.keywords || []).some((t) => String(t).toLowerCase().includes(lower))
    );
    // Typo/spacing-tolerant fallback: if the exact substring match found nothing,
    // retry with edit-distance matching so a slightly misspelled product name still hits.
    if (results.length === 0) {
      results = beforeKeywordPool.filter((p) => fuzzyIncludes(p.product_name, keyword));
    }
    logger.cacheVerbose(`[Cache Filter] Active Products ${results.length} matched for keyword: ${keyword}`);
  }

  if (limit && limit > 0) results = results.slice(0, limit);
  return results;
}

async function enrichProductsWithIngredientText(products = [], maxFetch = 12) {
  if (!Array.isArray(products) || products.length === 0) return products;

  let accessToken = await refreshTokenIfNeeded();
  if (!accessToken) return products;

  const missing = products
    .filter((p) => {
      const pNo = String(p.product_no || p.product_id || '');
      if (!pNo) return false;
      if (p.ingredient_text && String(p.ingredient_text).trim().length > 0) return false;
      if (ingredientDetailCache.has(pNo)) return false;
      return true;
    })
    .slice(0, maxFetch);

  for (const product of missing) {
    const productNo = String(product.product_no || product.product_id || '');
    if (!productNo) continue;

    try {
      const detail = await fetchProductDetailWithToken(productNo, accessToken);
      accessToken = detail.accessToken;
      const ingredientText = pickIngredientTextFromProduct(detail.product);
      ingredientDetailCache.set(productNo, ingredientText || '');
    } catch {
      ingredientDetailCache.set(productNo, '');
    }
  }

  return products.map((p) => {
    const productNo = String(p.product_no || p.product_id || '');
    const fromDetail = ingredientDetailCache.get(productNo) || '';
    const fromSelf = p.ingredient_text || pickIngredientTextFromProduct(p);
    return { ...p, ingredient_text: fromSelf || fromDetail || '' };
  });
}

async function inspectProductDetailFields(productNo) {
  const token = await refreshTokenIfNeeded();
  if (!token) {
    return { error: 'No access token available.' };
  }

  const detail = await fetchProductDetailWithToken(productNo, token);
  const product = detail.product;
  if (!product) {
    return { error: `Product detail not found for product_no=${productNo}` };
  }

  const entries = collectStringPaths(product)
    .map(({ path, value }) => {
      const lowerPath = path.toLowerCase();
      const text = String(value || '');
      let score = 0;
      if (lowerPath.includes('ingredient')) score += 5;
      if (lowerPath.includes('description')) score += 2;
      if (looksLikeIngredientText(text)) score += 4;
      if (INGREDIENT_TEXT_MARKERS.some((m) => text.toLowerCase().includes(m.toLowerCase()))) score += 1;
      return {
        path,
        score,
        length: text.length,
        preview: text.replace(/\s+/g, ' ').slice(0, 200),
      };
    })
    .filter((item) => item.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);

  return {
    product_no: product.product_no,
    product_name: product.product_name,
    detected_ingredient_path: ingredientDetectedPath,
    top_level_keys: Object.keys(product),
    candidate_fields: entries,
  };
}

// Stricter than the 0.25 ratio used for category-supplement fuzzy matching — this decides
// whether the user is naming a real, specific product, so false positives are costlier here.
const EXACT_MATCH_DISTANCE_RATIO = 0.15;
const EXACT_MATCH_MIN_LENGTH = 4;

// Generic category/form words ("썬스크린", "토너", "크림", ...) must not count as a "product
// name" match on their own — every product in that category would spuriously match, turning
// an ordinary category browse into a false single-product pin. Only distinctive line/product
// words (e.g. "아쿠아티카") count.
// Brand name appears in EVERY product ("셀퓨전씨 …"), and promo/market wrappers ("마켓_추가구성")
// are not product identity — neither should count as a distinctive product-name token, or a bare
// brand mention like "셀퓨전씨 남성용 화장품 있나요?" falsely matches a random product.
const BRAND_AND_NOISE_STOPWORDS = [
  '셀퓨전씨', '셀퓨전', '셀퓨전c', 'cellfusion', 'cellfusionc',
  '마켓', '마켓종료', '추가구성', '종료', '기획', '세트',
];

const GENERIC_PRODUCT_TOKEN_STOPWORDS = new Set(
  [
    ...Object.values(RECOMMENDATION_TAXONOMY.categories || {}).flat(),
    ...Object.values(RECOMMENDATION_TAXONOMY.forms || {}).flat(),
    ...BRAND_AND_NOISE_STOPWORDS,
  ].map((w) => String(w).toLowerCase().replace(/\s+/g, ''))
);

function getDistinctiveNameTokens(productName) {
  return toBaseName(productName)
    .split(/[\s_]+/)
    .map((t) => t.trim())
    .filter((t) => {
      if (!t) return false;
      if (/^\d+(\.\d+)?\s?(ml|g|kg|oz|ea)$/i.test(t)) return false;
      const compact = t.toLowerCase().replace(/\s+/g, '');
      if (compact.length < EXACT_MATCH_MIN_LENGTH) return false;
      return !GENERIC_PRODUCT_TOKEN_STOPWORDS.has(compact);
    });
}

// Ground-truth, deterministic "did the user name a real catalog product" check, run against
// the raw text regardless of which tool arguments the calling model chose to fill. Matches on
// distinctive name tokens (not the whole product name) so a short brand/line mention like
// "아쿠아티카" still hits even though the user didn't repeat the full "아쿠아티카 쿨링 썬스크린 35ml".
function matchesProductName(p, query) {
  const tokens = getDistinctiveNameTokens(p.product_name);
  return tokens.some((token) => fuzzyIncludes(query, token, EXACT_MATCH_DISTANCE_RATIO));
}

function isSellable(p) {
  return p.display === 'T' && p.selling === 'T' && p.sold_out !== 'T';
}

function findConfidentProductMatches(text) {
  const query = String(text || '').trim();
  if (!query) return [];
  return allProductsCache.filter((p) => isSellable(p) && matchesProductName(p, query));
}

// Same name match but for currently-unavailable SKUs only. Lets the tool say "that product is
// sold out" instead of silently showing unrelated alternatives, when a user names a real product
// whose every variant is out of stock (e.g. "워터 핏 쿨링 썬 스틱").
function findSoldOutProductMatches(text) {
  const query = String(text || '').trim();
  if (!query) return [];
  return allProductsCache.filter((p) => !isSellable(p) && matchesProductName(p, query));
}

const MENS_MARKERS = ['남성', '남자', '맨즈', '멘즈', 'for men', "men's", '포맨', '포 맨'];

// Sellable products explicitly targeted at men (by tag/name), including gift sets — the catalog's
// men's line is often sold only as a "기획세트", which the normal promo filter would hide.
function findMensProducts() {
  return allProductsCache.filter((p) => {
    if (!isSellable(p)) return false;
    const hay = `${p.product_name || ''} ${(p.keywords || []).join(' ')} ${p.search_features || ''}`.toLowerCase();
    return MENS_MARKERS.some((m) => hay.includes(m.toLowerCase()));
  });
}

function getKeywordSupplementForLookup(lookupKeywords = []) {
  for (const kw of lookupKeywords) {
    for (const [key, supplements] of Object.entries(CATEGORY_KEYWORD_SUPPLEMENT)) {
      if (String(kw).includes(key) || key.includes(String(kw))) return supplements;
    }
  }
  return [];
}

export const cafe24ApiService = {
  syncAllProducts,
  getProductsFromCache,
  getDynamicCategoryNos,
  getKeywordSupplementForLookup,
  findConfidentProductMatches,
  findSoldOutProductMatches,
  findMensProducts,
  enrichProductsWithIngredientText,
  inspectProductDetailFields,
  get allProductsCache() {
    return allProductsCache;
  },
  get cacheSize() {
    return allProductsCache.length;
  },
  get lastSyncTime() {
    return lastSyncTime;
  },
  get categoryMapping() {
    return categoryMap;
  },
  get syncLogs() {
    return lastSyncLogs;
  },
  get ingredientPath() {
    return ingredientDetectedPath;
  },
};
