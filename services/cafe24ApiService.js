import { config } from '../config/env.js';
import { aiTaggingService } from './aiTaggingService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { cafe24AuthService } from './cafe24AuthService.js';

/**
 * 📦 [Product Cache Store]
 * 전체 상품 300+개를 메모리에 보관합니다.
 * 실시간 외부 API 호출 없이 캐시에서 즉시 응답합니다. (지시서 2️⃣ 준수)
 */
let allProductsCache = [];
let lastSyncTime = 0;
let lastSyncHash = '';
let categoryMap = {}; // { '선케어': 93, '크림': 95, ... } 동적 저장

/**
 * 🏷️ [fetchCategoryMap] 카테고리 이름을 기반으로 ID를 실시간 매핑
 */
async function fetchCategoryMap(accessToken) {
    try {
        const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/categories`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const data = await res.json();
        const cats = data.categories || [];

        const newMap = {};
        const targets = {
            '선케어': ['선케어', '선크림', '썬'],
            '비비크림': ['bb', '비비', '베이스'],
            '크림': ['크림'],
            '앰플': ['앰플', '세럼'],
            '마스크': ['팩', '마스크', '패드'],
            '클렌징': ['클렌징'],
            '토너': ['토너'],
            '세트': ['세트'],
            '이너뷰티': ['이너뷰티']
        };

        for (const [key, keywords] of Object.entries(targets)) {
            const found = cats.find(c => keywords.some(k => c.category_name.toLowerCase().includes(k)));
            if (found) newMap[key] = found.category_no;
        }

        categoryMap = newMap;
        console.log(`[Sync] 🗺️ 카테고리 동적 매핑 완료:`, categoryMap);
        return categoryMap;
    } catch (e) {
        console.error(`[Category Map Error]`, e.message);
        return categoryMap;
    }
}

async function syncAllProducts(accessToken) {
    try {
        console.log(`[Sync] 🔄 전 품목 풀스캔 시작...`);
        
        // 1단계: 카테고리 실시간 번호 탐지
        const currentMap = await fetchCategoryMap(accessToken);
        const targetIds = Object.values(currentMap);

        const fields = 'product_no,product_name,price,retail_price,list_image,detail_image,tiny_image,summary_description,simple_description,product_tag,sold_out,selling,display';
        let targetToken = accessToken;
        let allFetched = [];
        let offset = 0;
        const pageSize = 100;

        // 2단계: 전체 상품 수집
        while (true) {
            const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${pageSize}&offset=${offset}&fields=${fields}`;
            let res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${targetToken}`, 'Content-Type': 'application/json' }
            });

            if (res.status === 401) {
                const tokens = await tokenStore.getTokens(config.MALL_ID);
                const refreshData = await cafe24AuthService.refreshAccessToken(tokens.refreshToken);
                await tokenStore.saveTokens(config.MALL_ID, refreshData.access_token, refreshData.refresh_token, refreshData.expires_at);
                targetToken = refreshData.access_token;
                res = await fetch(url, { headers: { 'Authorization': `Bearer ${targetToken}`, 'Content-Type': 'application/json' } });
            }

            const data = await res.json();
            const page = data.products || [];
            if (page.length === 0) break;
            allFetched.push(...page);
            if (page.length < pageSize) break;
            offset += pageSize;
        }

        console.log(`[Sync] 📦 총 ${allFetched.length}개 상품 수집 완료`);

        // 3단계: 탐지된 카테고리 ID들로 상품 역매칭
        console.log(`[Sync] 📂 ${targetIds.length}개 카테고리 상품 매칭 중...`);
        const productToCategories = {};
        for (const catId of targetIds) {
            try {
                const catUrl = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/categories/${catId}/products?limit=100`;
                const catRes = await fetch(catUrl, { headers: { 'Authorization': `Bearer ${targetToken}` } });
                const catData = await catRes.json();
                (catData.products || []).forEach(cp => {
                    const pNo = cp.product_no;
                    if (!productToCategories[pNo]) productToCategories[pNo] = [];
                    productToCategories[pNo].push(catId);
                });
            } catch (err) {}
        }

        // 4단계: 상품 데이터 정규화 및 태깅
        const allFetchedWithCats = allFetched.map(p => ({
            ...p,
            categories: (productToCategories[p.product_no] || []).map(id => ({ category_no: id }))
        }));

        const tagResults = aiTaggingService.tagAllProducts(allFetchedWithCats);
        const tagMap = new Map(tagResults.map(t => [t.product_no, t]));

        allProductsCache = allFetchedWithCats.map(p => {
            const tags = tagMap.get(p.product_no) || {};
            return {
                ...p,
                product_id: p.product_no,
                keywords: tags.all_tags || [],
                attributes: {
                    category_tags: tags.category_tags || [],
                    line_tags: tags.line_tags || [],
                    concern_tags: tags.concern_tags || [],
                    texture_tags: tags.texture_tags || []
                }
            };
        });

        lastSyncTime = Date.now();
        lastSyncHash = JSON.stringify(allFetched.map(p => p.product_no + p.product_name + p.price));
        console.log(`[Sync SUCCESS 🚀] 전 품목 ${allProductsCache.length}개 동적 동기화 완료!`);
        return { products: allProductsCache };
    } catch (e) {
        console.error(`[Sync Error]:`, e.message);
        return { products: allProductsCache || [] };
    }
}

/**
 * 🛠️ [getDynamicCategoryNos] 이름으로 실시간 감지된 번호 반환
 */
function getDynamicCategoryNos(keywords = []) {
    const results = [];
    const lowerKeys = keywords.map(k => k.toLowerCase());
    
    for (const [name, id] of Object.entries(categoryMap)) {
        if (lowerKeys.some(k => name.toLowerCase().includes(k) || k.includes(name.toLowerCase()))) {
            results.push(id);
        }
    }
    return results;
}

export const cafe24ApiService = {
    syncAllProducts,
    getProductsFromCache,
    getDynamicCategoryNos,
    get allProductsCache() { return allProductsCache; },
    get cacheSize() { return allProductsCache.length; },
    get lastSyncTime() { return lastSyncTime; },
    get categoryMapping() { return categoryMap; }
};

/**
 * 🔍 [getProductsFromCache] 캐시에서 즉시 상품 검색
 * 
 * ❌ 실시간 외부 API 호출 금지 (지시서 2️⃣ 준수)
 * ✅ 캐시 데이터에서 category_no 기반 또는 키워드 기반으로 즉시 반환
 */
function getProductsFromCache(filters = {}) {
    const { categoryNos, keyword, limit } = filters;
    let results = [...allProductsCache];

    // 1. category_no 기반 필터 (가장 정확)
    if (categoryNos && categoryNos.length > 0) {
        results = results.filter(p => {
            const productCategories = Array.isArray(p.categories) ? p.categories.map(c => c.category_no) : [];
            return categoryNos.some(cNo => productCategories.includes(cNo));
        });
        console.log(`[Cache Filter] category_no ${categoryNos.join(',')} -> ${results.length}개 매칭`);
    }

    // 2. 키워드 기반 보조 필터 (category_no가 없을 때 폴백)
    if (keyword) {
        const lower = keyword.toLowerCase();
        results = results.filter(p =>
            (p.product_name || '').toLowerCase().includes(lower) ||
            (p.keywords || []).some(t => t.toLowerCase().includes(lower))
        );
        console.log(`[Cache Filter] 키워드 '${keyword}' -> ${results.length}개 매칭`);
    }

    if (limit && limit > 0) {
        results = results.slice(0, limit);
    }

    return results;
}

