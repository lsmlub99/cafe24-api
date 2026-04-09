import { config } from '../config/env.js';
import { aiTaggingService } from './aiTaggingService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { cafe24AuthService } from './cafe24AuthService.js';

let lastSyncLogs = []; // 동기화 로그 추적용

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
            '선케어': ['선케어', '선크림'],
            '비비크림': ['bb크림', '비비크림'], 
            '크림': ['크림'],
            '앰플': ['앰플', '세럼'],
            '마스크': ['팩', '마스크', '패드'],
            '클렌징': ['클렌징'],
            '토너': ['토너'],
            '세트': ['세트'],
            '이너뷰티': ['이너뷰티'],
            '선스틱': ['스틱', 'stick']
        };

        for (const [key, keywords] of Object.entries(targets)) {
            // 1순위: 완전 일치 (예: '크림' -> '크림')
            let found = cats.find(c => keywords.some(k => c.category_name === k));
            // 2순위: 부분 일치
            if (!found) {
                found = cats.find(c => keywords.some(k => c.category_name.toLowerCase().includes(k.toLowerCase())));
            }
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
        const logs = [`Total: ${allFetched.length}`];

        for (const catId of targetIds) {
            try {
                const catUrl = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?category=${catId}&limit=100&fields=product_no`;
                const catRes = await fetch(catUrl, { headers: { 'Authorization': `Bearer ${targetToken}` } });
                const catData = await catRes.json();
                const items = catData.products || [];
                
                if (logs.length === 1) logs.push(`Sample (Cat ${catId}): ${JSON.stringify(items.slice(0,1))}`);
                logs.push(`Cat ${catId} found ${items.length} items`);

                items.forEach(cp => {
                    const pNo = String(cp.product_no);
                    if (!productToCategories[pNo]) productToCategories[pNo] = [];
                    productToCategories[pNo].push(Number(catId));
                });
            } catch (err) {
                logs.push(`Cat ${catId} ERR: ${err.message}`);
            }
        }
        lastSyncLogs = logs;

        // 4단계: 상품 객체에 카테고리 정보 주입
        const allFetchedWithCats = allFetched.map(p => ({
            ...p,
            categories: (productToCategories[String(p.product_no)] || []).map(id => ({ category_no: id }))
        }));
        
        // 5단계: 태깅 및 캐시 구축

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
    
    for (const [mapName, id] of Object.entries(categoryMap)) {
        // 검색 키워드(standardCat)가 맵 이름에 포함되거나 그 반대인 경우 매칭
        if (lowerKeys.some(k => 
            mapName.toLowerCase().includes(k) || 
            k.includes(mapName.toLowerCase()) ||
            (k === '선크림' && mapName === '선케어') // 특수 매칭 보정
        )) {
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
    get categoryMapping() { return categoryMap; },
    get syncLogs() { return lastSyncLogs; }
};

/**
 * 🔍 [getProductsFromCache] 캐시에서 즉시 상품 검색
 * 
 * ❌ 실시간 외부 API 호출 금지 (지시서 2️⃣ 준수)
 * ✅ 캐시 데이터에서 category_no 기반 또는 키워드 기반으로 즉시 반환
 */
function getProductsFromCache(filters = {}) {
    const { categoryNos, keyword, limit } = filters;
    
    // 🔥 [필수] 진열 중이고 판매 중인 '살아있는' 상품만 필터링
    let results = allProductsCache.filter(p => p.display === 'T' && p.selling === 'T');

    if (categoryNos && categoryNos.length > 0) {
        results = results.filter(p => {
            // p.categories는 [{ category_no: 93 }] 형태
            const productCategories = Array.isArray(p.categories) ? p.categories.map(c => Number(c.category_no)) : [];
            return categoryNos.some(cNo => productCategories.includes(Number(cNo)));
        });
        console.log(`[Cache Filter] Active Products ${results.length} matched for cats: ${categoryNos}`);
    }

    if (keyword) {
        const lower = keyword.toLowerCase();
        results = results.filter(p =>
            (p.product_name || '').toLowerCase().includes(lower) ||
            (p.keywords || []).some(t => t.toLowerCase().includes(lower))
        );
        console.log(`[Cache Filter] Active Products ${results.length} matched for keyword: ${keyword}`);
    }

    if (limit && limit > 0) {
        results = results.slice(0, limit);
    }

    return results;
}

