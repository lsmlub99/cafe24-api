import { config } from '../config/env.js';
import { aiTaggingService } from './aiTaggingService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { cafe24AuthService } from './cafe24AuthService.js';

let lastSyncLogs = [];
let allProductsCache = [];
let lastSyncTime = 0;
let lastSyncHash = '';
let categoryMap = {};
let ingredientDetectedPath = null;
const ingredientDetailCache = new Map();

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

async function fetchCategoryMap(accessToken) {
  try {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/categories`;
    const { data } = await requestWithToken(url, accessToken);
    const cats = data.categories || [];

    const newMap = {};
    for (const [key, keywords] of Object.entries(CATEGORY_TARGETS)) {
      let found = cats.find((c) => keywords.some((k) => c.category_name === k));
      if (!found) {
        found = cats.find((c) =>
          keywords.some((k) => String(c.category_name || '').toLowerCase().includes(k.toLowerCase()))
        );
      }
      if (found) newMap[key] = found.category_no;
    }

    categoryMap = newMap;
    console.log('[Sync] Category map loaded:', categoryMap);
    return categoryMap;
  } catch (e) {
    console.error('[Category Map Error]', e.message);
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

async function syncAllProducts(accessToken) {
  try {
    let targetToken = accessToken || (await refreshTokenIfNeeded());
    if (!targetToken) return { products: allProductsCache || [] };

    console.log('[Sync] Product sync start...');
    const currentMap = await fetchCategoryMap(targetToken);
    const targetIds = Object.values(currentMap);

    const fields =
      'product_no,product_name,price,retail_price,list_image,detail_image,tiny_image,summary_description,simple_description,description,product_tag,sold_out,selling,display';
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

    console.log(`[Sync] Product list fetched: ${allFetched.length}`);
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

    const productToCategories = {};
    for (const catId of targetIds) {
      try {
        const catUrl = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?category=${catId}&limit=100&fields=product_no`;
        const result = await requestWithToken(catUrl, targetToken);
        targetToken = result.accessToken;
        const items = result.data.products || [];

        if (logs.length === 2) logs.push(`Sample (Cat ${catId}): ${JSON.stringify(items.slice(0, 1))}`);
        logs.push(`Cat ${catId} found ${items.length} items`);

        items.forEach((cp) => {
          const pNo = String(cp.product_no);
          if (!productToCategories[pNo]) productToCategories[pNo] = [];
          productToCategories[pNo].push(Number(catId));
        });
      } catch (err) {
        logs.push(`Cat ${catId} ERR: ${err.message}`);
      }
    }
    lastSyncLogs = logs;

    const allFetchedWithCats = allFetched.map((p) => ({
      ...p,
      categories: (productToCategories[String(p.product_no)] || []).map((id) => ({ category_no: id })),
    }));

    const tagResults = aiTaggingService.tagAllProducts(allFetchedWithCats);
    const tagMap = new Map(tagResults.map((t) => [t.product_no, t]));

    allProductsCache = allFetchedWithCats.map((p) => {
      const tags = tagMap.get(p.product_no) || {};
      const ingredientText = pickIngredientTextFromProduct(p);
      ingredientDetailCache.set(String(p.product_no), ingredientText || '');
      return {
        ...p,
        product_id: p.product_no,
        ingredient_text: ingredientText || '',
        keywords: tags.all_tags || [],
        attributes: {
          category_tags: tags.category_tags || [],
          line_tags: tags.line_tags || [],
          concern_tags: tags.concern_tags || [],
          texture_tags: tags.texture_tags || [],
        },
      };
    });

    lastSyncTime = Date.now();
    lastSyncHash = JSON.stringify(allFetched.map((p) => `${p.product_no}${p.product_name}${p.price}`));
    console.log(`[Sync SUCCESS] Cached products: ${allProductsCache.length}`);
    return { products: allProductsCache };
  } catch (e) {
    console.error('[Sync Error]:', e.message);
    return { products: allProductsCache || [] };
  }
}

function getDynamicCategoryNos(keywords = []) {
  const results = [];
  const lowerKeys = keywords.map((k) => String(k || '').toLowerCase());

  for (const [mapName, id] of Object.entries(categoryMap)) {
    if (
      lowerKeys.some(
        (k) =>
          mapName.toLowerCase().includes(k) ||
          k.includes(mapName.toLowerCase()) ||
          (k === '선크림' && mapName === '선케어')
      )
    ) {
      results.push(id);
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
    console.log(`[Cache Filter] Active Products ${results.length} matched for cats: ${categoryNos}`);
  }

  if (keyword) {
    const lower = String(keyword).toLowerCase();
    results = results.filter(
      (p) =>
        String(p.product_name || '').toLowerCase().includes(lower) ||
        (p.keywords || []).some((t) => String(t).toLowerCase().includes(lower))
    );
    console.log(`[Cache Filter] Active Products ${results.length} matched for keyword: ${keyword}`);
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

export const cafe24ApiService = {
  syncAllProducts,
  getProductsFromCache,
  getDynamicCategoryNos,
  enrichProductsWithIngredientText,
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
