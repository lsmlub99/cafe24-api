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

/**
 * 🔄 [Sync] 전체 상품 풀스캔 + 페이징 + 룰베이스 태깅
 * 
 * [변경사항] Cafe24 Admin API의 /products에서 categories 필드를 직접 가져옵니다.
 * (Render 대시보드에서 mall.read_category 권한 설정 및 재인증 필요)
 */
async function syncAllProducts(accessToken) {
    try {
        console.log(`[Sync] 🔄 전 품목 풀스캔 시작...`);
        const fields = 'product_no,product_name,price,retail_price,list_image,detail_image,tiny_image,summary_description,simple_description,product_tag,sold_out,selling,display,categories';

        let targetToken = accessToken;
        let allFetched = [];
        let offset = 0;
        const pageSize = 100;

        // 페이징 루프: 100개씩 끊어서 전부 가져옴
        while (true) {
            // display=T&selling=T 필터를 제거하여 모든 상품(300개+) 수집
            const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${pageSize}&offset=${offset}&fields=${fields}`;
            let res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${targetToken}`, 'Content-Type': 'application/json' }
            });

            // 401 토큰 만료 자동 갱신
            if (res.status === 401) {
                console.log(`[Sync] 🔑 토큰 만료 -> 갱신`);
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

        if (allFetched.length === 0) {
            console.warn(`[Sync] ⚠️ 상품 0개 수집됨. 기존 캐시 유지.`);
            return { products: allProductsCache };
        }

        // 변동 없으면 스킵
        const currentHash = JSON.stringify(allFetched.map(p => p.product_no + p.product_name + p.price));
        if (currentHash === lastSyncHash) {
            console.log(`[Sync Skip ✅] ${allFetched.length}개 상품 변동 없음`);
            return { products: allProductsCache };
        }

        // 룰베이스 태그 일괄 부여 (AI 미사용, 0ms)
        const tagResults = aiTaggingService.tagAllProducts(allFetched);
        const tagMap = new Map(tagResults.map(t => [t.product_no, t]));

        // 최종 캐시 데이터 구축
        allProductsCache = allFetched.map(p => {
            const tags = tagMap.get(p.product_no) || {};
            return {
                ...p,
                // 지시서 1️⃣ 필수 필드
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

        lastSyncHash = currentHash;
        lastSyncTime = Date.now();
        console.log(`[Sync SUCCESS 🚀] 전 품목 ${allProductsCache.length}개 캐싱 + 태깅 완료!`);
        return { products: allProductsCache };
    } catch (e) {
        console.error(`[Sync Error]:`, e.message);
        return { products: allProductsCache || [] };
    }
}

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

/**
 * 🚀 서비스 객체 수출
 */
export const cafe24ApiService = {
    syncAllProducts,
    getProductsFromCache,
    get allProductsCache() { return allProductsCache; },
    get cacheSize() { return allProductsCache.length; },
    get lastSyncTime() { return lastSyncTime; }
};
